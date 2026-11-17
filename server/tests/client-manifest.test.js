import test from 'node:test';
import assert from 'node:assert/strict';
import { injectModulePreloads, resolvePagePreloads } from '../utils/clientManifest.js';

const manifest = {
    'index.html': { file: 'assets/index-entry.js', isEntry: true, imports: ['_react-vendor.js', '_icon-vendor.js'] },
    '_react-vendor.js': { file: 'assets/react-vendor.js' },
    '_icon-vendor.js': { file: 'assets/icon-vendor.js' },
    '_shared.js': { file: 'assets/shared.js', imports: ['_react-vendor.js', '_nested.js'] },
    '_nested.js': { file: 'assets/nested.js' },
    'src/pages/PostPage.tsx': {
        file: 'assets/PostPage.js',
        isDynamicEntry: true,
        imports: ['_react-vendor.js', 'index.html', '_shared.js', '_icon-vendor.js'],
        dynamicImports: ['src/components/MermaidContent.tsx']
    },
    'src/components/MermaidContent.tsx': { file: 'assets/MermaidContent.js', isDynamicEntry: true }
};

test('a lazy page preloads only its static chunks that the entry does not load', () => {
    assert.deepEqual(
        resolvePagePreloads(manifest, 'src/pages/PostPage.tsx'),
        ['assets/PostPage.js', 'assets/shared.js', 'assets/nested.js']
    );
    assert.deepEqual(resolvePagePreloads(manifest, 'src/pages/Missing.tsx'), []);
    assert.deepEqual(resolvePagePreloads(null, 'src/pages/PostPage.tsx'), []);
});

test('preload tags are added to the head, and nothing changes without files', () => {
    const html = '<html><head><title>x</title></head><body></body></html>';
    assert.equal(injectModulePreloads(html, []), html);
    const withTags = injectModulePreloads(html, ['assets/PostPage.js', 'assets/$&.js']);
    assert.match(withTags, /<link rel="modulepreload" crossorigin href="\/assets\/PostPage\.js" \/>/);
    assert.ok(withTags.includes('href="/assets/$&amp;.js"'), 'file names are escaped and inserted literally');
    assert.ok(withTags.indexOf('modulepreload') < withTags.indexOf('</head>'));
});
