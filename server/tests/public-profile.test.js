import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../app.js';
import { writePosts } from '../models/postModel.js';
import { writeProfile } from '../models/profileModel.js';
import { defaultProfile } from '../utils/normalizers/profileNormalizers.js';

const EMAIL = 'hidden-author@example.test';
const LOCATION = '숨긴 동네';

const writeHiddenProfile = (display) => writeProfile({
    ...defaultProfile,
    email: EMAIL,
    location: LOCATION,
    display: { ...defaultProfile.display, ...display }
});

const login = async () => (await request(app)
    .post('/api/auth/login')
    .send({ password: process.env.ADMIN_PASSWORD })
    .expect(200)).headers['set-cookie'];

test('hidden email and location never leave the server for readers', async () => {
    await writeHiddenProfile({ showEmail: false, showLocation: false });
    await writePosts([{
        id: 'profile-post',
        slug: 'profile-post',
        title: '프로필 확인 글',
        summary: '요약',
        category: '개발',
        contentHtml: '<p>본문</p>',
        publishedAt: '2026-11-01',
        tags: [],
        status: 'published',
        sections: []
    }]);

    const publicProfile = (await request(app).get('/api/profile').expect(200)).body.profile;
    assert.equal(publicProfile.email, '');
    assert.equal(publicProfile.location, '');
    assert.equal(publicProfile.display.showEmail, false);

    for (const path of ['/', '/posts/profile-post']) {
        const page = await request(app).get(path).expect(200);
        assert.ok(!page.text.includes(EMAIL), `${path} does not contain the hidden email`);
        assert.ok(!page.text.includes(LOCATION), `${path} does not contain the hidden location`);
    }
});

test('the admin still receives the full profile so saving keeps hidden fields', async () => {
    await writeHiddenProfile({ showEmail: false, showLocation: false });
    const cookies = await login();
    const adminProfile = (await request(app).get('/api/profile').set('Cookie', cookies).expect(200)).body.profile;
    assert.equal(adminProfile.email, EMAIL);
    assert.equal(adminProfile.location, LOCATION);
});

test('shown fields stay public', async () => {
    await writeHiddenProfile({ showEmail: true, showLocation: true });
    const publicProfile = (await request(app).get('/api/profile').expect(200)).body.profile;
    assert.equal(publicProfile.email, EMAIL);
    assert.equal(publicProfile.location, LOCATION);
});
