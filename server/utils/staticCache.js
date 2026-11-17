import path from 'node:path';

const IMMUTABLE_FOR_A_YEAR = 'public, max-age=31536000, immutable';
const THIRTY_DAYS = 'public, max-age=2592000';

// Vite writes every file under dist/assets with a content hash in its name, so a
// changed file always gets a new URL. Other dist files (index.html, favicon,
// manifest) keep stable names and stay revalidated.
export const createDistCacheHeaders = (distDir) => (res, filePath) => {
    const [topLevel] = path.relative(distDir, filePath).split(path.sep);
    if (topLevel === 'assets') {
        res.setHeader('Cache-Control', IMMUTABLE_FOR_A_YEAR);
    }
};

// Uploads get random names and are never rewritten in place; a month avoids
// revalidation while still letting deleted files drop out of caches.
export const setUploadCacheHeaders = (res) => {
    res.setHeader('Cache-Control', THIRTY_DAYS);
};
