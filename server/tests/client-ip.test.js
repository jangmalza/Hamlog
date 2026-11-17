import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../app.js';
import { isInternalAddress, resolveClientIp } from '../utils/clientIp.js';

const fakeRequest = (ip, headers = {}) => ({
    ip,
    get: (name) => headers[name.toLowerCase()]
});

test('internal peers are recognised, including IPv4-mapped IPv6', () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '172.17.0.1', '::ffff:172.17.0.1', '10.1.2.3', '192.168.0.5', 'fd00::1', 'fe80::1']) {
        assert.equal(isInternalAddress(address), true, address);
    }
    for (const address of ['203.0.113.9', '2001:db8::1', '100.64.0.1', '', 'not-an-ip', undefined]) {
        assert.equal(isInternalAddress(address), false, String(address));
    }
});

test('the Cloudflare visitor address is used only behind an internal hop', () => {
    assert.equal(resolveClientIp(fakeRequest('::ffff:172.17.0.1', { 'cf-connecting-ip': '203.0.113.9' })), '203.0.113.9');
    assert.equal(resolveClientIp(fakeRequest('127.0.0.1', { 'cf-connecting-ip': '2001:db8::7' })), '2001:db8::7');
    // A public peer cannot choose its own rate-limit key.
    assert.equal(resolveClientIp(fakeRequest('198.51.100.4', { 'cf-connecting-ip': '203.0.113.9' })), '198.51.100.4');
    // Missing or malformed headers keep the socket address.
    assert.equal(resolveClientIp(fakeRequest('127.0.0.1')), '127.0.0.1');
    assert.equal(resolveClientIp(fakeRequest('127.0.0.1', { 'cf-connecting-ip': '203.0.113.9, 10.0.0.1' })), '127.0.0.1');
});

test('failed logins from different visitors behind the tunnel do not share a limit', async () => {
    for (let index = 1; index <= 11; index += 1) {
        const response = await request(app)
            .post('/api/auth/login')
            .set('CF-Connecting-IP', `203.0.113.${index}`)
            .send({ password: 'wrong-password' });
        assert.equal(response.status, 401, `visitor ${index} is not throttled by other visitors`);
    }

    const statuses = [];
    for (let attempt = 1; attempt <= 11; attempt += 1) {
        const response = await request(app)
            .post('/api/auth/login')
            .set('CF-Connecting-IP', '198.51.100.7')
            .send({ password: 'wrong-password' });
        statuses.push(response.status);
    }
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401));
    assert.equal(statuses[10], 429, 'the same visitor is still limited');
});

test('unauthenticated upload attempts do not consume the upload limit', async () => {
    for (let attempt = 1; attempt <= 31; attempt += 1) {
        const response = await request(app)
            .post('/api/uploads')
            .set('CF-Connecting-IP', '198.51.100.20')
            .send({});
        assert.equal(response.status, 401, `attempt ${attempt} is rejected by authentication, not the rate limit`);
    }
});
