import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml } from './seoHtml.js';

const DEFAULT_MANIFEST_PATH = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../dist/.vite/manifest.json'
);
const ENTRY_KEY = 'index.html';

// The build output only changes with a new image, so one read per process is enough.
// null means "no manifest" (development server or tests without a build).
let cachedManifest;

export async function readClientManifest() {
    if (cachedManifest !== undefined) return cachedManifest;
    try {
        cachedManifest = JSON.parse(await readFile(DEFAULT_MANIFEST_PATH, 'utf8'));
    } catch {
        cachedManifest = null;
    }
    return cachedManifest;
}

const collectStaticChunks = (manifest, key, files = new Set(), seen = new Set()) => {
    if (seen.has(key)) return files;
    seen.add(key);
    const chunk = manifest?.[key];
    if (!chunk?.file) return files;
    files.add(chunk.file);
    for (const child of chunk.imports ?? []) collectStaticChunks(manifest, child, files, seen);
    return files;
};

// A lazily loaded page is only discovered after the entry script runs, so its
// chunks used to download one round trip late. These are the page's static
// chunks that index.html does not already load; dynamic imports stay lazy.
export const resolvePagePreloads = (manifest, pageKey) => {
    if (!manifest?.[pageKey]) return [];
    const alreadyLoaded = collectStaticChunks(manifest, ENTRY_KEY);
    return [...collectStaticChunks(manifest, pageKey)].filter(file => !alreadyLoaded.has(file));
};

export const injectModulePreloads = (html, files) => {
    if (!files.length) return html;
    const tags = files
        .map(file => `<link rel="modulepreload" crossorigin href="/${escapeHtml(file)}" />`)
        .join('\n  ');
    return html.replace('</head>', () => `  ${tags}\n</head>`);
};
