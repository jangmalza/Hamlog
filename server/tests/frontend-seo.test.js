import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildImageVariantSrcSet,
  buildImageVariantUrl,
  canOptimizeImageUrl
} from '../../src/utils/imageUrl.ts';
import {
  createDefaultImageAlt,
  isGenericImageAlt,
  resolveMeaningfulImageAlt
} from '../../src/editor/utils/imageAlt.ts';

const readProjectFile = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('image variants only rewrite allowlisted local image paths', () => {
  assert.equal(
    buildImageVariantUrl('/uploads/diagram-image.png', { width: 640, height: 360 }),
    '/api/images/diagram-image.png?width=640&height=341'
  );
  assert.equal(
    buildImageVariantUrl('/avatar.jpg', { width: 96, height: 96 }),
    '/api/images/avatar.jpg?width=96&height=96'
  );
  assert.equal(
    buildImageVariantUrl('/uploads/avatar.jpg', { width: 96, height: 96 }),
    '/uploads/avatar.jpg'
  );
  assert.equal(buildImageVariantUrl('https://cdn.example.com/image.jpg', { width: 640 }), 'https://cdn.example.com/image.jpg');
  assert.equal(buildImageVariantUrl('data:image/png;base64,abc', { width: 640 }), 'data:image/png;base64,abc');
  assert.equal(buildImageVariantUrl('/uploads/diagram image.png', { width: 640 }), '/uploads/diagram image.png');
  assert.equal(buildImageVariantUrl('/uploads/%2e%2e%2fsecret.jpg', { width: 640 }), '/uploads/%2e%2e%2fsecret.jpg');
  assert.equal(buildImageVariantUrl('/uploads/readme.txt', { width: 640 }), '/uploads/readme.txt');
  assert.equal(buildImageVariantUrl('/uploads/cover.webp', { width: 100 }), '/api/images/cover.webp?width=96');
  assert.equal(buildImageVariantUrl('/uploads/cover.webp', { width: 2500 }), '/api/images/cover.webp?width=1920');
  assert.equal(canOptimizeImageUrl('/other/image.jpg'), false);
  assert.equal(
    buildImageVariantSrcSet('/uploads/cover.webp', [
      { width: 320, descriptor: '320w' },
      { width: 640, descriptor: '640w' }
    ]),
    '/api/images/cover.webp?width=320 320w, /api/images/cover.webp?width=640 640w'
  );
});

test('image alt defaults remove extensions and reject generic generated names', () => {
  assert.equal(createDefaultImageAlt('kubernetes-deployment-flow.png'), 'kubernetes deployment flow');
  assert.equal(createDefaultImageAlt('/uploads/upload-1786354000000-id.webp'), '');
  assert.equal(isGenericImageAlt('image-1'), true);
  assert.equal(createDefaultImageAlt('Screenshot_2026-08-10.png'), '');
  assert.equal(isGenericImageAlt('서비스 배포 흐름도'), false);
  assert.equal(resolveMeaningfulImageAlt({
    existingAlt: 'image.png',
    caption: '서비스 배포 흐름도',
    context: '무시되는 문맥',
    src: '/uploads/upload-1786354000000-id.webp'
  }), '서비스 배포 흐름도');
  assert.equal(resolveMeaningfulImageAlt({
    existingAlt: 'screenshot',
    src: '/uploads/kubernetes-cluster-overview.png'
  }), 'kubernetes cluster overview');
});

test('static SEO assets expose RSS discovery without false OG dimensions', async () => {
  const [indexHtml, manifest, stylesheet, favicon] = await Promise.all([
    readProjectFile('index.html'),
    readProjectFile('public/manifest.json'),
    readProjectFile('src/index.css'),
    readProjectFile('public/favicon.svg')
  ]);

  assert.match(indexHtml, /rel="alternate" type="application\/rss\+xml"/);
  assert.match(indexHtml, /rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"/);
  assert.doesNotMatch(indexHtml, /og:image:(?:width|height)/);
  assert.match(indexHtml, /rel="stylesheet" href="https:\/\/fonts\.googleapis\.com/);
  assert.match(indexHtml, /family=Noto\+Serif\+KR:wght@400;600;700/);
  assert.doesNotMatch(stylesheet, /@import\s+url\(['"]https:\/\/fonts\.googleapis\.com/);
  assert.match(stylesheet, /--font-public:\s*'Noto Serif KR'/);
  assert.match(stylesheet, /\.public-site\s*\{[^}]*--font-body:\s*var\(--font-public\)/s);
  assert.match(stylesheet, /\.prerender-shell\s*\{[^}]*font-family:\s*var\(--font-public\)/s);
  assert.match(stylesheet, /\.prerender-post-grid\s*\{[^}]*display:\s*grid/s);
  assert.match(stylesheet, /--accent:\s*#2563eb/);
  assert.match(indexHtml, /name="theme-color" content="#2563eb"/);
  assert.equal(JSON.parse(manifest).name, 'Hamlog');
  assert.match(manifest, /"theme_color": "#2563eb"/);
  assert.match(manifest, /"src": "\/favicon\.svg"/);
  assert.match(favicon, /fill="#2563eb"/);
});

test('editor insertion UI reserves H1 for the page title and exposes alt editing', async () => {
  const [toolbar, slashRegistry, imageComponent] = await Promise.all([
    readProjectFile('src/components/editor/EditorToolbar.tsx'),
    readProjectFile('src/editor/slashCommands/registry.ts'),
    readProjectFile('src/components/editor/extensions/ImageComponent.tsx')
  ]);

  assert.match(toolbar, /option\.value !== 'h1'/);
  assert.doesNotMatch(slashRegistry, /setNode\('heading', \{ level: 1 \}\)/);
  assert.match(slashRegistry, /페이지 제목은 H1/);
  assert.match(imageComponent, /이미지 대체 텍스트/);
});
