import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';

// Config
import { uploadDir } from './config/paths.js';
import { AUTH_MODE } from './config/auth.js';
import { authenticateToken } from './middleware/auth.js';
import { resolveCorsOptions, resolveTrustProxy } from './config/security.js';
import { readProfile } from './models/profileModel.js';
import { readCategories } from './models/categoryModel.js';
import { getAllPostsService } from './services/postService.js';

// Routers
import { categoryRouter } from './routes/categories.js';
import { postRouter } from './routes/posts.js';
import { profileRouter } from './routes/profile.js';
import { uploadRouter } from './routes/uploads.js';
import { healthRouter } from './routes/health.js';
import { seoRouter } from './routes/seo.js';
import { commentRouter } from './routes/comments.js';
import { authRouter } from './routes/auth.js';
import { previewRouter } from './routes/preview.js';
import { analyticsRouter } from './routes/analytics.js';
import { publicImageRouter } from './routes/images.js';
import { searchPosts } from './controllers/searchController.js';
import { getRobots, injectPostMeta } from './controllers/seoController.js';
import { createHttpsRedirectMiddleware } from './middleware/httpsRedirect.js';
import { searchRateLimiter } from './middleware/rateLimit.js';
import { handleBodyParserError } from './middleware/bodyParser.js';
import { readSpaIndexHtml } from './utils/spaIndex.js';
import { resolveSiteBaseUrl } from './config/site.js';
import {
    DEFAULT_SITE_DESCRIPTION,
    DEFAULT_SITE_TITLE,
    formatHomeTitle,
    resolveHomeKeywords
} from './utils/siteIdentity.js';
import { injectSearchVerificationMeta } from './utils/searchVerification.js';
import {
    buildHomePrerenderContent,
    buildNotFoundPrerenderContent,
    resolveHomeMetaDescription,
    resolveSeoFavicon
} from './utils/seoContent.js';
import {
    escapeHtml,
    injectAppRootContent,
    injectJsonData,
    replaceHeadTag,
    toAbsoluteUrl
} from './utils/seoHtml.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', resolveTrustProxy());
const cspDirectives = {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    connectSrc: ["'self'", 'https:'],
    frameSrc: ["'self'", 'https://www.youtube.com', 'https://www.youtube-nocookie.com'],
    mediaSrc: ["'self'", 'data:', 'blob:'],
    manifestSrc: ["'self'"],
    formAction: ["'self'"]
};

if (process.env.NODE_ENV === 'production') {
    cspDirectives.upgradeInsecureRequests = [];
}

const resolveHomeDescription = (profile) => (
    resolveHomeMetaDescription(profile, DEFAULT_SITE_DESCRIPTION)
);
const buildHomeSchema = (profile, baseUrl, description) => JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: String(profile?.title ?? '').trim() || DEFAULT_SITE_TITLE,
    description,
    url: baseUrl,
    publisher: {
        '@type': 'Person',
        name: String(profile?.name ?? '').trim() || DEFAULT_SITE_TITLE
    },
    inLanguage: 'ko-KR'
}).replace(/</g, '\\u003c');

const injectHomeSeoMeta = (html, profile, posts = [], categories = []) => {
    const baseUrl = resolveSiteBaseUrl(profile);
    const title = formatHomeTitle(profile);
    const description = resolveHomeDescription(profile);
    const keywords = resolveHomeKeywords(profile).join(', ');
    const author = String(profile?.name ?? '').trim() || DEFAULT_SITE_TITLE;
    const siteName = String(profile?.title ?? '').trim() || DEFAULT_SITE_TITLE;
    const favicon = toAbsoluteUrl(baseUrl, resolveSeoFavicon(profile));
    const image = toAbsoluteUrl(baseUrl, profile?.profileImage || profile?.favicon || '/avatar.jpg');
    const schema = buildHomeSchema(profile, baseUrl, description);

    let nextHtml = html;
    nextHtml = replaceHeadTag(nextHtml, /<title>.*?<\/title>/, `<title>${escapeHtml(title)}</title>`);
    nextHtml = replaceHeadTag(
        nextHtml,
        /<meta name="description" content=".*?" \/>/,
        `<meta name="description" content="${escapeHtml(description)}" />`
    );
    nextHtml = replaceHeadTag(
        nextHtml,
        /<meta name="keywords" content=".*?" \/>/,
        `<meta name="keywords" content="${escapeHtml(keywords)}" />`
    );
    nextHtml = replaceHeadTag(
        nextHtml,
        /<meta name="author" content=".*?" \/>/,
        `<meta name="author" content="${escapeHtml(author)}" />`
    );
    nextHtml = replaceHeadTag(
        nextHtml,
        /<meta property="og:title" content=".*?" \/>/,
        `<meta property="og:title" content="${escapeHtml(title)}" />`
    );
    nextHtml = replaceHeadTag(
        nextHtml,
        /<meta property="og:description" content=".*?" \/>/,
        `<meta property="og:description" content="${escapeHtml(description)}" />`
    );
    nextHtml = replaceHeadTag(
        nextHtml,
        /<meta property="og:url" content=".*?" \/>/,
        `<meta property="og:url" content="${escapeHtml(baseUrl)}" />`
    );
    nextHtml = replaceHeadTag(
        nextHtml,
        /<meta property="og:image" content=".*?" \/>/,
        `<meta property="og:image" content="${escapeHtml(image)}" />`
    );
    nextHtml = replaceHeadTag(
        nextHtml,
        /<meta property="og:site_name" content=".*?" \/>/,
        `<meta property="og:site_name" content="${escapeHtml(siteName)}" />`
    );
    nextHtml = replaceHeadTag(
        nextHtml,
        /<meta name="twitter:title" content=".*?" \/>/,
        `<meta name="twitter:title" content="${escapeHtml(title)}" />`
    );
    nextHtml = replaceHeadTag(
        nextHtml,
        /<meta name="twitter:description" content=".*?" \/>/,
        `<meta name="twitter:description" content="${escapeHtml(description)}" />`
    );
    nextHtml = replaceHeadTag(
        nextHtml,
        /<meta name="twitter:image" content=".*?" \/>/,
        `<meta name="twitter:image" content="${escapeHtml(image)}" />`
    );
    nextHtml = replaceHeadTag(
        nextHtml,
        /<link rel="canonical" href=".*?" \/>/,
        `<link rel="canonical" href="${escapeHtml(baseUrl)}" />`
    );
    nextHtml = replaceHeadTag(
        nextHtml,
        /<link rel="icon"[^>]*href=".*?"[^>]*\/>/,
        `<link rel="icon" href="${escapeHtml(favicon)}" />`
    );
    nextHtml = replaceHeadTag(
        nextHtml,
        /<link rel="apple-touch-icon"[^>]*href=".*?"[^>]*\/>/,
        `<link rel="apple-touch-icon" href="${escapeHtml(favicon)}" />`
    );
    nextHtml = replaceHeadTag(
        nextHtml,
        /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
        `<script type="application/ld+json">${schema}</script>`
    );

    nextHtml = injectAppRootContent(
        nextHtml,
        buildHomePrerenderContent(profile, posts, description)
    );
    nextHtml = injectJsonData(nextHtml, 'hamlog-bootstrap', {
        route: 'home',
        profile,
        posts,
        categories
    });

    return injectSearchVerificationMeta(nextHtml);
};

const injectHomeAppShell = async (req, res, next) => {
    try {
        const [html, profile, postsResult, categories] = await Promise.all([
            readSpaIndexHtml(),
            readProfile(),
            getAllPostsService(false, true),
            readCategories()
        ]);
        res.send(injectHomeSeoMeta(html, profile, postsResult.data, categories));
    } catch (error) {
        next(error);
    }
};

const injectNoindexAppShell = async (req, res, next) => {
    try {
        let html = await readSpaIndexHtml();
        html = injectSearchVerificationMeta(html);
        html = replaceHeadTag(
            html,
            /<meta name="robots" content=".*?" \/>/,
            '<meta name="robots" content="noindex, nofollow" />'
        );

        res
            .set('X-Robots-Tag', 'noindex, nofollow')
            .send(html);
    } catch (error) {
        next(error);
    }
};

const isHtmlNavigationRequest = (req) => (
    !path.extname(req.path)
    && Boolean(req.accepts('html'))
);

const injectNotFoundAppShell = async (req, res, next) => {
    if (!isHtmlNavigationRequest(req)) {
        return res
            .status(404)
            .set('X-Robots-Tag', 'noindex, nofollow')
            .type('text/plain')
            .send('Not Found');
    }

    try {
        const [template, profile] = await Promise.all([readSpaIndexHtml(), readProfile()]);
        const baseUrl = resolveSiteBaseUrl(profile);
        const siteName = String(profile?.title ?? '').trim() || DEFAULT_SITE_TITLE;
        const requestedPath = req.originalUrl.startsWith('/') ? req.originalUrl : `/${req.originalUrl}`;
        let html = injectSearchVerificationMeta(template);
        html = replaceHeadTag(
            html,
            /<title>.*?<\/title>/,
            `<title>페이지를 찾을 수 없습니다 | ${escapeHtml(siteName)}</title>`
        );
        html = replaceHeadTag(
            html,
            /<meta name="robots" content=".*?" \/>/,
            '<meta name="robots" content="noindex, nofollow" />'
        );
        html = replaceHeadTag(
            html,
            /<link rel="canonical" href=".*?" \/>/,
            `<link rel="canonical" href="${escapeHtml(`${baseUrl}${requestedPath}`)}" />`
        );
        html = injectAppRootContent(html, buildNotFoundPrerenderContent());

        return res
            .status(404)
            .set('X-Robots-Tag', 'noindex, nofollow')
            .send(html);
    } catch (error) {
        return next(error);
    }
};

// Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: cspDirectives
    },
    crossOriginEmbedderPolicy: false
}));
app.use(createHttpsRedirectMiddleware({
    resolveCanonicalBaseUrl: async () => resolveSiteBaseUrl(await readProfile())
}));
app.use(cors((req, callback) => {
    callback(null, resolveCorsOptions(req));
}));
app.use(cookieParser());

// Protect the origin too: an Access login at the edge alone is not sufficient.
if (AUTH_MODE === 'cloudflare-access') app.use('/admin', authenticateToken);

app.get('/', injectHomeAppShell);
app.get('/robots.txt', getRobots);

// Static Files
app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname, '../dist')));

// Access covers /admin and /admin/*, including every admin API request.
// Public readers continue to use /api without an Access login challenge.
const apiRouter = express.Router();
apiRouter.use('/', healthRouter);
apiRouter.use('/posts', postRouter);
apiRouter.use('/categories', categoryRouter);
apiRouter.use('/profile', profileRouter);
apiRouter.use('/uploads', uploadRouter);
apiRouter.use('/comments', commentRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/analytics', analyticsRouter);
apiRouter.use('/images', publicImageRouter);
apiRouter.use('/', previewRouter);
apiRouter.get('/search', searchRateLimiter, searchPosts);
apiRouter.use((_req, res) => {
    res.status(404).json({ message: 'API 경로를 찾을 수 없습니다.' });
});
app.use('/admin/api', authenticateToken, apiRouter);
app.use('/api', apiRouter);
app.use(handleBodyParserError);
app.get(/^\/admin(?:\/.*)?$/, injectNoindexAppShell);
app.get(['/posts/:slug', '/p/:slug'], injectPostMeta);
app.use('/', seoRouter);

// Fallback for SPA
app.get('*', injectNotFoundAppShell);

export default app;
