import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { resolveClientIp } from '../utils/clientIp.js';

const parsePositiveInt = (value, fallback) => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const commonOptions = {
    standardHeaders: true,
    legacyHeaders: false,
    // Count each visitor separately even behind the local tunnel; IPv6 visitors
    // are grouped by /56 prefix like the library default.
    keyGenerator: (req) => ipKeyGenerator(resolveClientIp(req))
};

export const loginRateLimiter = rateLimit({
    ...commonOptions,
    windowMs: 15 * 60 * 1000,
    max: parsePositiveInt(process.env.RATE_LIMIT_LOGIN_MAX, 10),
    skipSuccessfulRequests: true,
    message: { message: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.' }
});

export const uploadRateLimiter = rateLimit({
    ...commonOptions,
    windowMs: 10 * 60 * 1000,
    max: parsePositiveInt(process.env.RATE_LIMIT_UPLOAD_MAX, 30),
    message: { message: '업로드 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }
});

export const previewRateLimiter = rateLimit({
    ...commonOptions,
    windowMs: 10 * 60 * 1000,
    max: parsePositiveInt(process.env.RATE_LIMIT_PREVIEW_MAX, 120),
    message: { message: '미리보기 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }
});

export const searchRateLimiter = rateLimit({
    ...commonOptions,
    windowMs: 10 * 60 * 1000,
    max: parsePositiveInt(process.env.RATE_LIMIT_SEARCH_MAX, 180),
    message: { message: '검색 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }
});

export const viewRateLimiter = rateLimit({
    ...commonOptions,
    windowMs: 10 * 60 * 1000,
    max: parsePositiveInt(process.env.RATE_LIMIT_VIEW_MAX, 240),
    message: { message: '조회 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }
});

export const analyticsRateLimiter = rateLimit({
    ...commonOptions,
    windowMs: 10 * 60 * 1000,
    max: parsePositiveInt(process.env.RATE_LIMIT_ANALYTICS_MAX, 1200),
    message: { message: '방문 집계 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }
});

export const publicAnalyticsRateLimiter = rateLimit({
    ...commonOptions,
    windowMs: 10 * 60 * 1000,
    max: parsePositiveInt(process.env.RATE_LIMIT_ANALYTICS_PUBLIC_MAX, 120),
    message: { message: '방문자 현황 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }
});

export const publicImageRateLimiter = rateLimit({
    ...commonOptions,
    windowMs: 10 * 60 * 1000,
    max: parsePositiveInt(process.env.RATE_LIMIT_IMAGE_MAX, 1200),
    message: { message: '이미지 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }
});

export const commentRateLimiter = rateLimit({
    ...commonOptions,
    windowMs: 10 * 60 * 1000,
    max: parsePositiveInt(process.env.RATE_LIMIT_COMMENT_MAX, 20),
    message: { message: '댓글 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }
});
