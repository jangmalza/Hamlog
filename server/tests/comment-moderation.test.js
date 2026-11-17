import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';

const root = await mkdtemp(path.join(tmpdir(), 'hamlog-comment-moderation-'));
process.env.HAMLOG_DATA_DIR = path.join(root, 'data');
process.env.HAMLOG_UPLOAD_DIR = path.join(root, 'uploads');
process.env.JWT_SECRET ||= 'test-secret';
process.env.ADMIN_PASSWORD ||= 'test-password';
const { default: app } = await import('../app.js');
const { initializeDatabase } = await import('../services/db.js');
const { writePosts } = await import('../models/postModel.js');
const { readComments, writeComments } = await import('../models/commentModel.js');

beforeEach(async () => {
    await initializeDatabase();
    await writePosts([{ id: 'post', slug: 'moderation-post', title: '관리 대상 글', status: 'published', publishedAt: '2026-01-01', sections: [] }]);
    await writeComments([
        { id: 'one', postId: 'post', author: '작성자', content: '공개 댓글', createdAt: '2026-01-01T00:00:00.000Z', password: 'author-password' },
        { id: 'two', postId: 'post', author: '다른 작성자', content: '<img onerror=alert(1)>', createdAt: '2026-01-02T00:00:00.000Z', password: 'other-password', hiddenAt: '' }
    ]);
});
after(() => rm(root, { recursive: true, force: true }));

const trusted = builder => builder.set('Origin', 'http://hamlog.test').set('Host', 'hamlog.test');
const login = async () => (await request(app).post('/api/auth/login').send({ password: process.env.ADMIN_PASSWORD }).expect(200)).headers['set-cookie'];
const list = cookies => request(app).get('/api/comments/moderation').set('Cookie', cookies).expect(200);

test('comment moderation requires authentication and trusted origin before mutations', async () => {
    await request(app).get('/api/comments/moderation').expect(401);
    await request(app).patch('/api/comments/moderation/one').send({ hidden: true }).expect(401);
    await request(app).delete('/api/comments/moderation/one').send({}).expect(401);
    const cookies = await login();
    for (const method of ['patch', 'delete']) {
        await request(app)[method]('/api/comments/moderation/one').set('Cookie', cookies)
            .set('Origin', 'https://foreign.example').send({ expectedVersion: '2026-01-01T00:00:00.000Z', hidden: true }).expect(403);
    }
    assert.equal((await readComments()).length, 2);
});

test('hide and show are version checked and never expose hidden comments or password data publicly', async () => {
    const cookies = await login();
    const before = await list(cookies);
    assert.equal(before.headers['cache-control'], 'no-store');
    assert.equal(before.body.total, 2);
    assert.equal(JSON.stringify(before.body).includes('password'), false);
    const first = before.body.comments.find(comment => comment.id === 'one');
    assert.equal(first.post.title, '관리 대상 글');
    const patch = data => trusted(request(app).patch('/api/comments/moderation/one').set('Cookie', cookies)).send(data);
    await patch({ hidden: true }).expect(428);
    await patch({ hidden: 'true', expectedVersion: first.moderation.version }).expect(400);
    const hidden = (await patch({ hidden: true, expectedVersion: first.moderation.version }).expect(200)).body.comment;
    assert.equal(hidden.moderation.hidden, true);
    assert.notEqual(hidden.moderation.version, first.moderation.version);
    assert.deepEqual((await request(app).get('/api/comments?postId=post').expect(200)).body.comments, []);
    assert.deepEqual((await request(app).get('/api/comments?postId=post').set('Cookie', cookies).expect(200)).body.comments, []);
    await patch({ hidden: false, expectedVersion: first.moderation.version }).expect(409);
    await patch({ hidden: false, expectedVersion: hidden.moderation.version }).expect(200);
    const visible = (await request(app).get('/api/comments?postId=post').expect(200)).body.comments;
    assert.deepEqual(visible.map(comment => comment.id), ['one']);
    assert.deepEqual(Object.keys(visible[0]).sort(), ['id', 'postId', 'author', 'content', 'createdAt'].sort());
});

test('admin deletion needs a current version but no author password; public password deletion stays intact', async () => {
    const cookies = await login();
    const comment = (await list(cookies)).body.comments.find(comment => comment.id === 'two');
    const remove = data => trusted(request(app).delete('/api/comments/moderation/two').set('Cookie', cookies)).send(data);
    await remove({}).expect(428);
    await remove({ expectedVersion: 'old' }).expect(409);
    await remove({ expectedVersion: comment.moderation.version }).expect(204);
    await remove({ expectedVersion: comment.moderation.version }).expect(404);
    await trusted(request(app).delete('/api/comments/one')).send({ password: 'wrong' }).expect(403);
    await trusted(request(app).delete('/api/comments/one')).send({ password: 'author-password' }).expect(200);
    assert.deepEqual(await readComments(), []);
});

test('admin list paginates and filters while retaining comments on private, trashed and missing posts', async () => {
    const cookies = await login();
    for (const query of ['page=0', 'page=nope', 'pageSize=0', 'visibility=unknown', 'page=1&page=2']) {
        await request(app).get(`/api/comments/moderation?${query}`).set('Cookie', cookies).expect(400);
    }
    const firstPage = (await request(app).get('/api/comments/moderation?pageSize=1').set('Cookie', cookies).expect(200)).body;
    assert.equal(firstPage.total, 2);
    assert.equal(firstPage.hasMore, true);
    assert.equal(firstPage.comments[0].id, 'two');
    assert.equal((await request(app).get('/api/comments/moderation?visibility=hidden').set('Cookie', cookies)).body.total, 1);
    await writePosts([{ id: 'post', slug: 'moderation-post', title: '관리 대상 글', status: 'draft', deletedAt: '2026-01-03T00:00:00.000Z', publishedAt: '2026-01-01', sections: [] }]);
    assert.equal((await list(cookies)).body.comments[0].post.status, 'trashed');
    await request(app).get('/api/comments?postId=post').expect(404);
    await writePosts([]);
    assert.equal((await list(cookies)).body.comments[0].post.status, 'missing');
});
