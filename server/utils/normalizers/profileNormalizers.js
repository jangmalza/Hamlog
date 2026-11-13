import { normalizeOptionalString, normalizeRequiredString } from './shared.js';
import { LEGACY_KEYWORDS, LEGACY_TITLE_SUFFIX } from '../siteIdentity.js';

const SOCIAL_KEYS = ['github', 'linkedin', 'twitter', 'instagram', 'threads', 'telegram'];

// An empty site URL means "not set": SEO URLs then come from SITE_URL.
function normalizeSiteUrl(value) {
    return normalizeOptionalString(value, '').replace(/\/+$/, '');
}

export const defaultProfile = {
    title: 'Blog Title',
    name: 'Author Name',
    role: 'Role',
    tagline: 'Tagline',
    description: 'Description',
    location: 'Location',
    profileImage: '',
    favicon: '/avatar.jpg',
    email: '',
    siteUrl: '',
    titleSuffix: '',
    keywords: [],
    social: {
        github: '',
        linkedin: '',
        twitter: '',
        instagram: '',
        threads: '',
        telegram: ''
    },
    stack: [],
    now: '',
    display: {
        showProfileImage: true,
        showLocation: true,
        showEmail: true,
        showSocialLinks: true,
        showNow: true,
        showStack: true
    }
};

export function normalizeStack(value) {
    if (Array.isArray(value)) {
        return value.map(item => String(item).trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
        return value
            .split(',')
            .map(item => item.trim())
            .filter(Boolean);
    }
    return [];
}

export function normalizeSocial(value, fallback) {
    if (value === undefined || value === null) return { ...fallback };
    const social = value && typeof value === 'object' ? value : {};
    const next = {};

    SOCIAL_KEYS.forEach((key) => {
        const raw = social[key];
        if (raw === undefined || raw === null) return;
        const trimmed = String(raw).trim();
        if (trimmed) {
            next[key] = trimmed;
        }
    });

    return next;
}

export function normalizeProfileDisplay(value, fallback = defaultProfile.display) {
    const source = value && typeof value === 'object' ? value : {};
    const normalizeToggle = (toggle, fallbackValue) =>
        typeof toggle === 'boolean' ? toggle : fallbackValue;

    return {
        showProfileImage: normalizeToggle(source.showProfileImage, fallback.showProfileImage),
        showLocation: normalizeToggle(source.showLocation, fallback.showLocation),
        showEmail: normalizeToggle(source.showEmail, fallback.showEmail),
        showSocialLinks: normalizeToggle(source.showSocialLinks, fallback.showSocialLinks),
        showNow: normalizeToggle(source.showNow, fallback.showNow),
        showStack: normalizeToggle(source.showStack, fallback.showStack)
    };
}

export function normalizeProfile(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const stack =
        source.stack === undefined || source.stack === null
            ? defaultProfile.stack
            : normalizeStack(source.stack);

    return {
        title: normalizeRequiredString(source.title, defaultProfile.title),
        name: normalizeRequiredString(source.name, defaultProfile.name),
        role: normalizeRequiredString(source.role, defaultProfile.role),
        tagline: normalizeOptionalString(source.tagline, defaultProfile.tagline),
        description: normalizeRequiredString(source.description, defaultProfile.description),
        location: normalizeOptionalString(source.location, defaultProfile.location),
        profileImage: normalizeOptionalString(source.profileImage, defaultProfile.profileImage),
        favicon: normalizeOptionalString(source.favicon, defaultProfile.favicon),
        email: normalizeOptionalString(source.email, defaultProfile.email),
        siteUrl: normalizeSiteUrl(source.siteUrl),
        titleSuffix: source.titleSuffix === undefined || source.titleSuffix === null
            ? LEGACY_TITLE_SUFFIX
            : normalizeOptionalString(source.titleSuffix, ''),
        keywords: source.keywords === undefined || source.keywords === null
            ? [...LEGACY_KEYWORDS]
            : normalizeStack(source.keywords),
        social: normalizeSocial(source.social, defaultProfile.social),
        stack,
        now: normalizeOptionalString(source.now, defaultProfile.now),
        display: normalizeProfileDisplay(source.display, defaultProfile.display)
    };
}

export function mergeProfile(current, input) {
    if (!input || typeof input !== 'object') return current;
    const next = { ...current };
    const requiredFields = new Set(['title', 'name', 'role', 'description']);

    [
        'title',
        'name',
        'role',
        'tagline',
        'description',
        'location',
        'profileImage',
        'favicon',
        'email',
        'siteUrl',
        'titleSuffix',
        'now'
    ].forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(input, field)) {
            const raw = input[field];
            const trimmed = raw !== undefined && raw !== null ? String(raw).trim() : '';
            if (trimmed) {
                next[field] = trimmed;
            } else if (!requiredFields.has(field)) {
                next[field] = '';
            }
        }
    });

    if (Object.prototype.hasOwnProperty.call(input, 'stack')) {
        next.stack = normalizeStack(input.stack);
    }

    if (Object.prototype.hasOwnProperty.call(input, 'keywords')) {
        next.keywords = normalizeStack(input.keywords);
    }

    if (Object.prototype.hasOwnProperty.call(input, 'social')) {
        const socialInput = input.social && typeof input.social === 'object' ? input.social : {};
        const nextSocial = { ...current.social };

        SOCIAL_KEYS.forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(socialInput, key)) {
                const raw = socialInput[key];
                const trimmed = raw !== undefined && raw !== null ? String(raw).trim() : '';
                if (trimmed) {
                    nextSocial[key] = trimmed;
                } else {
                    delete nextSocial[key];
                }
            }
        });

        next.social = nextSocial;
    }

    if (Object.prototype.hasOwnProperty.call(input, 'display')) {
        next.display = normalizeProfileDisplay(input.display, current.display ?? defaultProfile.display);
    }

    return next;
}
