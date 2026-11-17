import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

// SITE_URL is read when the config module loads, so set it before importing the app.
process.env.SITE_URL = 'https://blog.example.test/';
const { default: app } = await import('../app.js');
const { writePosts } = await import('../models/postModel.js');
const { writeProfile } = await import('../models/profileModel.js');
const { defaultProfile } = await import('../utils/normalizers/profileNormalizers.js');

const readBootstrap = (html) => JSON.parse(
    html.match(/<script id="hamlog-bootstrap" type="application\/json">([\s\S]*?)<\/script>/)[1]
);

test('page bootstrap carries the site URL the server resolved', async () => {
    await writeProfile({ ...defaultProfile, siteUrl: '' });
    await writePosts([{
        id: 'url-post',
        slug: 'url-post',
        title: '주소 확인 글',
        summary: '요약',
        category: '개발',
        contentHtml: '<p>본문</p>',
        publishedAt: '2026-11-01',
        tags: [],
        status: 'published',
        sections: []
    }]);

    const home = await request(app).get('/').expect(200);
    assert.equal(readBootstrap(home.text).siteUrl, 'https://blog.example.test');
    assert.match(home.text, /<link rel="canonical" href="https:\/\/blog\.example\.test" \/>/);

    const post = await request(app).get('/posts/url-post').expect(200);
    assert.equal(readBootstrap(post.text).siteUrl, 'https://blog.example.test');

    await writeProfile({ ...defaultProfile, siteUrl: 'https://profile.example.test' });
    const profileHome = await request(app).get('/').expect(200);
    assert.equal(readBootstrap(profileHome.text).siteUrl, 'https://profile.example.test');
});
