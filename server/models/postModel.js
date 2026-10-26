import { readFile, mkdir, readdir, unlink, open, stat } from 'fs/promises';
import path from 'path';
import { postsFilePath, dataDir, postsDir } from '../config/paths.js';
import { writeFileAtomic, writeJsonAtomic } from '../utils/fsUtils.js';
import { readPostDeletionIntents } from './postDeletionModel.js';
import {
    normalizeContentJson,
    hasContentJsonContent,
    normalizeContentHtml,
    normalizePostStatus,
    normalizePostViews,
    normalizeScheduledAt,
    normalizeSeo
} from '../utils/normalizers/postNormalizers.js';
import {
    normalizeCategory
} from '../utils/normalizers/categoryNormalizers.js';
import { parseHtmlToContentJson, renderContentJsonToHtml } from '../utils/contentRenderer.js';

function getPostFilePath(slug) {
    const postsRoot = path.resolve(postsDir);
    const postPath = path.resolve(postsRoot, `${slug}.json`);

    if (!postPath.startsWith(`${postsRoot}${path.sep}`)) {
        throw new Error(`Invalid post slug path: ${slug}`);
    }

    return postPath;
}

// Rendering contentJson dominates normalization. HTML is kept for the content
// seen by the latest full pass over the posts, so unchanged posts skip it.
let renderedHtmlByContent = new Map();

function renderContentHtml(contentJson, rendered) {
    const key = JSON.stringify(contentJson);
    const html = rendered.get(key) ?? renderedHtmlByContent.get(key) ?? renderContentJsonToHtml(contentJson);
    rendered.set(key, html);
    return html;
}

function normalizePost(post, rendered = renderedHtmlByContent) {
    if (!post || typeof post !== 'object') return post;
    const { readingTime, ...postWithoutReadingTime } = post;
    void readingTime;
    const contentJson = normalizeContentJson(post.contentJson);
    let contentHtml = normalizeContentHtml(post.contentHtml) || undefined;

    if (hasContentJsonContent(contentJson)) {
        try {
            contentHtml = renderContentHtml(contentJson, rendered) || undefined;
        } catch (error) {
            console.error(`[PostModel] Failed to render contentJson for "${post.slug}":`, error);
        }
    }

    return {
        ...postWithoutReadingTime,
        category: normalizeCategory(post.category),
        contentJson,
        contentHtml,
        views: normalizePostViews(post.views),
        status: normalizePostStatus(post.status),
        scheduledAt: normalizeScheduledAt(post.scheduledAt) || undefined,
        seo: normalizeSeo(post.seo)
    };
}

async function backfillLegacyContentJson(posts) {
    let migratedCount = 0;

    const nextPosts = posts.map((post) => {
        if (hasContentJsonContent(post.contentJson) || !post.contentHtml) {
            return post;
        }

        try {
            const contentJson = normalizeContentJson(parseHtmlToContentJson(post.contentHtml));
            if (hasContentJsonContent(contentJson)) {
                migratedCount += 1;
                return { ...post, contentJson };
            }
        } catch (error) {
            console.error(`[Migration] Failed to backfill contentJson for "${post.slug}":`, error);
        }

        return post;
    });

    if (migratedCount > 0) {
        console.log(`[Migration] Backfilling contentJson for ${migratedCount} posts...`);
        await writePosts(nextPosts);
        console.log('[Migration] contentJson backfill completed.');
    }
}

// Normalized posts.json entries: `json` is the stored text of one post and
// `post` is what readPosts returns for it. writePosts refreshes the cache inside
// the data store lock; the file signature also catches index changes made
// outside writePosts (recovery in another process, restore tooling).
let indexCache = null;

const POST_FILE_READ_BATCH = 32;

const toIndexEntry = (json, rendered) => ({ json, post: normalizePost(JSON.parse(json), rendered) });

const fileSignature = (stats) => `${stats.ino}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`;

async function readIndexSignature() {
    try {
        return fileSignature(await stat(postsFilePath, { bigint: true }));
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

async function loadIndex() {
    let handle;
    try {
        handle = await open(postsFilePath, 'r');
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return { signature: null, entries: [] };
    }

    try {
        // Stat the open handle so the signature always describes the text read.
        const signature = fileSignature(await handle.stat({ bigint: true }));
        const parsed = JSON.parse(await handle.readFile('utf8'));
        const rendered = new Map();
        const entries = (Array.isArray(parsed) ? parsed : [])
            .map(post => toIndexEntry(JSON.stringify(post, null, 2), rendered));
        renderedHtmlByContent = rendered;
        return { signature, entries };
    } finally {
        await handle.close();
    }
}

async function readIndexPosts() {
    let index = indexCache;
    if (!index || index.signature !== await readIndexSignature()) {
        const loaded = await loadIndex();
        // Keep a newer index cached by a write that finished during this load.
        if (indexCache === index) indexCache = loaded;
        index = loaded;
    }
    // Callers may modify what they receive; the cached posts must stay intact.
    return index.entries.map(entry => structuredClone(entry.post));
}

async function readStoredPostFile(postPath) {
    try {
        return await readFile(postPath, 'utf8');
    } catch {
        // Unreadable or missing: rewriting it is the only way to know it is current.
        return null;
    }
}

/**
 * Reads all posts from the posts.json index, with posts whose permanent
 * deletion is in progress taken from their deletion intents.
 */
export async function readPosts() {
    const posts = await readIndexPosts();
    const pending = await readPostDeletionIntents();
    const pendingIds = new Set(pending.map(post => post.id));
    return [...posts.filter(post => !pendingIds.has(post.id)), ...pending.map(post => normalizePost(post))];
}

/**
 * Writes all posts to the index, then rewrites only the individual files
 * whose stored text differs from the new version.
 */
export async function writePosts(posts) {
    const rendered = new Map();
    const normalized = posts.map(post => normalizePost(post, rendered));
    const previousEntries = new Map(indexCache?.entries.map(entry => [entry.json, entry]));
    const entries = normalized.map((post) => {
        const json = JSON.stringify(post, null, 2);
        return previousEntries.get(json) ?? toIndexEntry(json, rendered);
    });
    renderedHtmlByContent = rendered;

    // 1. Update Index
    await writeJsonAtomic(postsFilePath, normalized);
    const signature = await readIndexSignature();
    indexCache = { signature, entries };

    // 2. Update individual files. Comparing with the files on disk, not with the
    // previous index, also repairs files left stale by an interrupted write.
    await mkdir(postsDir, { recursive: true });
    // A later post wins a shared slug, as it did when every file was rewritten.
    const jsonByPath = new Map();
    normalized.forEach((post, index) => jsonByPath.set(getPostFilePath(post.slug), entries[index].json));
    const postFiles = [...jsonByPath];
    for (let start = 0; start < postFiles.length; start += POST_FILE_READ_BATCH) {
        const batch = postFiles.slice(start, start + POST_FILE_READ_BATCH);
        const stored = await Promise.all(batch.map(([postPath]) => readStoredPostFile(postPath)));
        for (const [index, [postPath, json]] of batch.entries()) {
            if (stored[index] !== json) {
                await writeFileAtomic(postPath, json);
            }
        }
    }

    // 3. Cleanup deleted posts individual files
    const files = await readdir(postsDir);
    const existingSlugs = new Set(normalized.map(p => `${p.slug}.json`));
    for (const file of files) {
        if (!existingSlugs.has(file)) {
            try {
                await unlink(path.join(postsDir, file));
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
        }
    }
}

export async function ensurePostsFile() {
    await mkdir(dataDir, { recursive: true });
    await mkdir(postsDir, { recursive: true });

    try {
        const raw = await readFile(postsFilePath, 'utf8');
        const posts = JSON.parse(raw);

        if (Array.isArray(posts) && posts.length > 0) {
            const files = await readdir(postsDir);
            if (files.length === 0) {
                console.log(`[Migration] Migrating ${posts.length} posts to individual files...`);
                await writePosts(posts);
                console.log("[Migration] Successfully split posts into individual files.");
            }
        }
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error("[Migration] Error reading posts.json during migration:", error);
        }

        // Rebuild index from individual files if posts.json is missing
        const files = await readdir(postsDir);
        if (files.length > 0) {
            console.log(`[Migration] Index missing. Rebuilding index from ${files.length} files...`);
            const posts = [];
            for (const file of files) {
                if (file.endsWith('.json')) {
                    try {
                        const raw = await readFile(path.join(postsDir, file), 'utf8');
                        posts.push(JSON.parse(raw));
                    } catch (e) {
                        console.error(`[Migration] Failed to read ${file}:`, e);
                    }
                }
            }
            const normalized = posts.map(post => normalizePost(post));
            await writeJsonAtomic(postsFilePath, normalized);
            indexCache = null;
            console.log("[Migration] Index rebuilt successfully.");
        } else {
            await writePosts([]);
        }
    }

    const normalizedPosts = await readPosts();
    await backfillLegacyContentJson(normalizedPosts);
}
