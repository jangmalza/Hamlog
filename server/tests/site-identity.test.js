import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../app.js';
import { readProfile, writeProfile } from '../models/profileModel.js';
import { resolveSiteBaseUrl } from '../config/site.js';
import {
    defaultProfile,
    mergeProfile,
    normalizeProfile
} from '../utils/normalizers/profileNormalizers.js';
import { formatHomeTitle, resolveHomeKeywords } from '../utils/siteIdentity.js';

const withoutIdentityFields = ({ titleSuffix, keywords, ...profile }) => {
    void titleSuffix;
    void keywords;
    return profile;
};

test('profiles saved before identity fields existed keep the previously rendered title and keywords', async () => {
    await writeProfile(withoutIdentityFields({
        ...defaultProfile,
        title: 'Hyeonwoo 기술 블로그',
        siteUrl: 'https://blog.example.test',
        stack: ['Tencent']
    }));

    const response = await request(app).get('/');

    assert.equal(response.status, 200);
    assert.match(response.text, /<title>Hyeonwoo 기술 블로그 \| 클라우드 엔지니어링과 개발 기록<\/title>/);
    assert.match(
        response.text,
        /<meta name="keywords" content="클라우드 엔지니어링, DevOps, 인프라, AWS, GCP, Kubernetes, Tencent" \/>/
    );
    assert.match(response.text, /<link rel="canonical" href="https:\/\/blog\.example\.test" \/>/);
});

test('new installations start without site-specific title suffix, keywords, or site URL', async () => {
    await writeProfile(defaultProfile);
    const profile = await readProfile();

    assert.equal(profile.titleSuffix, '');
    assert.deepEqual(profile.keywords, []);
    assert.equal(profile.siteUrl, '');

    const response = await request(app).get('/');
    assert.match(response.text, /<title>Blog Title<\/title>/);
    assert.match(response.text, /<meta name="keywords" content="" \/>/);
    assert.doesNotMatch(response.text, /hamwoo|클라우드 엔지니어링/i);
});

test('cleared identity fields stay cleared instead of falling back to legacy values', () => {
    const legacy = normalizeProfile(withoutIdentityFields(defaultProfile));
    assert.ok(legacy.titleSuffix);
    assert.ok(legacy.keywords.length > 0);

    const cleared = normalizeProfile(mergeProfile(legacy, { titleSuffix: '  ', keywords: [], siteUrl: '' }));

    assert.equal(cleared.titleSuffix, '');
    assert.deepEqual(cleared.keywords, []);
    assert.equal(cleared.siteUrl, '');
});

test('updates keep identity fields that the request does not mention', () => {
    const current = normalizeProfile({ ...defaultProfile, titleSuffix: '운영 기록', keywords: ['SRE'] });
    const next = normalizeProfile(mergeProfile(current, { title: '새 제목' }));

    assert.equal(next.titleSuffix, '운영 기록');
    assert.deepEqual(next.keywords, ['SRE']);
});

test('home title and keywords follow the profile', () => {
    assert.equal(formatHomeTitle({ title: 'Blog', titleSuffix: '기록' }), 'Blog | 기록');
    assert.equal(formatHomeTitle({ title: 'Blog | 이미 완성', titleSuffix: '기록' }), 'Blog | 이미 완성');
    assert.equal(formatHomeTitle({ title: 'Blog', titleSuffix: ' ' }), 'Blog');
    assert.equal(formatHomeTitle({}), 'Hamlog');
    assert.deepEqual(
        resolveHomeKeywords({ keywords: ['AWS', ' SRE '], stack: ['AWS', 'Go'] }),
        ['AWS', 'SRE', 'Go']
    );
});

test('the profile site URL wins and an unset one falls back to a well-formed local URL', () => {
    assert.equal(resolveSiteBaseUrl({ siteUrl: 'https://blog.example.test/' }), 'https://blog.example.test');
    assert.match(resolveSiteBaseUrl({ siteUrl: '' }), /^http:\/\/localhost:\d+$/);
    assert.match(resolveSiteBaseUrl({ siteUrl: 'not-a-url' }), /^http:\/\/localhost:\d+$/);
});
