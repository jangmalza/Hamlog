import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import request from 'supertest';
import app from '../app.js';
import { uploadDir } from '../config/paths.js';
import { createDistCacheHeaders, setUploadCacheHeaders } from '../utils/staticCache.js';

const fakeResponse = () => {
    const headers = {};
    return { headers, setHeader: (name, value) => { headers[name.toLowerCase()] = value; } };
};

test('hashed build assets are cached for a year, other dist files are not', () => {
    const distDir = path.join(path.sep, 'app', 'dist');
    const setHeaders = createDistCacheHeaders(distDir);

    const asset = fakeResponse();
    setHeaders(asset, path.join(distDir, 'assets', 'react-vendor-9JMnJlme.js'));
    assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable');

    for (const file of ['index.html', 'favicon.svg', 'manifest.json']) {
        const response = fakeResponse();
        setHeaders(response, path.join(distDir, file));
        assert.equal(response.headers['cache-control'], undefined, file);
    }
});

test('uploaded files are served with a 30-day cache', async (t) => {
    await mkdir(uploadDir, { recursive: true });
    const filename = 'upload-cache-check.webp';
    await writeFile(path.join(uploadDir, filename), 'image');
    t.after(() => rm(path.join(uploadDir, filename), { force: true }));

    const response = await request(app).get(`/uploads/${filename}`).expect(200);
    assert.equal(response.headers['cache-control'], 'public, max-age=2592000');

    const direct = fakeResponse();
    setUploadCacheHeaders(direct);
    assert.equal(direct.headers['cache-control'], 'public, max-age=2592000');
});
