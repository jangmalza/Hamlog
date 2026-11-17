import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import app from '../app.js';

const TRUSTED_ORIGIN = 'http://hamlog.test';
const oversizedValue = 'x'.repeat(33 * 1024);
const oversizedAdminValue = 'x'.repeat((10 * 1024 * 1024) + 1024);

const withTrustedOrigin = (requestBuilder) => requestBuilder
    .set('Origin', TRUSTED_ORIGIN)
    .set('Host', new URL(TRUSTED_ORIGIN).host);

const assertPayloadTooLarge = (response) => {
    assert.equal(response.status, 413);
    assert.equal(response.body.message, '요청 본문이 너무 큽니다.');
};

test('public JSON endpoints reject editor-sized request bodies', async () => {
    const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({ password: oversizedValue });
    assertPayloadTooLarge(loginResponse);

    const commentResponse = await withTrustedOrigin(request(app)
        .post('/api/comments'))
        .send({ padding: oversizedValue });
    assertPayloadTooLarge(commentResponse);

    const analyticsResponse = await withTrustedOrigin(request(app)
        .post('/api/analytics/visit'))
        .send({ path: '/', eventId: 'event-body-limit-0001', padding: oversizedValue });
    assertPayloadTooLarge(analyticsResponse);

    const viewResponse = await withTrustedOrigin(request(app)
        .post('/api/posts/any-post/view'))
        .send({ padding: oversizedValue });
    assertPayloadTooLarge(viewResponse);
});

test('authentication and origin checks run before admin content parsing', async () => {
    const unauthenticatedResponse = await request(app)
        .post('/api/posts')
        .send({ padding: oversizedAdminValue });

    assert.equal(unauthenticatedResponse.status, 401);

    const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({ password: process.env.ADMIN_PASSWORD ?? 'test-password' });
    const cookies = loginResponse.headers['set-cookie'];

    const untrustedResponse = await request(app)
        .post('/api/posts')
        .set('Cookie', cookies)
        .send({ padding: oversizedAdminValue });

    assert.equal(untrustedResponse.status, 403);
});

test('body parser client errors use the API JSON error format', async () => {
    const malformedResponse = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{');

    assert.equal(malformedResponse.status, 400);
    assert.match(malformedResponse.headers['content-type'], /application\/json/);
    assert.equal(malformedResponse.body.message, '요청 본문을 해석할 수 없습니다.');

    const primitiveResponse = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('null');

    assert.equal(primitiveResponse.status, 400);
    assert.match(primitiveResponse.headers['content-type'], /application\/json/);
    assert.equal(primitiveResponse.body.message, '요청 본문을 해석할 수 없습니다.');
});
