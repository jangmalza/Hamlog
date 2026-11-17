import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../app.js';
import { writePosts } from '../models/postModel.js';
import { writeComments } from '../models/commentModel.js';

const SITE_ORIGIN = 'http://hamlog.test';
const fromSite = (builder) => builder.set('Origin', SITE_ORIGIN).set('Host', new URL(SITE_ORIGIN).host);
const fromOtherSite = (builder) => builder.set('Origin', 'https://evil.example').set('Host', new URL(SITE_ORIGIN).host);

const commentCount = async () => (await request(app).get('/api/comments?postId=origin-post').expect(200)).body.comments.length;

test('public comment and view writes only accept the site origin', async () => {
    await writePosts([{
        id: 'origin-post',
        slug: 'origin-post',
        title: '출처 확인 글',
        summary: '요약',
        category: '보안',
        contentHtml: '<p>본문</p>',
        publishedAt: '2026-11-01',
        tags: [],
        status: 'published',
        sections: []
    }]);
    await writeComments([]);

    const comment = { postId: 'origin-post', author: '독자', password: 'reader-pass', content: '댓글' };

    // A cross-site HTML form needs no CORS preflight, so the origin check is what stops it.
    await fromOtherSite(request(app).post('/api/comments'))
        .type('form')
        .send(comment)
        .expect(403);
    await fromOtherSite(request(app).post('/api/comments')).send(comment).expect(403);
    await request(app).post('/api/comments').send(comment).expect(403);
    assert.equal(await commentCount(), 0);

    const created = (await fromSite(request(app).post('/api/comments')).send(comment).expect(201)).body.comment;
    assert.equal(await commentCount(), 1);

    await fromOtherSite(request(app).delete(`/api/comments/${created.id}`)).send({ password: 'reader-pass' }).expect(403);
    assert.equal(await commentCount(), 1);

    await fromOtherSite(request(app).post('/api/posts/origin-post/view')).expect(403);
    const view = await fromSite(request(app).post('/api/posts/origin-post/view')).expect(200);
    assert.equal(view.body.views, 1, 'only the same-site view was counted');

    await fromSite(request(app).delete(`/api/comments/${created.id}`)).send({ password: 'reader-pass' }).expect(200);
    assert.equal(await commentCount(), 0);
});
