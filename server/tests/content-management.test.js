import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import request from 'supertest';
import sharp from 'sharp';

import app from '../app.js';
import {
    categoriesFilePath,
    dataDir,
    postsDir,
    postsFilePath,
    profileFilePath,
    uploadDir
} from '../config/paths.js';
import { readCategories, writeCategories } from '../models/categoryModel.js';
import { readComments, writeComments } from '../models/commentModel.js';
import { ensurePostsFile, readPosts, writePosts } from '../models/postModel.js';
import { readProfile, writeProfile } from '../models/profileModel.js';
import { readPostRevisions } from '../models/revisionModel.js';
import { readPostViews } from '../models/postViewModel.js';
import {
    createEmptyAnalytics,
    readAnalytics,
    writeAnalytics
} from '../models/analyticsModel.js';
import { resetAnalyticsPresence } from '../services/analyticsService.js';
import { COMMENT_LIMITS } from '../services/commentService.js';
import { SEARCH_QUERY_MAX_LENGTH, SEARCH_RESULT_LIMIT } from '../controllers/searchController.js';
import { defaultProfile } from '../utils/normalizers/profileNormalizers.js';

const adminPassword = process.env.ADMIN_PASSWORD ?? 'test-password';
const TRUSTED_ORIGIN = 'http://hamlog.test';
const tinyPngDataUrl =
    'data:image/png;base64,'
    + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==';
const sampleContentJson = {
    type: 'doc',
    content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Heading' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body copy' }] }
    ]
};
const parsedHtmlContentJson = {
    type: 'doc',
    content: [
        {
            type: 'heading',
            attrs: { level: 1, textAlign: null },
            content: [{ type: 'text', text: 'Heading' }]
        },
        {
            type: 'paragraph',
            attrs: { textAlign: null },
            content: [{ type: 'text', text: 'Body copy' }]
        }
    ]
};

let backupRoot = '';

const copyIfExists = async (sourcePath, destinationPath) => {
    try {
        await cp(sourcePath, destinationPath, { recursive: true, force: true });
    } catch (error) {
        if (error && error.code !== 'ENOENT') {
            throw error;
        }
    }
};

const clearDirectoryContents = async (directoryPath) => {
    await mkdir(directoryPath, { recursive: true });
    const entries = await import('fs/promises').then(fs => fs.readdir(directoryPath));
    await Promise.all(
        entries.map(entry => rm(path.join(directoryPath, entry), { recursive: true, force: true }))
    );
};

const resetTestState = async () => {
    await clearDirectoryContents(dataDir);
    await clearDirectoryContents(uploadDir);

    await writePosts([]);
    await writeCategories([]);
    await writeProfile(defaultProfile);
    await writeComments([]);
    await writeAnalytics(createEmptyAnalytics());
    resetAnalyticsPresence();
};

const loginAsAdmin = async () => {
    const response = await request(app)
        .post('/api/auth/login')
        .send({ password: adminPassword });

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.headers['set-cookie']));

    return response.headers['set-cookie'];
};

const withTrustedOrigin = (requestBuilder, origin = TRUSTED_ORIGIN) => {
    const parsed = new URL(origin);
    return requestBuilder
        .set('Origin', origin)
        .set('Host', parsed.host);
};

before(async () => {
    backupRoot = await mkdtemp(path.join(tmpdir(), 'hamlog-tests-'));
    await copyIfExists(dataDir, path.join(backupRoot, 'data'));
    await copyIfExists(uploadDir, path.join(backupRoot, 'uploads'));
    await resetTestState();
});

beforeEach(async () => {
    await resetTestState();
});

after(async () => {
    await clearDirectoryContents(dataDir);
    await clearDirectoryContents(uploadDir);

    await copyIfExists(path.join(backupRoot, 'data'), dataDir);
    await copyIfExists(path.join(backupRoot, 'uploads'), uploadDir);

    if (backupRoot) {
        await rm(backupRoot, { recursive: true, force: true });
    }
});

test('authenticated content routes persist posts and categories', async () => {
    const unauthenticatedCreate = await request(app)
        .post('/api/posts')
        .send({
            slug: 'unauthorized-post',
            title: 'Unauthorized Post',
            summary: 'summary',
            category: 'DevOps',
            contentHtml: '<p>blocked</p>',
            publishedAt: '2026-03-06',
            tags: [],
            status: 'published',
            sections: []
        });

    assert.equal(unauthenticatedCreate.status, 401);

    const cookies = await loginAsAdmin();

    const createCategoryResponse = await withTrustedOrigin(request(app)
        .post('/api/categories')
        .set('Cookie', cookies))
        .send({ name: 'DevOps' });

    assert.equal(createCategoryResponse.status, 201);

    const createdCategory = createCategoryResponse.body.categories.find(
        category => category.name === 'DevOps'
    );
    assert.ok(createdCategory);

    const createPostPayload = {
        slug: 'ci-hardening',
        title: 'CI Hardening',
        summary: 'pipeline hardening summary',
        category: 'DevOps',
        contentJson: sampleContentJson,
        contentHtml: '<p>stale html should not be stored</p>',
        publishedAt: '2026-03-06',
        tags: ['ci', 'deploy'],
        status: 'published',
        sections: []
    };

    const createPostResponse = await withTrustedOrigin(request(app)
        .post('/api/posts')
        .set('Cookie', cookies))
        .send(createPostPayload);

    assert.equal(createPostResponse.status, 201);
    assert.equal(createPostResponse.body.slug, createPostPayload.slug);
    assert.deepEqual(createPostResponse.body.contentJson, sampleContentJson);
    assert.equal(createPostResponse.body.contentHtml, '<h1>Heading</h1><p>Body copy</p>');

    const updateCategoryResponse = await withTrustedOrigin(request(app)
        .patch(`/api/categories/${encodeURIComponent(createdCategory.id)}`)
        .set('Cookie', cookies))
        .send({ name: 'Platform' });

    assert.equal(updateCategoryResponse.status, 200);

    const postsAfterCategoryRename = await readPosts();
    assert.equal(postsAfterCategoryRename.length, 1);
    assert.equal(postsAfterCategoryRename[0].category, 'Platform');
    assert.deepEqual(postsAfterCategoryRename[0].contentJson, sampleContentJson);
    assert.equal(postsAfterCategoryRename[0].contentHtml, '<h1>Heading</h1><p>Body copy</p>');

    const updatePostResponse = await withTrustedOrigin(request(app)
        .put(`/api/posts/${createPostResponse.body.id}`)
        .set('Cookie', cookies))
        .send({
            ...createPostPayload,
            slug: 'ci-hardening-updated',
            title: 'CI Hardening Updated',
            category: 'Platform',
            expectedUpdatedAt: postsAfterCategoryRename[0].updatedAt
        });

    assert.equal(updatePostResponse.status, 200);
    assert.equal(updatePostResponse.body.slug, 'ci-hardening-updated');

    const revisionsAfterUpdate = await readPostRevisions(createPostResponse.body.id);
    assert.ok(revisionsAfterUpdate.length >= 2);
    assert.equal(revisionsAfterUpdate[0].event, 'updated');

    const deleteCategoryResponse = await withTrustedOrigin(request(app)
        .delete(`/api/categories/${encodeURIComponent(createdCategory.id)}`)
        .set('Cookie', cookies));

    assert.equal(deleteCategoryResponse.status, 200);

    const postsAfterCategoryDelete = await readPosts();
    assert.equal(postsAfterCategoryDelete.length, 1);
    assert.equal(postsAfterCategoryDelete[0].category, '미분류');

    const categoriesAfterDelete = await readCategories();
    assert.ok(!categoriesAfterDelete.some(category => category.name === 'Platform'));

    await writeComments([{
        id: 'comment-on-post-to-delete',
        postId: createPostResponse.body.id,
        author: 'Test',
        password: 'legacy-test-password',
        content: 'This comment should survive trash until permanent deletion.',
        createdAt: new Date().toISOString()
    }]);

    const viewResponse = await request(app).post('/api/posts/ci-hardening-updated/view');
    assert.equal(viewResponse.status, 200);
    assert.equal((await readPostViews())[createPostResponse.body.id], 1);

    const deletePostResponse = await withTrustedOrigin(request(app)
        .delete(`/api/posts/${createPostResponse.body.id}`)
        .set('Cookie', cookies));

    assert.equal(deletePostResponse.status, 204);

    const postsAfterDelete = await readPosts();
    assert.equal(postsAfterDelete.length, 1);
    assert.ok(postsAfterDelete[0].deletedAt);
    const activePostsAfterDelete = await request(app).get('/api/posts').set('Cookie', cookies);
    assert.equal(activePostsAfterDelete.body.posts.length, 0);
    assert.deepEqual(await readPostRevisions(createPostResponse.body.id), revisionsAfterUpdate);
    assert.equal((await readComments()).length, 1);
    assert.equal((await readPostViews())[createPostResponse.body.id], 1);

    await withTrustedOrigin(request(app)
        .delete(`/api/posts/${createPostResponse.body.id}/permanent`)
        .set('Cookie', cookies))
        .send({ expectedDeletedAt: postsAfterDelete[0].deletedAt, confirmTitle: postsAfterDelete[0].title })
        .expect(204);
    assert.deepEqual(await readPosts(), []);
    assert.deepEqual(await readPostRevisions(createPostResponse.body.id), []);
    assert.deepEqual(await readComments(), []);
    assert.equal(Object.hasOwn(await readPostViews(), createPostResponse.body.id), false);
});

test('post slugs are normalized before file persistence', async () => {
    const cookies = await loginAsAdmin();
    const originalProfile = JSON.parse(await readFile(profileFilePath, 'utf8'));

    const createResponse = await withTrustedOrigin(request(app)
        .post('/api/posts')
        .set('Cookie', cookies))
        .send({
            slug: '../profile',
            title: 'Path Traversal Post',
            summary: 'slug normalization summary',
            category: 'Security',
            contentJson: sampleContentJson,
            publishedAt: '2026-03-06',
            tags: [],
            status: 'published',
            sections: []
        });

    assert.equal(createResponse.status, 201);
    assert.equal(createResponse.body.slug, 'profile');

    const profileAfterCreate = JSON.parse(await readFile(profileFilePath, 'utf8'));
    assert.equal(profileAfterCreate.title, originalProfile.title);
    assert.equal(profileAfterCreate.favicon, originalProfile.favicon);

    const storedCreatedPost = JSON.parse(await readFile(path.join(postsDir, 'profile.json'), 'utf8'));
    assert.equal(storedCreatedPost.slug, 'profile');
    assert.equal(storedCreatedPost.title, 'Path Traversal Post');

    const updateResponse = await withTrustedOrigin(request(app)
        .put(`/api/posts/${createResponse.body.id}`)
        .set('Cookie', cookies))
        .send({
            ...createResponse.body,
            slug: '../../uploads/evil-post',
            title: 'Normalized Path Traversal Post',
            expectedUpdatedAt: createResponse.body.updatedAt
        });

    assert.equal(updateResponse.status, 200);
    assert.equal(updateResponse.body.slug, 'uploads-evil-post');

    const storedUpdatedPost = JSON.parse(
        await readFile(path.join(postsDir, 'uploads-evil-post.json'), 'utf8')
    );
    assert.equal(storedUpdatedPost.slug, 'uploads-evil-post');

    await assert.rejects(
        () => access(path.join(uploadDir, 'evil-post.json')),
        error => error.code === 'ENOENT'
    );
});

test('new posts default to draft and invalid API statuses are rejected', async () => {
    const cookies = await loginAsAdmin();

    const createDraftResponse = await withTrustedOrigin(request(app)
        .post('/api/posts')
        .set('Cookie', cookies))
        .send({
            slug: 'safe-default-draft',
            title: 'Safe Default Draft',
            category: 'Security'
        });

    assert.equal(createDraftResponse.status, 201);
    assert.equal(createDraftResponse.body.status, 'draft');

    const publicDraftResponse = await request(app).get('/api/posts/safe-default-draft');
    assert.equal(publicDraftResponse.status, 404);

    const invalidCreateResponse = await withTrustedOrigin(request(app)
        .post('/api/posts')
        .set('Cookie', cookies))
        .send({
            slug: 'invalid-status-create',
            title: 'Invalid Status Create',
            category: 'Security',
            status: 'publshed'
        });

    assert.equal(invalidCreateResponse.status, 400);
    assert.equal(invalidCreateResponse.body.message, '유효하지 않은 포스트 상태입니다.');

    const invalidUpdateResponse = await withTrustedOrigin(request(app)
        .put(`/api/posts/${createDraftResponse.body.id}`)
        .set('Cookie', cookies))
        .send({ status: null, expectedUpdatedAt: createDraftResponse.body.updatedAt });

    assert.equal(invalidUpdateResponse.status, 400);
    assert.equal(invalidUpdateResponse.body.message, '유효하지 않은 포스트 상태입니다.');

    const [storedPost] = await readPosts();
    assert.equal(storedPost.status, 'draft');
});

test('unknown or missing persisted statuses stay private without changing valid statuses', async () => {
    const basePost = {
        summary: 'status safety summary',
        category: 'Security',
        contentHtml: '<p>status safety body</p>',
        publishedAt: '2026-03-06',
        tags: [],
        sections: []
    };

    await writeFile(postsFilePath, JSON.stringify([
        {
            ...basePost,
            id: 'post-status-valid',
            slug: 'status-valid',
            title: 'Status Valid',
            status: 'published'
        },
        {
            ...basePost,
            id: 'post-status-unknown',
            slug: 'status-unknown',
            title: 'Status Unknown',
            status: 'publshed'
        },
        {
            ...basePost,
            id: 'post-status-missing',
            slug: 'status-missing',
            title: 'Status Missing'
        }
    ], null, 2), 'utf8');

    const publicPostsResponse = await request(app).get('/api/posts');
    assert.equal(publicPostsResponse.status, 200);
    assert.deepEqual(
        publicPostsResponse.body.posts.map(post => post.slug),
        ['status-valid']
    );

    const cookies = await loginAsAdmin();
    const adminPostsResponse = await request(app)
        .get('/api/posts')
        .set('Cookie', cookies);

    assert.equal(adminPostsResponse.status, 200);
    assert.deepEqual(
        Object.fromEntries(adminPostsResponse.body.posts.map(post => [post.slug, post.status])),
        {
            'status-valid': 'published',
            'status-unknown': 'draft',
            'status-missing': 'draft'
        }
    );
});

test('post contentHtml is derived from contentJson for public feeds', async () => {
    await writePosts([
        {
            id: 'post-content-json-source',
            slug: 'content-json-source',
            title: 'Content JSON Source',
            summary: 'content json source summary',
            category: 'Security',
            contentJson: sampleContentJson,
            contentHtml: '<p><img src=x onerror="alert(1)"></p><script>alert(1)</script>',
            publishedAt: '2026-03-06',
            tags: [],
            status: 'published',
            sections: []
        }
    ]);

    const posts = await readPosts();
    assert.equal(posts[0].contentHtml, '<h1>Heading</h1><p>Body copy</p>');

    const storedPost = JSON.parse(await readFile(path.join(postsDir, 'content-json-source.json'), 'utf8'));
    assert.equal(storedPost.contentHtml, '<h1>Heading</h1><p>Body copy</p>');

    const rssResponse = await request(app).get('/rss.xml');
    assert.equal(rssResponse.status, 200);
    assert.match(rssResponse.text, /<!\[CDATA\[<h1 id="heading--heading">Heading<\/h1><p>Body copy<\/p>\]\]>/);
    assert.doesNotMatch(rssResponse.text, /onerror/);
    assert.doesNotMatch(rssResponse.text, /<script>/);
});

test('ensurePostsFile backfills contentJson for legacy html-only posts', async () => {
    await rm(postsDir, { recursive: true, force: true });

    const legacyPost = {
        id: 'legacy-post-1',
        slug: 'legacy-html-post',
        title: 'Legacy HTML Post',
        summary: 'legacy summary',
        category: 'Legacy',
        contentHtml: '<h1>Heading</h1><p>Body copy</p>',
        publishedAt: '2026-03-06',
        readingTime: '2분 읽기',
        tags: [],
        status: 'published',
        sections: []
    };

    await writeFile(postsFilePath, JSON.stringify([legacyPost], null, 2), 'utf8');

    await ensurePostsFile();

    const posts = await readPosts();
    assert.equal(posts.length, 1);
    assert.deepEqual(posts[0].contentJson, parsedHtmlContentJson);
    assert.equal(posts[0].contentHtml, '<h1>Heading</h1><p>Body copy</p>');
    assert.equal(Object.hasOwn(posts[0], 'readingTime'), false);

    const postFilePath = path.join(postsDir, 'legacy-html-post.json');
    const storedPost = JSON.parse(await readFile(postFilePath, 'utf8'));
    assert.deepEqual(storedPost.contentJson, parsedHtmlContentJson);
    assert.equal(Object.hasOwn(storedPost, 'readingTime'), false);
});

test('post revisions can be listed and restored', async () => {
    const cookies = await loginAsAdmin();

    const createPostResponse = await withTrustedOrigin(request(app)
        .post('/api/posts')
        .set('Cookie', cookies))
        .send({
            slug: 'revision-driven-post',
            title: 'Revision Driven Post',
            summary: 'revision summary',
            category: 'Engineering',
            contentJson: sampleContentJson,
            publishedAt: '2026-03-06',
            tags: ['editor'],
            status: 'published',
            sections: []
        });

    assert.equal(createPostResponse.status, 201);

    const createdPostId = createPostResponse.body.id;

    const initialRevisionsResponse = await request(app)
        .get(`/api/posts/${createdPostId}/revisions`)
        .set('Cookie', cookies);

    assert.equal(initialRevisionsResponse.status, 200);
    assert.equal(initialRevisionsResponse.body.length, 1);
    assert.equal(initialRevisionsResponse.body[0].event, 'created');
    assert.equal(initialRevisionsResponse.body[0].title, 'Revision Driven Post');

    const updatePostResponse = await withTrustedOrigin(request(app)
        .put(`/api/posts/${createdPostId}`)
        .set('Cookie', cookies))
        .send({
            ...createPostResponse.body,
            title: 'Revision Driven Post Updated',
            slug: 'revision-driven-post-updated',
            category: 'Engineering',
            expectedUpdatedAt: createPostResponse.body.updatedAt
        });

    assert.equal(updatePostResponse.status, 200);

    const updatedRevisionsResponse = await request(app)
        .get(`/api/posts/${createdPostId}/revisions`)
        .set('Cookie', cookies);

    assert.equal(updatedRevisionsResponse.status, 200);
    assert.equal(updatedRevisionsResponse.body[0].event, 'updated');
    assert.ok(updatedRevisionsResponse.body.some(revision => revision.event === 'created'));

    const createdRevision = updatedRevisionsResponse.body.find(
        revision => revision.event === 'created'
    );
    assert.ok(createdRevision);

    const previewUrl = `/api/posts/${createdPostId}/revisions/${createdRevision.id}`;
    await request(app).get(previewUrl).expect(401);
    const previewResponse = await request(app).get(previewUrl).set('Cookie', cookies).expect(200);
    assert.equal(previewResponse.headers['cache-control'], 'no-store');
    assert.equal(previewResponse.body.snapshot.title, 'Revision Driven Post');
    assert.equal(previewResponse.body.snapshot.id, createdPostId);
    await request(app).get(`/api/posts/${createdPostId}/revisions/missing`).set('Cookie', cookies).expect(404);
    const revisionsBeforeRejectedRestore = await readPostRevisions(createdPostId);
    await withTrustedOrigin(request(app)
        .post(`${previewUrl}/restore`)
        .set('Cookie', cookies)).expect(428);
    await withTrustedOrigin(request(app)
        .post(`${previewUrl}/restore`)
        .set('Cookie', cookies))
        .send({ expectedUpdatedAt: 'stale-version' }).expect(409);
    assert.deepEqual(await readPostRevisions(createdPostId), revisionsBeforeRejectedRestore);
    assert.equal((await readPosts()).find(post => post.id === createdPostId).title, 'Revision Driven Post Updated');

    const restoreResponse = await withTrustedOrigin(request(app)
        .post(`/api/posts/${createdPostId}/revisions/${createdRevision.id}/restore`)
        .set('Cookie', cookies))
        .send({ expectedUpdatedAt: updatePostResponse.body.updatedAt });

    assert.equal(restoreResponse.status, 200);
    assert.equal(restoreResponse.body.title, 'Revision Driven Post');
    assert.equal(restoreResponse.body.slug, 'revision-driven-post');

    const restoredRevisionsResponse = await request(app)
        .get(`/api/posts/${createdPostId}/revisions`)
        .set('Cookie', cookies);

    assert.equal(restoredRevisionsResponse.status, 200);
    assert.equal(restoredRevisionsResponse.body[0].event, 'restored');
    assert.ok(restoredRevisionsResponse.body.some(revision => revision.event === 'updated'));
});

test('post updates require a string version and reject stale editor saves', async () => {
    const cookies = await loginAsAdmin();

    const createPostResponse = await withTrustedOrigin(request(app)
        .post('/api/posts')
        .set('Cookie', cookies))
        .send({
            slug: 'stale-save-post',
            title: 'Stale Save Post',
            summary: 'stale save summary',
            category: 'Engineering',
            contentJson: sampleContentJson,
            publishedAt: '2026-03-06',
            tags: ['editor'],
            status: 'published',
            sections: []
        });

    assert.equal(createPostResponse.status, 201);

    const revisionsBeforeRejectedUpdates = await readPostRevisions(createPostResponse.body.id);
    const categoriesBeforeRejectedUpdates = await readCategories();
    for (const version of [undefined, null, 0, false, [], {}]) {
        const rejectedUpdate = await withTrustedOrigin(request(app)
            .put(`/api/posts/${createPostResponse.body.id}`)
            .set('Cookie', cookies))
            .send({
                title: 'Unversioned Update',
                category: 'Must Not Be Created',
                ...(version === undefined ? {} : { expectedUpdatedAt: version })
            });
        assert.equal(rejectedUpdate.status, 428);
        assert.match(rejectedUpdate.body.message, /버전을 확인/);
    }
    assert.equal((await readPosts())[0].title, createPostResponse.body.title);
    assert.deepEqual(await readPostRevisions(createPostResponse.body.id), revisionsBeforeRejectedUpdates);
    assert.deepEqual(await readCategories(), categoriesBeforeRejectedUpdates);

    const firstUpdateResponse = await withTrustedOrigin(request(app)
        .put(`/api/posts/${createPostResponse.body.id}`)
        .set('Cookie', cookies))
        .send({
            ...createPostResponse.body,
            title: 'Fresh Update',
            expectedUpdatedAt: createPostResponse.body.updatedAt
        });

    assert.equal(firstUpdateResponse.status, 200);
    const revisionsAfterFirstUpdate = await readPostRevisions(createPostResponse.body.id);

    const staleUpdateResponse = await withTrustedOrigin(request(app)
        .put(`/api/posts/${createPostResponse.body.id}`)
        .set('Cookie', cookies))
        .send({
            ...createPostResponse.body,
            title: 'Stale Update',
            expectedUpdatedAt: createPostResponse.body.updatedAt
        });

    assert.equal(staleUpdateResponse.status, 409);
    assert.match(staleUpdateResponse.body.message, /먼저 수정/);

    const posts = await readPosts();
    assert.equal(posts[0].title, 'Fresh Update');
    assert.deepEqual(await readPostRevisions(createPostResponse.body.id), revisionsAfterFirstUpdate);
});

test('profile update and uploads require authentication and persist', async () => {
    const unauthenticatedProfileUpdate = await request(app)
        .put('/api/profile')
        .send({ title: 'Should not persist' });

    assert.equal(unauthenticatedProfileUpdate.status, 401);

    const unauthenticatedUpload = await request(app)
        .post('/api/uploads')
        .send({ dataUrl: tinyPngDataUrl });

    assert.equal(unauthenticatedUpload.status, 401);

    const cookies = await loginAsAdmin();

    const updateProfileResponse = await withTrustedOrigin(request(app)
        .put('/api/profile')
        .set('Cookie', cookies))
        .send({
            title: 'HamLog Ops',
            name: 'Hamwoo',
            role: 'Engineer',
            description: 'Operational profile ready for deployment checks.',
            siteUrl: 'https://ops.hamwoo.co.kr/',
            display: {
                showStack: false,
                showLocation: false
            }
        });

    assert.equal(updateProfileResponse.status, 200);

    const savedProfile = await readProfile();
    assert.equal(savedProfile.title, 'HamLog Ops');
    assert.equal(savedProfile.description, 'Operational profile ready for deployment checks.');
    assert.equal(savedProfile.siteUrl, 'https://ops.hamwoo.co.kr');
    assert.equal(savedProfile.display.showStack, false);
    assert.equal(savedProfile.display.showLocation, false);

    const uploadResponse = await withTrustedOrigin(request(app)
        .post('/api/uploads')
        .set('Cookie', cookies))
        .send({ dataUrl: tinyPngDataUrl });

    assert.equal(uploadResponse.status, 201);
    assert.match(uploadResponse.body.url, /^\/uploads\/upload-.*\.webp$/);
    assert.equal(uploadResponse.body.width, 1);
    assert.equal(uploadResponse.body.height, 1);

    await access(path.join(uploadDir, uploadResponse.body.filename));
});

test('public image endpoint safely resizes allowlisted uploads and the legacy avatar', async () => {
    const sourceFilename = 'public-thumbnail.png';
    await sharp({
        create: {
            width: 240,
            height: 120,
            channels: 4,
            background: { r: 15, g: 118, b: 110, alpha: 1 }
        }
    }).png().toFile(path.join(uploadDir, sourceFilename));

    const resizedResponse = await request(app)
        .get(`/api/images/${sourceFilename}?width=100&height=100`);

    assert.equal(resizedResponse.status, 200);
    assert.match(resizedResponse.headers['content-type'], /image\/webp/);
    assert.match(resizedResponse.headers['cache-control'], /immutable/);
    assert.equal(resizedResponse.headers['x-image-width'], '96');
    assert.equal(resizedResponse.headers['x-image-height'], '96');
    const resizedMetadata = await sharp(resizedResponse.body).metadata();
    assert.equal(resizedMetadata.format, 'webp');
    assert.equal(resizedMetadata.width, 96);
    assert.equal(resizedMetadata.height, 96);

    const avatarResponse = await request(app)
        .get('/api/images/avatar.jpg?width=96&height=96');
    assert.equal(avatarResponse.status, 200);
    assert.match(avatarResponse.headers['cache-control'], /max-age=3600/);
    assert.doesNotMatch(avatarResponse.headers['cache-control'], /immutable/);

    const invalidSizeResponse = await request(app)
        .get(`/api/images/${sourceFilename}?width=not-a-number`);
    assert.equal(invalidSizeResponse.status, 400);
    assert.equal(invalidSizeResponse.headers['cache-control'], 'no-store');

    const invalidFilenameResponse = await request(app).get('/api/images/readme.txt');
    assert.equal(invalidFilenameResponse.status, 400);

    const missingResponse = await request(app).get('/api/images/missing-image.png?width=96');
    assert.equal(missingResponse.status, 404);
});

test('unused upload cleanup keeps referenced images and deletes selected unused files', async () => {
    const cookies = await loginAsAdmin();

    await writeFile(path.join(uploadDir, 'used.webp'), 'used image');
    await writeFile(path.join(uploadDir, 'unused.webp'), 'unused image');
    await writeFile(path.join(uploadDir, 'unused-two.webp'), 'unused image two');
    // Cleanup candidates must be older than the recent-upload protection window.
    const oldUploadTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
    for (const filename of ['used.webp', 'unused.webp', 'unused-two.webp']) {
        await utimes(path.join(uploadDir, filename), oldUploadTime, oldUploadTime);
    }
    await writePosts([
        {
            id: 'post-with-upload-reference',
            slug: 'post-with-upload-reference',
            title: 'Post With Upload Reference',
            summary: 'upload reference',
            category: 'Media',
            contentHtml: '<p><img src="/uploads/used.webp" /></p>',
            publishedAt: '2026-03-06',
            tags: [],
            status: 'published',
            sections: []
        }
    ]);

    const scanResponse = await request(app)
        .get('/api/uploads/unused')
        .set('Cookie', cookies);

    assert.equal(scanResponse.status, 200);
    assert.equal(scanResponse.body.totalFiles, 3);
    assert.equal(scanResponse.body.referencedFiles, 1);
    assert.deepEqual(
        scanResponse.body.unused.map(file => file.filename).sort(),
        ['unused-two.webp', 'unused.webp']
    );

    const deleteResponse = await withTrustedOrigin(request(app)
        .delete('/api/uploads/unused')
        .set('Cookie', cookies))
        .send({ filenames: ['unused.webp', '../used.webp'] });

    assert.equal(deleteResponse.status, 200);
    assert.deepEqual(deleteResponse.body.deleted.map(file => file.filename), ['unused.webp']);

    await access(path.join(uploadDir, 'used.webp'));
    await access(path.join(uploadDir, 'unused-two.webp'));
    await assert.rejects(
        () => access(path.join(uploadDir, 'unused.webp')),
        error => error.code === 'ENOENT'
    );
});

test('profile route recreates a default profile when the profile file is corrupted', async () => {
    await writeFile(profileFilePath, '{ invalid json');

    const response = await request(app).get('/api/profile');

    assert.equal(response.status, 200);
    assert.equal(response.body.profile.title, defaultProfile.title);
    assert.equal(response.body.profile.favicon, defaultProfile.favicon);

    const savedProfile = await readProfile();
    assert.equal(savedProfile.title, defaultProfile.title);
    assert.equal(savedProfile.favicon, defaultProfile.favicon);

    const corruptBackups = (await readdir(dataDir))
        .filter(fileName => fileName.startsWith('profile.json.corrupt-'));
    assert.equal(corruptBackups.length, 1);
});

test('categories are rebuilt from posts when the category file is missing', async () => {
    await writePosts([
        {
            id: 'post-category-rebuild-1',
            slug: 'category-rebuild-1',
            title: 'Category Rebuild 1',
            summary: 'category rebuild',
            category: 'Infra',
            contentHtml: '<p>Infra body</p>',
            publishedAt: '2026-03-06',
            tags: [],
            status: 'published',
            sections: []
        },
        {
            id: 'post-category-rebuild-2',
            slug: 'category-rebuild-2',
            title: 'Category Rebuild 2',
            summary: 'category rebuild',
            category: 'Kubernetes',
            contentHtml: '<p>Kubernetes body</p>',
            publishedAt: '2026-03-06',
            tags: [],
            status: 'published',
            sections: []
        }
    ]);

    await rm(categoriesFilePath, { force: true });

    const response = await request(app).get('/api/categories');

    assert.equal(response.status, 200);
    assert.ok(response.body.categories.some(category => category.name === 'Infra'));
    assert.ok(response.body.categories.some(category => category.name === 'Kubernetes'));
    assert.ok(response.body.categories.some(category => category.name === '미분류'));
});

test('comments respect password verification on deletion', async () => {
    await writePosts([
        {
            id: 'post-1',
            slug: 'verified-comment-post',
            title: 'Verified Comment Post',
            summary: 'comment target',
            category: 'Testing',
            contentHtml: '<p>Hello comments</p>',
            publishedAt: '2026-03-06',
            tags: [],
            status: 'published',
            sections: []
        }
    ]);

    const createCommentResponse = await request(app)
        .post('/api/comments')
        .send({
            postId: 'post-1',
            author: 'Reader',
            password: 'secret-password',
            content: 'Nice post'
        });

    assert.equal(createCommentResponse.status, 201);
    assert.equal(createCommentResponse.body.comment.author, 'Reader');
    assert.ok(!('password' in createCommentResponse.body.comment));

    const listCommentsResponse = await request(app).get('/api/comments?postId=post-1');
    assert.equal(listCommentsResponse.status, 200);
    assert.equal(listCommentsResponse.body.comments.length, 1);

    const storedComments = await readComments();
    assert.equal(storedComments.length, 1);
    assert.notEqual(storedComments[0].password, 'secret-password');

    const failedDeleteResponse = await request(app)
        .delete(`/api/comments/${createCommentResponse.body.comment.id}`)
        .send({ password: 'wrong-password' });

    assert.equal(failedDeleteResponse.status, 403);

    const successfulDeleteResponse = await request(app)
        .delete(`/api/comments/${createCommentResponse.body.comment.id}`)
        .send({ password: 'secret-password' });

    assert.equal(successfulDeleteResponse.status, 200);

    const remainingComments = await readComments();
    assert.equal(remainingComments.length, 0);
});

test('comments normalize public input and reject oversized fields', async () => {
    await writePosts([
        {
            id: 'post-comment-limits',
            slug: 'comment-limits-post',
            title: 'Comment Limits Post',
            summary: 'comment target',
            category: 'Testing',
            contentHtml: '<p>Hello comments</p>',
            publishedAt: '2026-03-06',
            tags: [],
            status: 'published',
            sections: []
        }
    ]);

    const normalizedCommentResponse = await request(app)
        .post('/api/comments')
        .send({
            postId: 'post-comment-limits',
            author: ' Reader    Name ',
            password: ' secret-password ',
            content: '\u0000Hello\r\n\r\n\r\nWorld\u007F'
        });

    assert.equal(normalizedCommentResponse.status, 201);
    assert.equal(normalizedCommentResponse.body.comment.author, 'Reader Name');
    assert.equal(normalizedCommentResponse.body.comment.content, 'Hello\n\nWorld');

    const deletedNormalizedCommentResponse = await request(app)
        .delete(`/api/comments/${normalizedCommentResponse.body.comment.id}`)
        .send({ password: 'secret-password' });

    assert.equal(deletedNormalizedCommentResponse.status, 200);

    const oversizedAuthorResponse = await request(app)
        .post('/api/comments')
        .send({
            postId: 'post-comment-limits',
            author: 'a'.repeat(COMMENT_LIMITS.author + 1),
            password: 'secret-password',
            content: 'Valid comment'
        });

    assert.equal(oversizedAuthorResponse.status, 400);
    assert.match(oversizedAuthorResponse.body.message, /이름/);

    const oversizedContentResponse = await request(app)
        .post('/api/comments')
        .send({
            postId: 'post-comment-limits',
            author: 'Reader',
            password: 'secret-password',
            content: 'a'.repeat(COMMENT_LIMITS.content + 1)
        });

    assert.equal(oversizedContentResponse.status, 400);
    assert.match(oversizedContentResponse.body.message, /댓글/);

    const storedComments = await readComments();
    assert.equal(storedComments.length, 0);
});

test('comments only attach to public visible posts', async () => {
    const futureScheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await writePosts([
        {
            id: 'post-draft-comments',
            slug: 'draft-comments-post',
            title: 'Draft Comments Post',
            summary: 'hidden comment target',
            category: 'Testing',
            contentHtml: '<p>Hidden comments</p>',
            publishedAt: '2026-03-06',
            tags: [],
            status: 'draft',
            sections: []
        },
        {
            id: 'post-future-comments',
            slug: 'future-comments-post',
            title: 'Future Comments Post',
            summary: 'scheduled comment target',
            category: 'Testing',
            contentHtml: '<p>Future comments</p>',
            publishedAt: futureScheduledAt.slice(0, 10),
            scheduledAt: futureScheduledAt,
            tags: [],
            status: 'scheduled',
            sections: []
        }
    ]);

    for (const postId of ['post-draft-comments', 'post-future-comments', 'post-missing-comments']) {
        const createCommentResponse = await request(app)
            .post('/api/comments')
            .send({
                postId,
                author: 'Reader',
                password: 'secret-password',
                content: 'Hidden target'
            });

        assert.equal(createCommentResponse.status, 404);

        const listCommentsResponse = await request(app).get(`/api/comments?postId=${postId}`);
        assert.equal(listCommentsResponse.status, 404);
    }

    const storedComments = await readComments();
    assert.equal(storedComments.length, 0);
});

test('authenticated write routes reject untrusted origins', async () => {
    const cookies = await loginAsAdmin();

    const response = await request(app)
        .post('/api/posts')
        .set('Cookie', cookies)
        .set('Origin', 'https://evil.example.com')
        .set('X-Forwarded-Host', 'evil.example.com')
        .set('X-Forwarded-Proto', 'https')
        .send({
            slug: 'blocked-by-origin',
            title: 'Blocked by origin',
            summary: 'summary',
            category: 'Security',
            contentHtml: '<p>blocked</p>',
            publishedAt: '2026-03-06',
            tags: [],
            status: 'published',
            sections: []
        });

    assert.equal(response.status, 403);
    assert.equal(response.body.message, '유효하지 않은 요청 출처입니다.');
});

test('public post endpoints hide drafts and future scheduled posts from unauthenticated users', async () => {
    const now = Date.now();
    const pastScheduledAt = new Date(now - 60_000).toISOString();
    const futureScheduledAt = new Date(now + 60 * 60 * 1000).toISOString();

    await writePosts([
        {
            id: 'post-public',
            slug: 'public-post',
            title: 'Public Post',
            summary: 'Visible to everyone',
            category: 'Testing',
            contentHtml: '<p>public body</p>',
            publishedAt: '2026-03-06',
            tags: ['visible'],
            status: 'published',
            sections: []
        },
        {
            id: 'post-scheduled-visible',
            slug: 'scheduled-visible-post',
            title: 'Scheduled Visible Post',
            summary: 'Already visible scheduled content',
            category: 'Testing',
            contentHtml: '<p>scheduled visible body</p>',
            publishedAt: pastScheduledAt.slice(0, 10),
            tags: ['scheduled'],
            status: 'scheduled',
            scheduledAt: pastScheduledAt,
            sections: []
        },
        {
            id: 'post-scheduled-hidden',
            slug: 'scheduled-hidden-post',
            title: 'Scheduled Hidden Post',
            summary: 'Should stay hidden',
            category: 'Testing',
            contentHtml: '<p>scheduled hidden body</p>',
            publishedAt: futureScheduledAt.slice(0, 10),
            tags: ['hidden'],
            status: 'scheduled',
            scheduledAt: futureScheduledAt,
            sections: []
        },
        {
            id: 'post-draft',
            slug: 'draft-post',
            title: 'Draft Post',
            summary: 'Should never be public',
            category: 'Testing',
            contentHtml: '<p>draft body</p>',
            publishedAt: '2026-03-06',
            tags: ['draft'],
            status: 'draft',
            sections: []
        }
    ]);

    const publicPostsResponse = await request(app).get('/api/posts');
    assert.equal(publicPostsResponse.status, 200);
    assert.deepEqual(
        publicPostsResponse.body.posts.map(post => post.slug).sort(),
        ['public-post', 'scheduled-visible-post']
    );

    const cookies = await loginAsAdmin();
    const adminPostsResponse = await request(app)
        .get('/api/posts')
        .set('Cookie', cookies);

    assert.equal(adminPostsResponse.status, 200);
    assert.deepEqual(
        adminPostsResponse.body.posts.map(post => post.slug).sort(),
        ['draft-post', 'public-post', 'scheduled-hidden-post', 'scheduled-visible-post']
    );
});

test('public post views increment only for visible posts', async () => {
    const now = Date.now();
    const futureScheduledAt = new Date(now + 60 * 60 * 1000).toISOString();

    await writePosts([
        {
            id: 'post-public',
            slug: 'public-post',
            title: 'Public Post',
            summary: 'Visible to everyone',
            category: 'Testing',
            contentHtml: '<p>public body</p>',
            publishedAt: '2026-03-06',
            updatedAt: '2026-03-06T00:00:00.000Z',
            tags: ['visible'],
            status: 'published',
            views: 2,
            sections: []
        },
        {
            id: 'post-scheduled-hidden',
            slug: 'scheduled-hidden-post',
            title: 'Scheduled Hidden Post',
            summary: 'Should stay hidden',
            category: 'Testing',
            contentHtml: '<p>scheduled hidden body</p>',
            publishedAt: futureScheduledAt.slice(0, 10),
            tags: ['hidden'],
            status: 'scheduled',
            scheduledAt: futureScheduledAt,
            views: 5,
            sections: []
        },
        {
            id: 'post-draft',
            slug: 'draft-post',
            title: 'Draft Post',
            summary: 'Should never be public',
            category: 'Testing',
            contentHtml: '<p>draft body</p>',
            publishedAt: '2026-03-06',
            tags: ['draft'],
            status: 'draft',
            views: 7,
            sections: []
        }
    ]);

    const firstViewResponse = await request(app).post('/api/posts/public-post/view');
    assert.equal(firstViewResponse.status, 200);
    assert.deepEqual(firstViewResponse.body, { slug: 'public-post', views: 3 });

    const secondViewResponse = await request(app).post('/api/posts/public-post/view');
    assert.equal(secondViewResponse.status, 200);
    assert.deepEqual(secondViewResponse.body, { slug: 'public-post', views: 4 });

    const hiddenScheduledResponse = await request(app).post('/api/posts/scheduled-hidden-post/view');
    assert.equal(hiddenScheduledResponse.status, 404);

    const draftResponse = await request(app).post('/api/posts/draft-post/view');
    assert.equal(draftResponse.status, 404);

    const storedPosts = await readPosts();
    const publicPost = storedPosts.find(post => post.slug === 'public-post');
    const scheduledPost = storedPosts.find(post => post.slug === 'scheduled-hidden-post');
    const draftPost = storedPosts.find(post => post.slug === 'draft-post');

    assert.equal(publicPost.views, 2);
    assert.equal(publicPost.updatedAt, '2026-03-06T00:00:00.000Z');
    assert.equal(scheduledPost.views, 5);
    assert.equal(draftPost.views, 7);

    const storedViews = await readPostViews();
    assert.equal(storedViews['post-public'], 4);

    const publicPostsResponse = await request(app).get('/api/posts');
    assert.equal(publicPostsResponse.status, 200);
    assert.deepEqual(
        publicPostsResponse.body.posts.map(post => ({ slug: post.slug, views: post.views })),
        [{ slug: 'public-post', views: 4 }]
    );
});

test('visitor analytics tracks anonymous totals, daily activity, and realtime presence', async () => {
    const unauthenticatedSummary = await request(app).get('/api/analytics/summary');
    assert.equal(unauthenticatedSummary.status, 401);

    const untrustedVisit = await request(app)
        .post('/api/analytics/visit')
        .send({ path: '/' });
    assert.equal(untrustedVisit.status, 403);

    const firstVisit = await withTrustedOrigin(request(app)
        .post('/api/analytics/visit'))
        .send({ path: '/', eventId: 'visit-event-0001' });
    assert.equal(firstVisit.status, 204);
    assert.ok(Array.isArray(firstVisit.headers['set-cookie']));

    const visitorCookies = firstVisit.headers['set-cookie'];
    const visitorCookie = visitorCookies.find(cookie => cookie.startsWith('hamlog_visitor='));
    assert.ok(visitorCookie);
    assert.match(visitorCookie, /HttpOnly/i);
    assert.match(visitorCookie, /SameSite=Lax/i);

    const secondVisit = await withTrustedOrigin(request(app)
        .post('/api/analytics/visit')
        .set('Cookie', visitorCookies))
        .send({ path: '/posts/analytics-test', eventId: 'visit-event-0002' });
    assert.equal(secondVisit.status, 204);

    const duplicateVisit = await withTrustedOrigin(request(app)
        .post('/api/analytics/visit')
        .set('Cookie', visitorCookies))
        .send({ path: '/posts/analytics-test', eventId: 'visit-event-0002' });
    assert.equal(duplicateVisit.status, 204);

    const heartbeat = await withTrustedOrigin(request(app)
        .post('/api/analytics/heartbeat')
        .set('Cookie', visitorCookies))
        .send({ path: '/posts/analytics-test' });
    assert.equal(heartbeat.status, 204);

    const secondVisitor = await withTrustedOrigin(request(app)
        .post('/api/analytics/visit'))
        .send({ path: '/p/analytics-test', eventId: 'visit-event-0003' });
    assert.equal(secondVisitor.status, 204);

    const adminCookies = await loginAsAdmin();
    const summaryResponse = await request(app)
        .get('/api/analytics/summary')
        .set('Cookie', adminCookies);

    assert.equal(summaryResponse.status, 200);
    assert.equal(summaryResponse.headers['cache-control'], 'no-store');
    assert.equal(summaryResponse.body.realtimeVisitors, 2);
    assert.equal(summaryResponse.body.totalVisitors, 2);
    assert.equal(summaryResponse.body.totalPageViews, 3);
    assert.deepEqual(summaryResponse.body.today, { visitors: 2, pageViews: 3 });
    assert.equal(summaryResponse.body.recentDays.length, 7);
    assert.deepEqual(summaryResponse.body.recentDays.at(-1), {
        date: summaryResponse.body.recentDays.at(-1).date,
        visitors: 2,
        pageViews: 3
    });
    assert.equal(summaryResponse.body.timeZone, 'Asia/Seoul');

    const publicSummaryResponse = await request(app).get('/api/analytics/public');
    assert.equal(publicSummaryResponse.status, 200);
    assert.deepEqual(publicSummaryResponse.body, {
        totalVisitors: 2,
        realtimeVisitors: 2
    });
    assert.equal(
        publicSummaryResponse.headers['cache-control'],
        'public, max-age=10, s-maxage=30, stale-while-revalidate=30'
    );
    assert.equal(publicSummaryResponse.headers['set-cookie'], undefined);

    const storedAnalytics = await readAnalytics();
    const rawVisitorId = decodeURIComponent(visitorCookie.split(';')[0].split('=')[1]);
    assert.equal(Object.hasOwn(storedAnalytics.visitors, rawVisitorId), false);
    assert.equal(Object.keys(storedAnalytics.visitors).length, 2);
});

test('visitor analytics rejects non-public paths without changing totals', async () => {
    const response = await withTrustedOrigin(request(app)
        .post('/api/analytics/visit'))
        .send({ path: '/admin', eventId: 'visit-event-0004' });

    assert.equal(response.status, 400);
    assert.deepEqual(await readAnalytics(), createEmptyAnalytics());
});

test('visitor analytics excludes authenticated admin activity', async () => {
    const adminCookies = await loginAsAdmin();
    const visit = await withTrustedOrigin(request(app)
        .post('/api/analytics/visit')
        .set('Cookie', adminCookies))
        .send({ path: '/', eventId: 'visit-event-0005' });

    assert.equal(visit.status, 204);
    assert.deepEqual(await readAnalytics(), createEmptyAnalytics());
});

test('public post summaries omit editor content and detail endpoint returns one visible post', async () => {
    await writePosts([
        {
            id: 'post-summary-public',
            slug: 'summary-public',
            title: 'Summary Public',
            summary: 'summary',
            category: 'Testing',
            contentHtml: '<p>private payload-sized body</p><a href="/posts/linked-post">link</a>',
            publishedAt: '2026-03-06',
            tags: [],
            status: 'published',
            sections: []
        },
        {
            id: 'post-linked',
            slug: 'linked-post',
            title: 'Linked Post',
            summary: 'linked',
            category: 'Testing',
            contentHtml: '<p>linked body</p>',
            publishedAt: '2026-03-05',
            tags: [],
            status: 'published',
            sections: []
        },
        {
            id: 'post-summary-draft',
            slug: 'summary-draft',
            title: 'Summary Draft',
            summary: 'draft',
            category: 'Testing',
            contentHtml: '<p>draft body</p>',
            publishedAt: '2026-03-04',
            tags: [],
            status: 'draft',
            sections: []
        }
    ]);

    const summariesResponse = await request(app).get('/api/posts?summary=true');
    assert.equal(summariesResponse.status, 200);
    assert.equal(summariesResponse.body.posts.length, 2);

    const summary = summariesResponse.body.posts.find(post => post.slug === 'summary-public');
    assert.ok(summary);
    assert.equal(Object.hasOwn(summary, 'contentHtml'), false);
    assert.equal(Object.hasOwn(summary, 'contentJson'), false);
    assert.equal(Object.hasOwn(summary, 'sections'), false);
    assert.equal(Object.hasOwn(summary, 'linkedPostSlugs'), false);

    const detailResponse = await request(app).get('/api/posts/summary-public');
    assert.equal(detailResponse.status, 200);
    assert.equal(detailResponse.body.contentHtml.includes('private payload-sized body'), true);

    const hiddenDetailResponse = await request(app).get('/api/posts/summary-draft');
    assert.equal(hiddenDetailResponse.status, 404);
});

test('seo routes ignore non-public posts, escape meta values, and include visible scheduled posts in feeds', async () => {
    const now = Date.now();
    const pastScheduledAt = new Date(now - 60_000).toISOString();
    const futureScheduledAt = new Date(now + 60 * 60 * 1000).toISOString();
    const unsafePostHtml = '<h1>본문 제목</h1><script>alert("xss")</script><p>배포 구성도 <img src="/uploads/map.png" alt="image.png" onerror="alert(1)" /></p><a href="javascript:alert(1)">위험 링크</a><link-card url="https://docs.example.com/guide" title="안전한 가이드" description="참고 문서"></link-card>';

    await writeProfile({
        ...defaultProfile,
        title: 'SEO Site',
        name: 'SEO Author',
        siteUrl: 'https://blog.example.test',
        description: '검색 엔진과 방문자 모두를 위한 클라우드 엔지니어링 기술 기록입니다.'
    });

    await writePosts([
        {
            id: 'post-visible',
            slug: 'meta-visible-post',
            title: 'A "quoted" <title>',
            summary: 'desc with "quotes" & <tags>',
            category: 'Testing',
            contentHtml: '<p>Visible body</p>',
            publishedAt: '2026-03-06',
            updatedAt: '2026-03-08T04:05:06.000Z',
            tags: ['meta'],
            status: 'published',
            seo: {
                keywords: ['openclaw', '기여']
            },
            sections: []
        },
        {
            id: 'post-prerender-safe',
            slug: 'prerender-safe-post',
            title: 'Safe Prerender',
            summary: '짧은 요약',
            category: 'Security',
            contentHtml: unsafePostHtml,
            publishedAt: '2026-03-07',
            tags: ['security'],
            status: 'published',
            sections: []
        },
        {
            id: 'post-unicode-sitemap',
            slug: '한글-사이트맵-경로',
            title: '한글 사이트맵 경로',
            summary: '사이트맵 URL 인코딩을 검증하는 공개 글입니다.',
            category: 'Testing',
            contentHtml: '<p>사이트맵 경로 본문</p>',
            publishedAt: '2026-03-07',
            tags: ['sitemap'],
            status: 'published',
            sections: []
        },
        {
            id: 'post-custom-canonical',
            slug: 'canonical-local-post',
            title: 'Canonical Local',
            summary: '로컬 canonical 테스트를 위한 충분히 구체적인 게시글 설명입니다.',
            category: 'Testing',
            contentHtml: '<p>Canonical local body</p>',
            publishedAt: '2026-03-05',
            tags: [],
            status: 'published',
            seo: {
                canonicalUrl: 'https://blog.example.test/guides/canonical-local',
                description: '사용자가 직접 작성한 canonical 게시글 SEO 설명'
            },
            sections: []
        },
        {
            id: 'post-external-canonical',
            slug: 'canonical-external-post',
            title: 'Canonical External',
            summary: '외부 원문 canonical 테스트를 위한 게시글 설명입니다.',
            category: 'Testing',
            contentHtml: '<p>Canonical external body</p>',
            publishedAt: '2026-03-04',
            tags: [],
            status: 'published',
            seo: { canonicalUrl: 'https://example.com/original-post' },
            sections: []
        },
        {
            id: 'post-scheduled-visible',
            slug: 'meta-scheduled-visible',
            title: 'Meta Scheduled Visible',
            summary: 'scheduled summary',
            category: 'Testing',
            contentHtml: '<p>visible scheduled body</p>',
            publishedAt: pastScheduledAt.slice(0, 10),
            tags: ['meta'],
            status: 'scheduled',
            scheduledAt: pastScheduledAt,
            sections: []
        },
        {
            id: 'post-draft',
            slug: 'meta-draft-post',
            title: 'Draft Meta Title',
            summary: 'draft meta summary',
            category: 'Testing',
            contentHtml: '<p>draft body</p>',
            publishedAt: '2026-03-06',
            tags: ['draft'],
            status: 'draft',
            sections: []
        },
        {
            id: 'post-future',
            slug: 'meta-future-post',
            title: 'Future Meta Title',
            summary: 'future meta summary',
            category: 'Testing',
            contentHtml: '<p>future body</p>',
            publishedAt: futureScheduledAt.slice(0, 10),
            tags: ['future'],
            status: 'scheduled',
            scheduledAt: futureScheduledAt,
            sections: []
        }
    ]);

    const visibleMetaResponse = await request(app).get('/posts/meta-visible-post');
    assert.equal(visibleMetaResponse.status, 200);
    assert.match(visibleMetaResponse.text, /<title>A &quot;quoted&quot; &lt;title&gt;<\/title>/);
    assert.match(visibleMetaResponse.text, /<meta name="description" content="desc with &quot;quotes&quot; &amp; &lt;tags&gt; Visible body" \/>/);
    assert.match(
        visibleMetaResponse.text,
        /<link rel="canonical" href="https:\/\/blog\.example\.test\/posts\/meta-visible-post" \/>/
    );
    assert.match(
        visibleMetaResponse.text,
        /<meta property="og:type" content="article" \/>/
    );
    assert.match(
        visibleMetaResponse.text,
        /<meta name="keywords" content="openclaw, 기여" \/>/
    );
    assert.match(
        visibleMetaResponse.text,
        /"@type":"BlogPosting"/
    );
    assert.match(
        visibleMetaResponse.text,
        /"mainEntityOfPage":"https:\/\/blog\.example\.test\/posts\/meta-visible-post"/
    );
    assert.match(visibleMetaResponse.text, /"name":"SEO Author"/);
    assert.match(visibleMetaResponse.text, /"name":"SEO Site"/);
    assert.match(visibleMetaResponse.text, /<link rel="icon" href="https:\/\/blog\.example\.test\/favicon\.svg" \/>/);
    assert.match(
        visibleMetaResponse.text,
        /<main class="public-site prerender-shell" data-prerendered="post">/
    );
    assert.match(visibleMetaResponse.text, /<h1>A &quot;quoted&quot; &lt;title&gt;<\/h1>/);
    assert.match(visibleMetaResponse.text, /<p>Visible body<\/p>/);
    const postBootstrapMatch = visibleMetaResponse.text.match(
        /<script id="hamlog-bootstrap" type="application\/json">([^<]+)<\/script>/
    );
    assert.ok(postBootstrapMatch);
    const postBootstrap = JSON.parse(postBootstrapMatch[1]);
    assert.equal(postBootstrap.route, 'post');
    assert.equal(postBootstrap.post.slug, 'meta-visible-post');
    assert.equal(postBootstrap.post.contentHtml, '<p>Visible body</p>');
    assert.ok(!Object.hasOwn(postBootstrap.post, 'contentJson'));
    assert.ok(!Object.hasOwn(postBootstrap.post, 'sections'));
    assert.equal(postBootstrap.profile.title, 'SEO Site');
    assert.ok(!Object.hasOwn(postBootstrap.posts[0], 'contentHtml'));
    assert.ok(!Object.hasOwn(postBootstrap.posts[0], 'contentJson'));

    const safePrerenderResponse = await request(app).get('/posts/prerender-safe-post');
    assert.equal(safePrerenderResponse.status, 200);
    assert.match(safePrerenderResponse.text, /<h2 id="heading--본문-제목">본문 제목<\/h2>/);
    assert.match(safePrerenderResponse.text, /alt="배포 구성도"/);
    assert.match(safePrerenderResponse.text, /href="https:\/\/docs\.example\.com\/guide"/);
    const bootstrapMarker = '<script id="hamlog-bootstrap" type="application/json">';
    const bootstrapMarkerIndex = safePrerenderResponse.text.indexOf(bootstrapMarker);
    assert.notEqual(bootstrapMarkerIndex, -1);
    const prerenderDocument = safePrerenderResponse.text.slice(
        0,
        bootstrapMarkerIndex
    );
    assert.doesNotMatch(prerenderDocument, /alert\(&quot;xss&quot;\)|onerror=|javascript:/i);
    assert.match(safePrerenderResponse.text, /\\u003cscript\\u003ealert\(/);
    assert.match(safePrerenderResponse.text, /\\u003c\/script\\u003e/);
    assert.doesNotMatch(safePrerenderResponse.text, /<script>alert\("xss"\)<\/script>/i);
    const safePostBootstrapMatch = safePrerenderResponse.text.match(
        /<script id="hamlog-bootstrap" type="application\/json">([^<]+)<\/script>/
    );
    assert.ok(safePostBootstrapMatch);
    const safePostBootstrap = JSON.parse(safePostBootstrapMatch[1]);
    assert.equal(safePostBootstrap.post.contentHtml, unsafePostHtml);

    const localCanonicalResponse = await request(app).get('/posts/canonical-local-post');
    assert.equal(localCanonicalResponse.status, 200);
    assert.match(localCanonicalResponse.text, /<meta name="description" content="사용자가 직접 작성한 canonical 게시글 SEO 설명" \/>/);
    assert.match(localCanonicalResponse.text, /<link rel="canonical" href="https:\/\/blog\.example\.test\/guides\/canonical-local" \/>/);
    assert.match(localCanonicalResponse.text, /<meta property="og:url" content="https:\/\/blog\.example\.test\/guides\/canonical-local" \/>/);
    assert.match(localCanonicalResponse.text, /"mainEntityOfPage":"https:\/\/blog\.example\.test\/guides\/canonical-local"/);
    assert.match(localCanonicalResponse.text, /"url":"https:\/\/blog\.example\.test\/guides\/canonical-local"/);

    const externalCanonicalResponse = await request(app).get('/posts/canonical-external-post');
    assert.equal(externalCanonicalResponse.status, 200);
    assert.match(externalCanonicalResponse.text, /<meta property="og:url" content="https:\/\/example\.com\/original-post" \/>/);
    assert.match(externalCanonicalResponse.text, /"mainEntityOfPage":"https:\/\/example\.com\/original-post"/);

    const draftMetaResponse = await request(app).get('/posts/meta-draft-post');
    assert.equal(draftMetaResponse.status, 404);
    assert.doesNotMatch(draftMetaResponse.text, /Draft Meta Title/);
    assert.match(draftMetaResponse.text, /<meta name="robots" content="noindex, nofollow" \/>/);
    assert.equal(draftMetaResponse.headers['x-robots-tag'], 'noindex, nofollow');

    const missingPostResponse = await request(app).get('/posts/does-not-exist');
    assert.equal(missingPostResponse.status, 404);
    assert.match(missingPostResponse.text, /<meta name="robots" content="noindex, nofollow" \/>/);
    assert.equal(missingPostResponse.headers['x-robots-tag'], 'noindex, nofollow');

    const adminResponse = await request(app).get('/admin');
    assert.equal(adminResponse.status, 200);
    assert.match(adminResponse.text, /<meta name="robots" content="noindex, nofollow" \/>/);
    assert.equal(adminResponse.headers['x-robots-tag'], 'noindex, nofollow');

    const rssResponse = await request(app).get('/rss.xml');
    assert.equal(rssResponse.status, 200);
    assert.match(rssResponse.text, /<!\[CDATA\[A "quoted" <title>\]\]>/);
    assert.match(rssResponse.text, /meta-visible-post/);
    assert.match(rssResponse.text, /meta-scheduled-visible/);
    assert.match(rssResponse.text, /https:\/\/blog\.example\.test\/uploads\/map\.png/);
    assert.match(rssResponse.text, /<dc:creator><!\[CDATA\[SEO Author\]\]><\/dc:creator>/);
    assert.doesNotMatch(rssResponse.text, /meta-future-post/);
    assert.doesNotMatch(rssResponse.text, /meta-draft-post/);
    assert.match(
        rssResponse.text,
        new RegExp(new Date('2026-03-06').toUTCString())
    );

    const sitemapResponse = await request(app).get('/sitemap.xml');
    assert.equal(sitemapResponse.status, 200);
    assert.match(sitemapResponse.headers['content-type'], /^application\/xml; charset=utf-8$/);
    assert.match(sitemapResponse.text, /<loc>https:\/\/blog\.example\.test\/<\/loc>/);
    assert.doesNotMatch(sitemapResponse.text, /\/graph<\/loc>/);
    assert.match(sitemapResponse.text, /meta-visible-post/);
    assert.match(sitemapResponse.text, /<lastmod>2026-03-08<\/lastmod>/);
    assert.match(sitemapResponse.text, /meta-scheduled-visible/);
    assert.match(
        sitemapResponse.text,
        /\/posts\/%ED%95%9C%EA%B8%80-%EC%82%AC%EC%9D%B4%ED%8A%B8%EB%A7%B5-%EA%B2%BD%EB%A1%9C/
    );
    assert.doesNotMatch(sitemapResponse.text, /한글-사이트맵-경로/);
    assert.match(sitemapResponse.text, /https:\/\/blog\.example\.test\/guides\/canonical-local/);
    assert.doesNotMatch(sitemapResponse.text, /canonical-local-post/);
    assert.doesNotMatch(sitemapResponse.text, /canonical-external-post/);
    assert.doesNotMatch(sitemapResponse.text, /example\.com\/original-post/);
    assert.doesNotMatch(sitemapResponse.text, /meta-future-post/);
    assert.doesNotMatch(sitemapResponse.text, /meta-draft-post/);

    const searchResponse = await request(app).get('/api/search?q=scheduled');
    assert.equal(searchResponse.status, 200);
    assert.deepEqual(searchResponse.body.map(post => post.slug), ['meta-scheduled-visible']);
});

test('public search normalizes queries, limits results, and rejects oversized input', async () => {
    const matchingPosts = Array.from({ length: SEARCH_RESULT_LIMIT + 5 }, (_, index) => ({
        id: `search-public-${index}`,
        slug: `search-public-${index}`,
        title: `Limit Search Match ${index}`,
        summary: 'search result target',
        category: 'Testing',
        contentHtml: `<p>Search body ${index}</p>`,
        publishedAt: `2026-04-${String(index + 1).padStart(2, '0')}`,
        tags: ['search'],
        status: 'published',
        sections: []
    }));

    await writePosts([
        {
            id: 'search-draft',
            slug: 'search-draft',
            title: 'Limit Search Match Hidden',
            summary: 'hidden search result',
            category: 'Testing',
            contentHtml: '<p>Hidden search body</p>',
            publishedAt: '2026-05-01',
            tags: ['search'],
            status: 'draft',
            sections: []
        },
        ...matchingPosts
    ]);

    const oversizedSearchResponse = await request(app)
        .get('/api/search')
        .query({ q: 'a'.repeat(SEARCH_QUERY_MAX_LENGTH + 1) });

    assert.equal(oversizedSearchResponse.status, 400);
    assert.match(oversizedSearchResponse.body.message, /검색어/);

    const normalizedSearchResponse = await request(app)
        .get('/api/search')
        .query({ q: '  limit   search  ' });

    assert.equal(normalizedSearchResponse.status, 200);
    assert.equal(normalizedSearchResponse.body.length, SEARCH_RESULT_LIMIT);
    assert.equal(normalizedSearchResponse.body[0].slug, `search-public-${SEARCH_RESULT_LIMIT + 4}`);
    assert.equal(
        normalizedSearchResponse.body[SEARCH_RESULT_LIMIT - 1].slug,
        `search-public-${5}`
    );
    assert.ok(!normalizedSearchResponse.body.some(post => post.slug === 'search-draft'));

    const emptySearchResponse = await request(app)
        .get('/api/search')
        .query({ q: '\u0000   ' });

    assert.equal(emptySearchResponse.status, 200);
    assert.deepEqual(emptySearchResponse.body, []);
});

test('home page reflects profile SEO metadata and search engine verification', async () => {
    const previousGoogleVerification = process.env.GOOGLE_SITE_VERIFICATION;
    const previousNaverVerification = process.env.NAVER_SITE_VERIFICATION;
    const previousDaumVerification = process.env.DAUM_SITE_VERIFICATION;
    const previousDaumPin = process.env.DAUM_WEBMASTER_PIN;
    process.env.GOOGLE_SITE_VERIFICATION = 'google-verification-token';
    process.env.NAVER_SITE_VERIFICATION = 'naver-verification-token';
    process.env.DAUM_SITE_VERIFICATION = 'daum-verification-token';
    process.env.DAUM_WEBMASTER_PIN = 'daum-pin-token';

    try {
        await writeProfile({
            ...defaultProfile,
            title: 'HamLog Ops',
            titleSuffix: '운영 기록',
            name: 'Hamwoo',
            description: '운영 관점의 클라우드 엔지니어링 기록입니다.',
            siteUrl: 'https://blog.example.test',
            keywords: ['SRE', 'AWS'],
            favicon: '/uploads/favicon-home.png',
            profileImage: '/uploads/profile-home.png',
            stack: ['Terraform', 'AWS']
        });
        await writePosts([
            {
                id: 'home-public-post',
                slug: 'home-public-post',
                title: '홈 프리렌더 공개 글',
                summary: '검색 엔진이 초기 HTML에서 확인할 수 있는 공개 글입니다.',
                category: 'SEO',
                contentHtml: '<p>본문</p>',
                publishedAt: '2026-03-06',
                tags: [],
                status: 'published',
                sections: []
            },
            {
                id: 'home-draft-post',
                slug: 'home-draft-post',
                title: '홈에 노출되면 안 되는 초안',
                summary: '초안',
                category: 'SEO',
                contentHtml: '<p>초안</p>',
                publishedAt: '2026-03-07',
                tags: [],
                status: 'draft',
                sections: []
            }
        ]);

        const response = await request(app).get('/');

        assert.equal(response.status, 200);
        assert.match(response.headers['content-security-policy'], /default-src 'self'/);
        assert.match(response.headers['content-security-policy'], /object-src 'none'/);
        assert.match(response.headers['content-security-policy'], /frame-ancestors 'self'/);
        assert.match(response.text, /<title>HamLog Ops \| 운영 기록<\/title>/);
        assert.match(response.text, /<meta name="keywords" content="SRE, AWS, Terraform" \/>/);
        assert.match(
            response.text,
            /<meta name="description" content="운영 관점의 클라우드 엔지니어링 기록입니다\. · Terraform, AWS 기술 스택" \/>/
        );
        assert.match(
            response.text,
            /<meta property="og:image" content="https:\/\/blog\.example\.test\/uploads\/profile-home\.png" \/>/
        );
        assert.match(
            response.text,
            /<link rel="icon" href="https:\/\/blog\.example\.test\/uploads\/favicon-home\.png" \/>/
        );
        assert.match(
            response.text,
            /<link rel="canonical" href="https:\/\/blog\.example\.test" \/>/
        );
        assert.match(response.text, /Terraform/);
        assert.match(
            response.text,
            /<main class="public-site prerender-shell" data-prerendered="home">/
        );
        assert.match(response.text, /<h1>Tagline<\/h1>/);
        assert.match(response.text, /href="\/posts\/home-public-post"/);
        assert.doesNotMatch(response.text, /home-draft-post/);
        const homeBootstrapMatch = response.text.match(
            /<script id="hamlog-bootstrap" type="application\/json">([^<]+)<\/script>/
        );
        assert.ok(homeBootstrapMatch);
        const homeBootstrap = JSON.parse(homeBootstrapMatch[1]);
        assert.equal(homeBootstrap.route, 'home');
        assert.equal(homeBootstrap.profile.title, 'HamLog Ops');
        assert.deepEqual(homeBootstrap.posts.map(post => post.slug), ['home-public-post']);
        assert.ok(!Object.hasOwn(homeBootstrap.posts[0], 'contentHtml'));
        assert.match(
            response.text,
            /<meta name="google-site-verification" content="google-verification-token" \/>/
        );
        assert.match(
            response.text,
            /<meta name="naver-site-verification" content="naver-verification-token" \/>/
        );
        assert.match(
            response.text,
            /<meta name="daum-site-verification" content="daum-verification-token" \/>/
        );

        const robotsResponse = await request(app).get('/robots.txt');
        assert.equal(robotsResponse.status, 200);
        assert.match(robotsResponse.headers['content-type'], /text\/plain/);
        assert.match(robotsResponse.text, /User-agent: \*/);
        assert.match(robotsResponse.text, /Allow: \//);
        assert.match(robotsResponse.text, /DaumWebMasterTool: daum-pin-token/);
        assert.match(robotsResponse.text, /Sitemap: https:\/\/blog\.example\.test\/sitemap\.xml/);
    } finally {
        if (previousGoogleVerification === undefined) {
            delete process.env.GOOGLE_SITE_VERIFICATION;
        } else {
            process.env.GOOGLE_SITE_VERIFICATION = previousGoogleVerification;
        }

        if (previousNaverVerification === undefined) {
            delete process.env.NAVER_SITE_VERIFICATION;
        } else {
            process.env.NAVER_SITE_VERIFICATION = previousNaverVerification;
        }

        if (previousDaumVerification === undefined) {
            delete process.env.DAUM_SITE_VERIFICATION;
        } else {
            process.env.DAUM_SITE_VERIFICATION = previousDaumVerification;
        }

        if (previousDaumPin === undefined) {
            delete process.env.DAUM_WEBMASTER_PIN;
        } else {
            process.env.DAUM_WEBMASTER_PIN = previousDaumPin;
        }
    }
});

test('home page replaces the legacy avatar favicon with the lightweight static favicon', async () => {
    await writeProfile({
        ...defaultProfile,
        title: 'Legacy Favicon Site',
        siteUrl: 'https://blog.example.test',
        favicon: '/avatar.jpg'
    });

    const response = await request(app).get('/');

    assert.equal(response.status, 200);
    assert.match(
        response.text,
        /<link rel="icon" href="https:\/\/blog\.example\.test\/favicon\.svg" \/>/
    );
    assert.match(
        response.text,
        /<link rel="apple-touch-icon" href="https:\/\/blog\.example\.test\/favicon\.svg" \/>/
    );
});
