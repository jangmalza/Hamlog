import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import request from 'supertest';

const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'hamlog-trash-'));
process.env.HAMLOG_DATA_DIR = path.join(fixtureRoot, 'data');
process.env.HAMLOG_UPLOAD_DIR = path.join(fixtureRoot, 'uploads');
process.env.JWT_SECRET ||= 'trash-test-secret';
process.env.ADMIN_PASSWORD ||= 'trash-test-password';
const { default: app } = await import('../app.js');
const { initializeDatabase } = await import('../services/db.js');
const { readPosts, writePosts } = await import('../models/postModel.js');
const { readComments, writeComments } = await import('../models/commentModel.js');
const { readPostRevisions } = await import('../models/revisionModel.js');
const { readPostViews } = await import('../models/postViewModel.js');
const { scanUnusedUploads } = await import('../services/uploadService.js');
const { isPostPublicVisible } = await import('../utils/postVisibility.js');

beforeEach(async () => {
  await rm(process.env.HAMLOG_DATA_DIR, { recursive: true, force: true });
  await rm(process.env.HAMLOG_UPLOAD_DIR, { recursive: true, force: true });
  await initializeDatabase();
});
after(() => rm(fixtureRoot, { recursive: true, force: true }));

const trusted = builder => builder.set('Origin', 'http://hamlog.test').set('Host', 'hamlog.test');
const login = async () => (await request(app).post('/api/auth/login').send({ password: process.env.ADMIN_PASSWORD }).expect(200)).headers['set-cookie'];
const create = async (cookies, patch = {}) => (await trusted(request(app).post('/api/posts').set('Cookie', cookies)).send({
  title: '휴지통 검증 글', slug: 'trash-fixture', summary: '휴지통 검증', category: '테스트', status: 'published', publishedAt: '2026-01-01', tags: ['휴지통'],
  contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'trash-token 본문' }] }, { type: 'image', attrs: { src: '/uploads/keep.webp' } }] },
  ...patch
}).expect(201)).body;
const move = (cookies, id) => trusted(request(app).delete(`/api/posts/${id}`).set('Cookie', cookies)).expect(204);
const trash = async cookies => (await request(app).get('/api/posts/trash/list').set('Cookie', cookies).expect(200)).body.posts;
const restore = (cookies, post) => trusted(request(app).post(`/api/posts/${post.id}/trash/restore`).set('Cookie', cookies)).send({ expectedDeletedAt: post.deletedAt });

test('trash hides posts everywhere while retaining body, comments, views, revisions and image references', async () => {
  const cookies = await login();
  const post = await create(cookies);
  await writeFile(path.join(process.env.HAMLOG_UPLOAD_DIR, 'keep.webp'), 'image');
  const old = new Date(Date.now() - 48 * 3600000);
  await utimes(path.join(process.env.HAMLOG_UPLOAD_DIR, 'keep.webp'), old, old);
  await writeComments([{ id: 'comment', postId: post.id, author: '독자', content: '댓글', password: 'test', createdAt: new Date().toISOString() }]);
  await request(app).post(`/api/posts/${post.slug}/view`).set('Origin', 'http://hamlog.test').set('Host', 'hamlog.test').expect(200);
  const revisions = await readPostRevisions(post.id);
  await move(cookies, post.id);
  const [deleted] = await trash(cookies);
  assert.equal(deleted.id, post.id);
  assert.equal(deleted.contentHtml, undefined);
  const [stored] = await readPosts();
  assert.equal(stored.status, 'draft');
  assert.equal(stored.contentHtml, post.contentHtml);
  assert.equal(isPostPublicVisible(stored), false);
  assert.deepEqual(await readPostRevisions(post.id), revisions);
  assert.equal((await readComments()).length, 1);
  assert.equal((await readPostViews())[post.id], 1);
  assert.deepEqual((await scanUnusedUploads()).unused, []);
  for (const path of [`/api/posts/${post.slug}`, `/posts/${post.slug}`]) await request(app).get(path).expect(404);
  await request(app).post(`/api/posts/${post.slug}/view`).set('Origin', 'http://hamlog.test').set('Host', 'hamlog.test').expect(404);
  await request(app).get(`/api/comments?postId=${post.id}`).expect(404);
  assert.deepEqual((await request(app).get('/api/posts').set('Cookie', cookies)).body.posts, []);
  assert.deepEqual((await request(app).get('/api/search?q=trash-token')).body, []);
  for (const path of ['/sitemap.xml', '/rss.xml', '/']) assert.ok(!(await request(app).get(path)).text.includes(post.slug));
  execFileSync(process.execPath, ['scripts/verify-data.js'], { env: process.env });
});

test('restore is a private draft, keeps history, reserves its URL, and rejects obsolete trash actions', async () => {
  const cookies = await login();
  const post = await create(cookies, { status: 'scheduled', scheduledAt: '2026-01-01T00:00:00.000Z' });
  await move(cookies, post.id);
  const [deleted] = await trash(cookies);
  await trusted(request(app).post('/api/posts').set('Cookie', cookies)).send({ title: 'duplicate', slug: post.slug, status: 'draft' }).expect(409);
  await trusted(request(app).put(`/api/posts/${post.id}`).set('Cookie', cookies)).send({ title: '우회', status: 'published', deletedAt: null }).expect(409);
  const [revision] = await readPostRevisions(post.id);
  await trusted(request(app).post(`/api/posts/${post.id}/revisions/${revision.id}/restore`).set('Cookie', cookies)).send({ expectedUpdatedAt: deleted.updatedAt }).expect(409);
  const restored = (await restore(cookies, deleted).expect(200)).body;
  assert.equal(restored.status, 'draft');
  assert.equal(restored.deletedAt, undefined);
  assert.equal(restored.scheduledAt, undefined);
  await request(app).get(`/api/posts/${post.slug}`).expect(404);
  assert.equal((await trash(cookies)).length, 0);
  await move(cookies, post.id);
  assert.notEqual((await trash(cookies))[0].deletedAt, deleted.deletedAt);
  await restore(cookies, deleted).expect(409);
  assert.ok((await readPostRevisions(post.id)).length > 0);
});

test('permanent deletion requires trash state, the current deletion version and exact title', async () => {
  const cookies = await login();
  const post = await create(cookies);
  const purge = body => trusted(request(app).delete(`/api/posts/${post.id}/permanent`).set('Cookie', cookies)).send(body);
  await purge({ expectedDeletedAt: '', confirmTitle: post.title }).expect(404);
  await move(cookies, post.id);
  const [deleted] = await trash(cookies);
  await purge({ confirmTitle: post.title }).expect(428);
  await purge({ expectedDeletedAt: deleted.deletedAt, confirmTitle: '잘못된 제목' }).expect(400);
  assert.equal((await readPosts()).length, 1);
  await purge({ expectedDeletedAt: deleted.deletedAt, confirmTitle: post.title }).expect(204);
  assert.equal((await readPosts()).length, 0);
  assert.deepEqual(await readPostRevisions(post.id), []);
  assert.equal((await trash(cookies)).length, 0);
});

test('trash management requires authentication and trusted origin; repeated movement is idempotent', async () => {
  const cookies = await login();
  const post = await create(cookies);
  await request(app).get('/api/posts/trash/list').expect(401);
  await request(app).post(`/api/posts/${post.id}/trash/restore`).send({}).expect(401);
  await request(app).delete(`/api/posts/${post.id}/permanent`).send({}).expect(401);
  await request(app).post(`/api/posts/${post.id}/trash/restore`).set('Cookie', cookies).set('Origin', 'https://foreign.example').send({}).expect(403);
  await move(cookies, post.id);
  const [first] = await trash(cookies);
  await move(cookies, post.id);
  assert.equal((await trash(cookies))[0].deletedAt, first.deletedAt);
  const restored = (await restore(cookies, first).expect(200)).body;
  assert.equal(restored.id, post.id);
});

test('trash marker cannot be set by ordinary create/update input and malformed markers stay private', async () => {
  const cookies = await login();
  const post = await create(cookies, { deletedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(post.deletedAt, undefined);
  for (const deletedAt of ['', null, 'invalid']) assert.equal(isPostPublicVisible({ ...post, deletedAt }), false);
  await writePosts([{ ...post, deletedAt: '' }]);
  assert.deepEqual((await request(app).get('/api/posts')).body.posts, []);
  assert.throws(() => execFileSync(process.execPath, ['scripts/verify-data.js'], { env: process.env, stdio: 'pipe' }));
  assert.ok((await readFile(path.join(process.env.HAMLOG_DATA_DIR, 'posts.json'), 'utf8')).includes('deletedAt'));
});
