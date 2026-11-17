import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../app.js';
import { writePosts } from '../models/postModel.js';
import { writeProfile } from '../models/profileModel.js';
import { defaultProfile } from '../utils/normalizers/profileNormalizers.js';
import { injectAppRootContent, injectJsonData, replaceHeadTag } from '../utils/seoHtml.js';

// String.prototype.replace expands $&, $', $`, $1 and $$ in replacement strings.
// Shell and regex examples in posts contain exactly these sequences.
const DOLLAR_PATTERNS = "IFS=$'\\n' sed 's/(a)/$1/' echo $& $` $$";

const shell = '<html><head><title>old</title></head><body><div id="root"></div></body></html>';

const readBootstrap = (html) => {
    const match = html.match(/<script id="hamlog-bootstrap" type="application\/json">([\s\S]*?)<\/script>/);
    assert.ok(match, 'bootstrap script is present');
    return JSON.parse(match[1]);
};

test('HTML helpers insert replacement text literally', () => {
    const title = replaceHeadTag(shell, /<title>.*?<\/title>/, `<title>${DOLLAR_PATTERNS}</title>`);
    assert.ok(title.includes(`<title>${DOLLAR_PATTERNS}</title>`));
    assert.equal((title.match(/<title>/g) || []).length, 1);

    const appended = replaceHeadTag(shell, /<meta name="missing">/, `<meta name="x" content="${DOLLAR_PATTERNS}">`);
    assert.ok(appended.includes(`<meta name="x" content="${DOLLAR_PATTERNS}">\n</head>`));

    const body = injectAppRootContent(shell, `<p>${DOLLAR_PATTERNS}</p>`);
    assert.ok(body.includes(`<div id="prerender-root"><p>${DOLLAR_PATTERNS}</p></div><div id="root"></div>`));
    assert.equal((body.match(/<div id="root">/g) || []).length, 1);

    const data = injectJsonData(shell, 'hamlog-bootstrap', { text: DOLLAR_PATTERNS });
    assert.deepEqual(readBootstrap(data), { text: DOLLAR_PATTERNS });
});

test('post and home pages keep $ sequences from posts and the profile intact', async () => {
    await writeProfile({ ...defaultProfile, title: `Shell $' Blog`, description: `Notes about $1 and $& in scripts.` });
    await writePosts([
        {
            id: 'dollar-post',
            slug: 'dollar-post',
            title: `Bash $'...' quoting and $1`,
            summary: `Using $& and $' safely`,
            category: 'Shell',
            contentHtml: `<p>${DOLLAR_PATTERNS}</p><pre><code class="language-bash">IFS=$'\\n'\nsed 's/(a)/$1/'</code></pre>`,
            publishedAt: '2026-11-01',
            tags: [],
            status: 'published',
            sections: []
        }
    ]);

    const postResponse = await request(app).get('/posts/dollar-post');
    assert.equal(postResponse.status, 200);
    assert.equal((postResponse.text.match(/<div id="root">/g) || []).length, 1);
    assert.equal((postResponse.text.match(/<\/head>/g) || []).length, 1);
    const postBootstrap = readBootstrap(postResponse.text);
    assert.equal(postBootstrap.post.title, `Bash $'...' quoting and $1`);
    assert.match(postResponse.text, /<title>Bash \$&#39;\.\.\.&#39; quoting and \$1/);
    assert.ok(postResponse.text.includes("sed &#39;s/(a)/$1/&#39;"), 'code text is rendered literally');

    const homeResponse = await request(app).get('/');
    assert.equal(homeResponse.status, 200);
    assert.equal((homeResponse.text.match(/<div id="root">/g) || []).length, 1);
    assert.equal(readBootstrap(homeResponse.text).profile.title, `Shell $' Blog`);
    assert.match(homeResponse.text, /<title>Shell \$&#39; Blog/);
});
