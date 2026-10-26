import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const fixtureRoot = await fs.mkdtemp(path.join(tmpdir(), 'hamlog-post-store-'));
process.env.HAMLOG_DATA_DIR = path.join(fixtureRoot, 'data');
process.env.HAMLOG_UPLOAD_DIR = path.join(fixtureRoot, 'uploads');
const { initializeDatabase } = await import('../services/db.js');
const { readPosts, writePosts } = await import('../models/postModel.js');
const { beginPostDeletion, finishPostDeletion } = await import('../models/postDeletionModel.js');
const { createPostService, updatePostService, getAllPostsService } = await import('../services/postService.js');

const dataDir = process.env.HAMLOG_DATA_DIR;
const indexPath = path.join(dataDir, 'posts.json');
const postFilePath = slug => path.join(dataDir, 'posts', `${slug}.json`);
const verifyData = () => execFileSync(process.execPath, ['scripts/verify-data.js'], { env: process.env, stdio: 'pipe' });

beforeEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.rm(process.env.HAMLOG_UPLOAD_DIR, { recursive: true, force: true });
  await initializeDatabase();
});
after(() => fs.rm(fixtureRoot, { recursive: true, force: true }));

const create = async (slug) => {
  const result = await createPostService({
    title: `Fixture ${slug}`, slug, category: 'Store', status: 'published', tags: ['store'],
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Synthetic body ${slug}` }] }] }
  });
  assert.equal(result.success, true);
  return result.data;
};

const fileIdentity = async (filePath) => {
  const stats = await fs.stat(filePath, { bigint: true });
  return `${stats.ino}:${stats.mtimeNs}`;
};

// Replace the index with identical text, so the next read must parse it again.
const reloadIndexFromDisk = async () => {
  await fs.copyFile(indexPath, `${indexPath}.reload`);
  await fs.rename(`${indexPath}.reload`, indexPath);
};

test('saving one post rewrites only its own file and keeps every file in sync with the index', async () => {
  const first = await create('store-first');
  const second = await create('store-second');
  const third = await create('store-third');
  const before = await Promise.all([first, second, third].map(post => fileIdentity(postFilePath(post.slug))));

  const saved = await updatePostService(second.id, { title: 'Edited second', expectedUpdatedAt: second.updatedAt });
  assert.equal(saved.success, true);

  assert.equal(await fileIdentity(postFilePath(first.slug)), before[0]);
  assert.notEqual(await fileIdentity(postFilePath(second.slug)), before[1]);
  assert.equal(await fileIdentity(postFilePath(third.slug)), before[2]);
  assert.equal(JSON.parse(await fs.readFile(postFilePath(second.slug), 'utf8')).title, 'Edited second');
  verifyData();
});

test('the next save repairs post files that are missing, stale or orphaned on disk', async () => {
  const first = await create('store-missing');
  const second = await create('store-stale');
  const third = await create('store-saved');
  await fs.rm(postFilePath(first.slug));
  await fs.writeFile(postFilePath(second.slug), JSON.stringify({ ...second, title: 'Stale copy' }, null, 2));
  await fs.writeFile(postFilePath('store-orphan'), '{}');
  assert.throws(verifyData);

  const saved = await updatePostService(third.id, { title: 'Edited third', expectedUpdatedAt: third.updatedAt });
  assert.equal(saved.success, true);
  await assert.rejects(fs.access(postFilePath('store-orphan')), { code: 'ENOENT' });
  verifyData();
});

test('mutating read, listed, saved or written post objects never changes later reads', async () => {
  const post = await create('store-mutation');
  const snapshot = await readPosts();

  const [read] = await readPosts();
  read.title = 'Mutated title';
  read.tags.push('mutated-tag');
  read.contentJson.content[0].content[0].text = 'Mutated body';
  delete read.contentHtml;
  const [listed] = (await getAllPostsService(true)).data;
  listed.tags.push('mutated-listing');
  listed.contentJson.content.length = 0;
  assert.deepEqual(await readPosts(), snapshot);

  const saved = await updatePostService(post.id, { title: 'Saved title', expectedUpdatedAt: post.updatedAt });
  assert.equal(saved.success, true);
  saved.data.tags.push('mutated-after-save');
  saved.data.contentJson.content.length = 0;
  const afterSave = await readPosts();
  assert.equal(afterSave[0].title, 'Saved title');
  assert.deepEqual(afterSave[0].tags, ['store']);
  assert.equal(afterSave[0].contentJson.content.length, 1);

  const written = afterSave.map(item => ({ ...item, title: 'Written title' }));
  await writePosts(written);
  written[0].title = 'Changed after write';
  written[0].tags.push('mutated-after-write');
  written[0].contentJson.content.length = 0;
  const afterWrite = await readPosts();
  assert.equal(afterWrite[0].title, 'Written title');
  assert.deepEqual(afterWrite[0].tags, ['store']);
  assert.match(afterWrite[0].contentHtml, /Synthetic body store-mutation/);

  await reloadIndexFromDisk();
  assert.deepEqual(await readPosts(), afterWrite);
});

test('posts cached by a save equal a fresh read of the stored index, including normalized legacy fields', async () => {
  await create('store-modern');
  const legacy = {
    id: 'legacy-store-post', slug: 'legacy-store-post', title: 'Legacy', readingTime: '3분',
    status: 'PUBLISHED', scheduledAt: 'not-a-date', views: '-4', seo: { title: '  ' }, category: '',
    contentHtml: '<p>Stored html</p>'
  };
  await writePosts([...await readPosts(), legacy]);
  const cached = await readPosts();
  assert.equal(Object.hasOwn(cached[1], 'readingTime'), false);

  await reloadIndexFromDisk();
  assert.deepEqual(await readPosts(), cached);
  verifyData();
});

test('reads pick up an index replaced by another process or edited in place', async () => {
  const post = await create('store-external');
  assert.equal((await readPosts())[0].title, `Fixture ${post.slug}`);

  execFileSync(process.execPath, ['--input-type=module', '-e', `
    const { readPosts, writePosts } = await import('./server/models/postModel.js');
    await writePosts((await readPosts()).map(post => ({ ...post, title: 'Changed by another process' })));
  `], { env: process.env });
  assert.equal((await readPosts())[0].title, 'Changed by another process');

  const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  index[0].title = 'Edited in place';
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
  assert.equal((await readPosts())[0].title, 'Edited in place');

  await fs.rm(indexPath);
  assert.deepEqual(await readPosts(), []);
});

test('deletion intents are merged on every read while the index stays cached', async () => {
  const post = await create('store-intent');
  await readPosts();

  const pending = await beginPostDeletion({ ...post, deletedAt: new Date().toISOString() });
  const merged = (await readPosts()).find(item => item.id === post.id);
  assert.equal(merged.purgeRequestedAt, pending.purgeRequestedAt);
  assert.equal(merged.status, 'draft');

  await finishPostDeletion(post.id);
  const restored = (await readPosts()).find(item => item.id === post.id);
  assert.equal(restored.purgeRequestedAt, undefined);
  assert.equal(restored.status, 'published');
});
