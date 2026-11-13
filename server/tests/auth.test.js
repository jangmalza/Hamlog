import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../app.js';

test('POST /api/auth/login should reject invalid password', async () => {
    const response = await request(app)
        .post('/api/auth/login')
        .send({ password: 'not-valid-password' });

    assert.equal(response.status, 401);
    assert.equal(response.body.message, '비밀번호가 올바르지 않습니다.');
});

test('POST /api/auth/login should reject non-string and partial passwords', async () => {
    for (const password of [
        undefined,
        null,
        123,
        ['test-password'],
        { toString: 'test-password' },
        'test-passwor',
        'test-password-extra'
    ]) {
        const response = await request(app)
            .post('/api/auth/login')
            .send({ password });

        assert.equal(response.status, 401, `password ${JSON.stringify(password)} must be rejected`);
        assert.equal(response.headers['set-cookie'], undefined);
    }
});

test('POST /api/auth/login should issue cross-site compatible cookie when CORS origins are configured', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousCorsOrigins = process.env.CORS_ORIGINS;
    const previousCookieSameSite = process.env.COOKIE_SAME_SITE;
    const previousCookieSecure = process.env.COOKIE_SECURE;

    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = 'https://admin.example.com';
    delete process.env.COOKIE_SAME_SITE;
    delete process.env.COOKIE_SECURE;

    try {
        const response = await request(app)
            .post('/api/auth/login')
            .set('Origin', 'https://admin.example.com')
            .send({ password: process.env.ADMIN_PASSWORD ?? 'test-password' });

        assert.equal(response.status, 200);

        const setCookie = response.headers['set-cookie']?.[0] ?? '';
        assert.match(setCookie, /SameSite=None/i);
        assert.match(setCookie, /Secure/i);
        assert.match(setCookie, /Path=\//i);
    } finally {
        process.env.NODE_ENV = previousNodeEnv;
        process.env.CORS_ORIGINS = previousCorsOrigins;

        if (previousCookieSameSite === undefined) {
            delete process.env.COOKIE_SAME_SITE;
        } else {
            process.env.COOKIE_SAME_SITE = previousCookieSameSite;
        }

        if (previousCookieSecure === undefined) {
            delete process.env.COOKIE_SECURE;
        } else {
            process.env.COOKIE_SECURE = previousCookieSecure;
        }
    }
});

test('POST /api/auth/login should avoid secure cookie for direct HTTP same-origin access', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousCorsOrigins = process.env.CORS_ORIGINS;
    const previousCookieSameSite = process.env.COOKIE_SAME_SITE;
    const previousCookieSecure = process.env.COOKIE_SECURE;

    process.env.NODE_ENV = 'production';
    delete process.env.CORS_ORIGINS;
    delete process.env.COOKIE_SAME_SITE;
    delete process.env.COOKIE_SECURE;

    try {
        const response = await request(app)
            .post('/api/auth/login')
            .send({ password: process.env.ADMIN_PASSWORD ?? 'test-password' });

        assert.equal(response.status, 200);

        const setCookie = response.headers['set-cookie']?.[0] ?? '';
        assert.match(setCookie, /SameSite=Lax/i);
        assert.doesNotMatch(setCookie, /Secure/i);
    } finally {
        process.env.NODE_ENV = previousNodeEnv;
        process.env.CORS_ORIGINS = previousCorsOrigins;

        if (previousCookieSameSite === undefined) {
            delete process.env.COOKIE_SAME_SITE;
        } else {
            process.env.COOKIE_SAME_SITE = previousCookieSameSite;
        }

        if (previousCookieSecure === undefined) {
            delete process.env.COOKIE_SECURE;
        } else {
            process.env.COOKIE_SECURE = previousCookieSecure;
        }
    }
});

test('POST /api/auth/logout should require a trusted request origin', async () => {
    const rejected = await request(app).post('/api/auth/logout');
    assert.equal(rejected.status, 403);

    const accepted = await request(app)
        .post('/api/auth/logout')
        .set('Origin', 'http://hamlog.test')
        .set('Host', 'hamlog.test');

    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.message, '로그아웃 성공');
});
