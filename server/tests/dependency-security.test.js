import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { mergeAttributes } from '@tiptap/core';

const require = createRequire(import.meta.url);
const expressRequire = createRequire(require.resolve('express'));
const bodyParserRequire = createRequire(expressRequire.resolve('body-parser'));
const mermaidRequire = createRequire(require.resolve('mermaid'));
const sharpRequire = createRequire(require.resolve('sharp'));
const axiosRequire = createRequire(require.resolve('axios'));
const cheerioRequire = createRequire(require.resolve('cheerio'));
const tiptapHtmlRequire = createRequire(require.resolve('@tiptap/html/server'));
const sharp = require('sharp');
const { gte } = sharpRequire('semver');

test('sharp uses a patched HEIF decoder for uploaded and public images', () => {
  // GHSA-rgj7-g3m4-5g8c: check the loaded native library, not just package.json.
  assert.ok(gte(sharp.versions.sharp, '0.35.4'), `Unpatched sharp: ${sharp.versions.sharp}`);
  assert.ok(gte(sharp.versions.heif, '1.23.2'), `Unpatched libheif: ${sharp.versions.heif}`);
});

test('sharp loads the patched native SVG decoder, including in the production image', () => {
  // GHSA-wq5f-xc86-pv6w: a patched wrapper alone does not establish which
  // librsvg is loaded when a global or platform-specific libvips is selected.
  assert.ok(gte(sharp.versions.sharp, '0.35.5'), `Unpatched sharp: ${sharp.versions.sharp}`);
  assert.equal(typeof sharp.versions.rsvg, 'string', 'The native SVG decoder must be present');
  assert.ok(gte(sharp.versions.rsvg, '2.63.2'), `Unpatched librsvg: ${sharp.versions.rsvg}`);
});

test('patched SVG decoder rasterizes and resizes an SVG to WebP without losing its colors', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24">'
    + '<rect width="32" height="24" fill="#b41464"/>'
    + '<rect width="16" height="24" fill="#1464b4"/></svg>');
  const { data, info } = await sharp(svg)
    .resize({ width: 16, withoutEnlargement: true })
    .webp({ lossless: true })
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.format, 'webp');
  assert.equal(info.width, 16);
  assert.equal(info.height, 12);
  const { data: pixels, info: decoded } = await sharp(data)
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixelAt = (x, y) => Array.from(pixels.subarray(
    (y * decoded.width + x) * decoded.channels,
    (y * decoded.width + x + 1) * decoded.channels
  ));
  assert.deepEqual(pixelAt(2, 6), [20, 100, 180]);
  assert.deepEqual(pixelAt(14, 6), [180, 20, 100]);
});

test('patched HEIF decoder still converts valid AVIF images to WebP', async () => {
  const avif = await sharp({
    create: {
      width: 32,
      height: 24,
      channels: 4,
      background: { r: 20, g: 100, b: 180, alpha: 1 }
    }
  }).avif().toBuffer();
  const { data, info } = await sharp(avif, { animated: true })
    .resize({ width: 16, withoutEnlargement: true })
    .webp({ quality: 80, animated: true })
    .toBuffer({ resolveWithObject: true });

  assert.equal(info.format, 'webp');
  assert.equal(info.width, 16);
  assert.equal(info.height, 12);
  assert.equal((await sharp(data).metadata()).format, 'webp');
});

test('Express proxy trust cannot accept spoofed forwarded IPs through cross-family subnets', () => {
  // GHSA-jqcg-44mw-7w3h: exercise the implementation Express actually resolves.
  const proxyaddr = expressRequire('proxy-addr');
  const request = {
    socket: { remoteAddress: '203.0.113.10' },
    headers: { 'x-forwarded-for': '198.51.100.23' }
  };
  for (const subnet of ['::ffff:10.0.0.0/8', '::/1']) {
    const trust = proxyaddr.compile(subnet);
    assert.equal(trust(request.socket.remoteAddress), false);
    assert.equal(trust(`::ffff:${request.socket.remoteAddress}`), false);
    assert.equal(proxyaddr(request, trust), request.socket.remoteAddress);
  }
  for (const subnet of ['10.0.0.0/8', '::ffff:10.0.0.0/104']) {
    const trust = proxyaddr.compile(subnet);
    assert.equal(trust('10.1.2.3'), true);
    assert.equal(trust('::ffff:10.1.2.3'), true);
    assert.equal(trust(request.socket.remoteAddress), false);
    assert.equal(proxyaddr({ ...request, socket: { remoteAddress: '10.1.2.3' } }, trust), request.headers['x-forwarded-for']);
  }
});

for (const [consumer, load] of [['application', require], ['Mermaid', mermaidRequire]]) {
  test(`${consumer} KaTeX rejects inherited trust even after Object.prototype pollution`, () => {
    const katex = load('katex');
    const previousTrust = Object.getOwnPropertyDescriptor(Object.prototype, 'trust');
    try {
      Object.defineProperty(Object.prototype, 'trust', { configurable: true, writable: true, value: true });
      const output = katex.renderToString('\\href{javascript:alert(1)}{click}', {
        throwOnError: false, output: 'html'
      });
      assert.doesNotMatch(output, /<a\b/i);
      assert.doesNotMatch(output, /href\s*=\s*["']\s*javascript:/i);
      const normal = katex.renderToString('\\frac{1}{2}+x^2', { throwOnError: false, output: 'html' });
      assert.match(normal, /class="katex"/);
      assert.doesNotMatch(normal, /katex-error/);
    } finally {
      if (previousTrust) Object.defineProperty(Object.prototype, 'trust', previousTrust);
      else Reflect.deleteProperty(Object.prototype, 'trust');
    }
  });
}

// GHSA-cp6q-959q-f8rh: cover the ESM and CommonJS entry points used by
// frontend code and server-side HTML extensions respectively.
for (const [entry, merge] of [
  ['ESM', mergeAttributes],
  ['CommonJS', require('@tiptap/core').mergeAttributes]
]) {
  test(`Tiptap ${entry} rejects prototype-changing DOM attributes`, () => {
    const untrusted = JSON.parse('{"__proto__":{"onerror":"alert(1)","data-inherited":"unsafe"},"alt":"safe"}');
    for (const attrs of [merge(untrusted), merge({ class: 'image' }, untrusted)]) {
      assert.equal(Object.getPrototypeOf(attrs), Object.prototype);
      // The fixed helper preserves this key as an inert own data property.
      assert.equal(Object.getOwnPropertyDescriptor(attrs, '__proto__')?.value, untrusted.__proto__);
      assert.equal('onerror' in attrs, false);
      assert.equal('data-inherited' in attrs, false);
      assert.equal(attrs.alt, 'safe');
    }
    assert.deepEqual(merge({ class: 'one' }, { class: 'two', title: 'safe' }), {
      class: 'one two', title: 'safe'
    });
  });
}

// Resolve each package the way its runtime consumer does, so an override or a
// nested copy cannot hide an unpatched version.
const resolvedVersion = (load, name) => {
  let dir = path.dirname(load.resolve(name));
  while (dir !== path.dirname(dir)) {
    const manifest = path.join(dir, 'package.json');
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      if (pkg.name === name) return pkg.version;
    }
    dir = path.dirname(dir);
  }
  throw new Error(`package.json not found for ${name}`);
};

for (const [name, consumer, load, minimum, advisories] of [
  ['body-parser', 'express', expressRequire, '1.20.9', 'GHSA-27r3-jxmh-p828'],
  ['dompurify', 'hamlog', require, '3.4.17', 'GHSA-cg2g-xh64-v4q7, GHSA-mrv2-3pqr-j5jr, GHSA-c6gr-qvv4-5v3f'],
  ['dompurify', 'mermaid', mermaidRequire, '3.4.17', 'GHSA-cg2g-xh64-v4q7, GHSA-mrv2-3pqr-j5jr, GHSA-c6gr-qvv4-5v3f'],
  ['follow-redirects', 'axios', axiosRequire, '1.16.1', 'GHSA-q3jh-wrc6-jgq8, GHSA-8r9p-f939-6h3c'],
  ['happy-dom', '@tiptap/html', tiptapHtmlRequire, '21.0.4', 'GHSA-834v-8h66-3h79'],
  ['undici', 'cheerio', cheerioRequire, '7.30.1', 'GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472, GHSA-xjj6-f33q-929c']
]) {
  test(`${consumer} resolves patched ${name} (${advisories})`, () => {
    const version = resolvedVersion(load, name);
    assert.ok(gte(version, minimum), `Unpatched ${name} for ${consumer}: ${version}`);
  });
}

for (const [consumer, load] of [['express', expressRequire], ['body-parser', bodyParserRequire]]) {
  const qs = load('qs');

  test(`${consumer} qs enforces comma-array limits for bracket keys`, () => {
    // GHSA-x5fp-wj9c-mxmx: a tiny payload exercises the limit without allocating a large array.
    const options = { comma: true, arrayLimit: 3, throwOnLimitExceeded: true };
    assert.throws(() => qs.parse('items[]=1,2,3,4', options), RangeError);
    assert.deepEqual(qs.parse('items=1,2,3', options), { items: ['1', '2', '3'] });
  });

  test(`${consumer} qs safely round-trips a user-controlled isBuffer field`, () => {
    // GHSA-4mjr-xmp4-gh2g: the parsed constructor field must not be invoked.
    const input = 'item[constructor][isBuffer]=not-a-function';
    for (const options of [{ plainObjects: true }, { allowPrototypes: true }]) {
      const parsed = qs.parse(input, options);
      assert.doesNotThrow(() => qs.stringify(parsed));
      assert.deepEqual(qs.parse(qs.stringify(parsed), options), parsed);
    }
  });
}
