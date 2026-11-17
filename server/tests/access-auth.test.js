import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { resolveAuthMode, resolveAccessConfig } from '../config/access.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const issuer = 'https://hamlog-test.cloudflareaccess.com';
const audience = 'a'.repeat(64);
const testRoot = await mkdtemp(path.join(tmpdir(), 'hamlog-access-auth-'));
process.env.HAMLOG_DATA_DIR = path.join(testRoot, 'data');
process.env.HAMLOG_UPLOAD_DIR = path.join(testRoot, 'uploads');
process.env.AUTH_MODE = 'cloudflare-access';
process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN = issuer;
process.env.CLOUDFLARE_ACCESS_AUD = audience;
process.env.RATE_LIMIT_LOGIN_MAX = '100';
delete process.env.ADMIN_PASSWORD;

const key = await generateKeyPair('RS256');
const otherKey = await generateKeyPair('RS256');
const publicKey = { ...await exportJWK(key.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
const originalFetch = globalThis.fetch;
let unavailable = false;
let keyFetches = 0;
globalThis.fetch = async (url) => {
    assert.equal(String(url), `${issuer}/cdn-cgi/access/certs`);
    keyFetches += 1;
    if (unavailable) throw new Error('Test key service unavailable');
    return Response.json({ keys: [publicKey] });
};
after(async () => {
    globalThis.fetch = originalFetch;
    await rm(testRoot, { recursive: true, force: true });
});

const { default: app } = await import('../app.js');
const { initializeDatabase } = await import('../services/db.js');
await initializeDatabase();
const signedToken = async (claims = {}, signingKey = key.privateKey, header = {}) => new SignJWT({
    iss: issuer, aud: [audience], sub: 'owner-id', email: 'owner@example.com', type: 'app',
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300,
    ...claims
}).setProtectedHeader({ alg: 'RS256', kid: 'test-key', ...header }).sign(signingKey);
const trusted = { Host: 'hamlog.test', Origin: 'http://hamlog.test' };

test('Access config rejects missing or unsafe values instead of falling back to password', () => {
    assert.equal(resolveAuthMode({}), 'password');
    assert.throws(() => resolveAuthMode({ AUTH_MODE: 'typo' }));
    const env = { AUTH_MODE: 'cloudflare-access', CLOUDFLARE_ACCESS_TEAM_DOMAIN: issuer, CLOUDFLARE_ACCESS_AUD: audience };
    assert.deepEqual(resolveAccessConfig(env), { issuer, audience });
    for (const team of ['', 'http://hamlog-test.cloudflareaccess.com', 'localhost', 'https://evil.test', `${issuer}/other`, `${issuer}:8443`, `${issuer}@evil.test`]) {
        assert.throws(() => resolveAccessConfig({ ...env, CLOUDFLARE_ACCESS_TEAM_DOMAIN: team }));
    }
    assert.throws(() => resolveAccessConfig({ ...env, CLOUDFLARE_ACCESS_AUD: '' }));
});

test('Access mode disables passwords and rejects old cookies or spoofed identity headers', async () => {
    const config = await request(app).get('/api/auth/config');
    assert.deepEqual(config.body, { mode: 'cloudflare-access' });
    assert.equal(config.headers['cache-control'], 'no-store');
    const login = await request(app).post('/api/auth/login').send({ password: 'test-password' });
    assert.equal(login.status, 403);
    assert.equal(login.headers['set-cookie'], undefined);
    const oldToken = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const rejected = await request(app).get('/api/auth/me')
        .set('Cookie', `token=${oldToken}`)
        .set('Cf-Access-Authenticated-User-Email', 'owner@example.com');
    assert.equal(rejected.status, 401);
    const rawCookie = await request(app).get('/api/auth/me').set('Cookie', `CF_Authorization=${await signedToken()}`);
    assert.equal(rawCookie.status, 401);
});

test('origin admin pages and every sensitive API reject unauthenticated requests', async () => {
    for (const [method, path] of [
        ['get', '/admin'], ['get', '/admin/'], ['get', '/admin/api/auth/me'], ['get', '/admin/api/posts'],
        ['post', '/api/posts'], ['put', '/api/posts/missing'], ['delete', '/api/posts/missing'],
        ['get', '/api/posts/missing/revisions'], ['post', '/api/posts/missing/revisions/r/restore'],
        ['get', '/api/posts/trash/list'], ['post', '/api/posts/missing/trash/restore'], ['delete', '/api/posts/missing/permanent'],
        ['get', '/admin/api/posts/trash/list'], ['post', '/admin/api/posts/missing/trash/restore'], ['delete', '/admin/api/posts/missing/permanent'],
        ['get', '/api/comments/moderation'], ['patch', '/api/comments/moderation/missing'], ['delete', '/api/comments/moderation/missing'],
        ['get', '/admin/api/comments/moderation'], ['patch', '/admin/api/comments/moderation/missing'], ['delete', '/admin/api/comments/moderation/missing'],
        ['post', '/api/categories'], ['patch', '/api/categories/reorder'], ['delete', '/api/categories/missing'],
        ['put', '/api/profile'], ['post', '/api/uploads'], ['get', '/api/uploads/unused'],
        ['delete', '/api/uploads/unused'], ['get', '/api/analytics/summary'], ['get', '/api/preview']
    ]) {
        const response = await request(app)[method](path).set(trusted);
        assert.equal(response.status, 401, `${method} ${path}`);
    }
});

test('key lookup failure is denied, then valid Access tokens work with cached keys', async () => {
    const token = await signedToken();
    unavailable = true;
    const denied = await request(app).get('/api/auth/me').set('Cf-Access-Jwt-Assertion', token);
    unavailable = false;
    assert.equal(denied.status, 401);
    const valid = await request(app).get('/admin/api/auth/me').set('Cf-Access-Jwt-Assertion', token);
    assert.equal(valid.status, 200);
    assert.equal(valid.body.user.role, 'admin');
    assert.equal(valid.body.user.email, 'owner@example.com');
    assert.equal(valid.headers['set-cookie'], undefined);
    const count = keyFetches;
    await request(app).get('/admin/api/auth/me').set('Cf-Access-Jwt-Assertion', token).expect(200);
    assert.equal(keyFetches, count);
});

test('Access rejects expired, foreign, forged, service and malformed tokens', async () => {
    const now = Math.floor(Date.now() / 1000);
    const tokens = [
        await signedToken({ exp: now - 1 }), await signedToken({ nbf: now + 100 }),
        await signedToken({ iss: 'https://other.cloudflareaccess.com' }),
        await signedToken({ aud: ['b'.repeat(64)] }), await signedToken({}, otherKey.privateKey),
        await signedToken({ exp: undefined }), await signedToken({ email: undefined }),
        await signedToken({ type: 'service' }), await signedToken({ sub: '' }),
        jwt.sign({ iss: issuer, aud: audience, role: 'admin' }, 'attacker-secret'), 'invalid',
        await signedToken({}, key.privateKey, { kid: 'unknown-key', jku: 'http://127.0.0.1/keys' })
    ];
    for (const token of tokens) {
        const response = await request(app).get('/admin/api/auth/me').set('Cf-Access-Jwt-Assertion', token);
        assert.equal(response.status, 401);
        assert.equal(response.body.user, undefined);
    }
});

test('Access admin CRUD keeps CSRF checks and private posts stay invisible to public readers', async () => {
    const token = await signedToken();
    const headers = { ...trusted, 'Cf-Access-Jwt-Assertion': token };
    const data = {
        title: 'Access test draft', slug: `access-private-${Date.now()}`, summary: 'Private test',
        contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Private content' }] }] },
        status: 'draft', category: '테스트', tags: [], sections: []
    };
    const rejected = await request(app).post('/admin/api/posts')
        .set('Cf-Access-Jwt-Assertion', token).set('Origin', 'https://attacker.test').send(data);
    assert.equal(rejected.status, 403);
    let id;
    try {
        const created = await request(app).post('/admin/api/posts').set(headers).send(data);
        assert.equal(created.status, 201);
        id = created.body.id;
        const admin = await request(app).get('/admin/api/posts').set(headers);
        assert.ok(admin.body.posts.some(post => post.id === id));
        assert.equal(admin.headers['cache-control'], 'no-store');
        for (const optionalToken of ['', 'invalid']) {
            const publicRequest = request(app).get('/api/posts');
            if (optionalToken) publicRequest.set('Cf-Access-Jwt-Assertion', optionalToken);
            const result = await publicRequest;
            assert.equal(result.status, 200);
            assert.ok(!result.body.posts.some(post => post.id === id));
        }
        await request(app).get(`/api/posts/${data.slug}`).expect(404);
        const updated = await request(app).put(`/admin/api/posts/${id}`).set(headers)
            .send({ ...data, title: 'Updated Access draft', expectedUpdatedAt: created.body.updatedAt });
        assert.equal(updated.status, 200);
        await request(app).get(`/admin/api/posts/${id}/revisions`).set(headers).expect(200);
    } finally {
        if (id) await request(app).delete(`/admin/api/posts/${id}`).set(headers).expect(204);
    }
});

test('Access protects trash and permits private restoration and explicit permanent deletion', async () => {
    const token = await signedToken();
    const headers = { ...trusted, 'Cf-Access-Jwt-Assertion': token };
    const created = await request(app).post('/admin/api/posts').set(headers)
        .send({ title: 'Access trash test', slug: 'access-trash-test', status: 'draft' }).expect(201);
    const id = created.body.id;
    await request(app).delete(`/admin/api/posts/${id}`).set(headers).expect(204);
    const list = await request(app).get('/admin/api/posts/trash/list').set(headers).expect(200);
    assert.equal(list.headers['cache-control'], 'no-store');
    const post = list.body.posts.find(post => post.id === id);
    const restoreBody = { expectedDeletedAt: post.deletedAt };
    await request(app).post(`/admin/api/posts/${id}/trash/restore`)
        .set('Cf-Access-Jwt-Assertion', token).set('Origin', 'https://foreign.test')
        .send(restoreBody).expect(403);
    const restored = await request(app).post(`/admin/api/posts/${id}/trash/restore`).set(headers).send(restoreBody).expect(200);
    assert.equal(restored.body.status, 'draft');
    await request(app).get(`/api/posts/${post.slug}`).expect(404);
    await request(app).delete(`/admin/api/posts/${id}`).set(headers).expect(204);
    const latest = (await request(app).get('/admin/api/posts/trash/list').set(headers)).body.posts.find(post => post.id === id);
    const purgeBody = { expectedDeletedAt: latest.deletedAt, confirmTitle: latest.title };
    await request(app).delete(`/admin/api/posts/${id}/permanent`)
        .set('Cf-Access-Jwt-Assertion', token).set('Origin', 'https://foreign.test')
        .send(purgeBody).expect(403);
    await request(app).delete(`/admin/api/posts/${id}/permanent`).set(headers).send(purgeBody).expect(204);
    await request(app).get(`/admin/api/posts/${id}/revisions`).set(headers).expect(404);
});

test('Access comment moderation hides public content and keeps origin/version checks', async () => {
    const headers = { ...trusted, 'Cf-Access-Jwt-Assertion': await signedToken() };
    const created = await request(app).post('/admin/api/posts').set(headers).send({
        title: 'Access comment post', slug: 'access-comment-post', status: 'published',
        contentHtml: '<p>공개 본문</p>'
    }).expect(201);
    const comment = (await request(app).post('/api/comments').set('Origin', 'http://hamlog.test').set('Host', 'hamlog.test').send({
        postId: created.body.id, author: '독자', password: 'author-password', content: '관리할 댓글'
    }).expect(201)).body.comment;
    const listing = await request(app).get('/admin/api/comments/moderation').set(headers).expect(200);
    const target = listing.body.comments.find(item => item.id === comment.id);
    assert.equal(Object.hasOwn(target, 'password'), false);
    await request(app).patch(`/admin/api/comments/moderation/${comment.id}`).set(headers)
        .set('Origin', 'https://foreign.test').send({ hidden: true, expectedVersion: target.moderation.version }).expect(403);
    const hidden = (await request(app).patch(`/admin/api/comments/moderation/${comment.id}`).set(headers)
        .send({ hidden: true, expectedVersion: target.moderation.version }).expect(200)).body.comment;
    assert.deepEqual((await request(app).get(`/api/comments?postId=${created.body.id}`).expect(200)).body.comments, []);
    await request(app).delete(`/admin/api/comments/moderation/${comment.id}`).set(headers)
        .send({ expectedVersion: target.moderation.version }).expect(409);
    await request(app).delete(`/admin/api/comments/moderation/${comment.id}`).set(headers)
        .send({ expectedVersion: hidden.moderation.version }).expect(204);
    await request(app).delete(`/admin/api/posts/${created.body.id}`).set(headers).expect(204);
});

test('public health and content stay open; logout clears old auth and hands off to Access', async () => {
    for (const path of ['/api/health', '/api/profile', '/api/categories', '/api/posts', '/robots.txt', '/sitemap.xml', '/rss.xml']) {
        await request(app).get(path).expect(200);
    }
    await request(app).post('/api/auth/logout').expect(403);
    const response = await request(app).post('/api/auth/logout').set(trusted);
    assert.equal(response.status, 200);
    assert.equal(response.body.redirectTo, '/cdn-cgi/access/logout');
    assert.match(response.headers['set-cookie'][0], /token=;/);
});
