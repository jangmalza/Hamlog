import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';

const fixtureRoot = await fs.mkdtemp(path.join(tmpdir(), 'hamlog-slug-aliases-'));
const fixtureData = path.join(fixtureRoot, 'data');
process.env.HAMLOG_DATA_DIR = fixtureData;
process.env.HAMLOG_UPLOAD_DIR = path.join(fixtureRoot, 'uploads');
process.env.JWT_SECRET ||= 'slug-alias-test-secret';
process.env.ADMIN_PASSWORD ||= 'slug-alias-test-password';
const { initializeDatabase } = await import('../services/db.js');
const { default: app } = await import('../app.js');
const { readPosts, writePosts } = await import('../models/postModel.js');
const { readPostRevisions, createPostRevision } = await import('../models/revisionModel.js');
const { readPostDeletionIntents } = await import('../models/postDeletionModel.js');
const {
  createPostService, updatePostService, restorePostRevisionService, getPostBySlugService,
  deletePostService, getTrashedPostsService, restoreTrashedPostService, permanentlyDeletePostService
} = await import('../services/postService.js');

beforeEach(async () => {
  await fs.rm(fixtureData, { recursive: true, force: true });
  await initializeDatabase();
});
after(() => fs.rm(fixtureRoot, { recursive: true, force: true }));

const create = async (slug, extra = {}) => {
  const result = await createPostService({
    slug, title: `Synthetic ${slug}`, status: 'published', category: 'C++',
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Synthetic alias body' }] }] },
    ...extra
  });
  assert.equal(result.success, true);
  return result.data;
};
const rename = async (post, slug, extra = {}) => {
  const result = await updatePostService(post.id, { slug, expectedUpdatedAt: post.updatedAt, ...extra });
  assert.equal(result.success, true);
  return result.data;
};

test('Korean slug history survives storage, renames and revision restore without chains or client aliases', async () => {
  const original = await create('처음-주소', { previousSlugs: ['client-injected'] });
  assert.equal(original.previousSlugs, undefined);
  const [initialRevision] = await readPostRevisions(original.id);
  const second = await rename(original, '두번째-주소', { previousSlugs: ['client-injected'] });
  const current = await rename(second, '현재-주소');
  assert.deepEqual(current.previousSlugs, ['처음-주소', '두번째-주소']);
  assert.deepEqual((await readPosts())[0].previousSlugs, current.previousSlugs);
  for (const slug of ['처음-주소', '두번째-주소', '현재-주소']) {
    const response = await request(app).get(`/api/posts/${encodeURIComponent(slug)}`).expect(200);
    assert.equal(response.body.id, original.id);
    assert.equal(response.body.slug, '현재-주소');
    assert.equal(response.body.previousSlugs, undefined);
  }
  assert.equal((await getPostBySlugService('client-injected')).code, 'not_found');
  const restored = await restorePostRevisionService(original.id, initialRevision.id, { expectedUpdatedAt: current.updatedAt });
  assert.equal(restored.success, true);
  assert.equal(restored.data.slug, original.slug);
  assert.deepEqual(restored.data.previousSlugs, ['두번째-주소', '현재-주소']);
  const reused = await rename(restored.data, '두번째-주소');
  assert.deepEqual(reused.previousSlugs, ['현재-주소', '처음-주소']);
  for (const slug of reused.previousSlugs) {
    const response = await request(app).get(`/posts/${encodeURIComponent(slug)}`).expect(301);
    assert.equal(response.headers.location, `/posts/${encodeURIComponent(reused.slug)}`);
    await request(app).get(response.headers.location).expect(200);
  }
});

test('all current and historical slugs are reserved across active posts and trash', async () => {
  const first = await rename(await create('reserved-old'), 'reserved-current');
  const other = await create('other-current');
  for (const slug of ['reserved-old', 'reserved-current']) {
    assert.equal((await createPostService({ slug, title: 'Cannot steal', status: 'draft' })).code, 'duplicate_slug');
    assert.equal((await updatePostService(other.id, { slug, expectedUpdatedAt: other.updatedAt })).code, 'duplicate_slug');
  }
  await deletePostService(first.id);
  for (const slug of ['reserved-old', 'reserved-current']) {
    assert.equal((await createPostService({ slug, title: 'Cannot steal trash', status: 'draft' })).code, 'duplicate_slug');
    await request(app).get(`/posts/${slug}`).expect(404);
    await request(app).get(`/api/posts/${slug}`).expect(404);
  }
  const [trashed] = (await getTrashedPostsService()).data;
  const restored = await restoreTrashedPostService(first.id, { expectedDeletedAt: trashed.deletedAt });
  assert.equal(restored.success, true);
  assert.deepEqual(restored.data.previousSlugs, ['reserved-old']);
  assert.equal(restored.data.status, 'draft');
  await request(app).get('/posts/reserved-old').expect(404);
});

test('restoring a legacy revision cannot take an alias reserved by another post', async () => {
  const owner = await rename(await create('historical-reservation'), 'alias-owner');
  const target = await create('revision-target');
  // Older revision snapshots may predate alias reservation tracking.
  const revision = await createPostRevision({ ...target, slug: 'historical-reservation' }, 'baseline');
  const result = await restorePostRevisionService(target.id, revision.id, { expectedUpdatedAt: target.updatedAt });
  assert.equal(result.code, 'duplicate_slug');
  assert.equal((await readPosts()).find(post => post.id === target.id).slug, target.slug);
  assert.equal((await getPostBySlugService('historical-reservation')).data.id, owner.id);
});

test('HTML aliases redirect locally once with encoded canonical Korean paths and unchanged queries', async () => {
  const post = await rename(await create('old-url', { title: 'Synthetic public title' }), '한글-현재-주소');
  const query = '?category=C%2B%2B&returnTo=https%3A%2F%2Fevil.invalid&next=%2F%2Fevil.invalid&q=%0D%0AHeader%3Avalue';
  const redirect = await request(app).get(`/posts/old-url${query}`).expect(301);
  assert.equal(redirect.headers['cache-control'], 'no-store');
  assert.equal(redirect.headers.location, `/posts/${encodeURIComponent(post.slug)}${query}`);
  assert.equal(new URL(redirect.headers.location, 'https://hamlog.invalid').origin, 'https://hamlog.invalid');
  const canonical = await request(app).get(redirect.headers.location).expect(200);
  assert.equal(canonical.headers.location, undefined);
  for (const endpoint of ['/api/posts', '/api/posts?summary=true', `/api/posts/${encodeURIComponent(post.slug)}`, '/', `/posts/${encodeURIComponent(post.slug)}`]) {
    const response = await request(app).get(endpoint).expect(200);
    assert.doesNotMatch(response.text, /previousSlugs|old-url/);
  }
});

test('draft, future, malformed tombstone and pending-purge aliases do not redirect or reveal canonical destinations', async () => {
  const cases = [
    { status: 'draft' },
    { status: 'scheduled', scheduledAt: '2099-01-01T00:00:00.000Z' },
    { status: 'published', deletedAt: '' },
    { status: 'published', purgeRequestedAt: '' }
  ];
  for (const [index, fields] of cases.entries()) {
    const post = await create(`private-destination-${index}`);
    const alias = `old-private-${index}`;
    await writePosts([{ ...post, ...fields, previousSlugs: [alias] }]);
    for (const prefix of ['/posts/', '/api/posts/']) {
      const response = await request(app).get(`${prefix}${alias}`).expect(404);
      assert.equal(response.headers.location, undefined);
      assert.doesNotMatch(response.text, new RegExp(post.slug));
    }
    const view = await request(app).post(`/api/posts/${alias}/view`).set('Origin', 'http://hamlog.test').set('Host', 'hamlog.test').expect(404);
    assert.doesNotMatch(view.text, new RegExp(post.slug));
  }
});

test('alias reservations survive a purge journal after index removal and release only after cleanup succeeds', async context => {
  const post = await rename(await create('purge-old-alias'), 'purge-current-slug');
  await deletePostService(post.id);
  const [trashed] = (await getTrashedPostsService()).data;
  const confirmation = { expectedDeletedAt: trashed.deletedAt, confirmTitle: post.title };
  const originalUnlink = fs.unlink;
  let failures = 0;
  context.mock.method(fs, 'unlink', async target => {
    if (String(target).startsWith(path.join(fixtureData, 'post-deletions'))) {
      failures += 1;
      throw Object.assign(new Error('Synthetic journal cleanup failure'), { code: 'EIO' });
    }
    return originalUnlink(target);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(permanentlyDeletePostService(post.id, confirmation), { code: 'EIO' });
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.equal(failures, 1);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(fixtureData, 'posts.json'), 'utf8')), []);
  assert.deepEqual((await readPostDeletionIntents())[0].previousSlugs, ['purge-old-alias']);
  for (const slug of ['purge-old-alias', 'purge-current-slug']) {
    assert.equal((await createPostService({ slug, title: 'Still reserved', status: 'draft' })).code, 'duplicate_slug');
    const response = await request(app).get(`/posts/${slug}`).expect(404);
    assert.equal(response.headers.location, undefined);
  }
  assert.equal((await permanentlyDeletePostService(post.id, confirmation)).success, true);
  assert.deepEqual(await readPostDeletionIntents(), []);
  assert.equal((await createPostService({ slug: 'purge-old-alias', title: 'Released alias', status: 'draft' })).success, true);
  assert.equal((await createPostService({ slug: 'purge-current-slug', title: 'Released current', status: 'draft' })).success, true);
});
