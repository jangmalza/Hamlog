import { normalizeBaseUrl } from '../utils/seoHtml.js';

const LOCAL_SITE_URL = `http://localhost:${process.env.PORT?.trim() || 4000}`;
const ENV_SITE_URL = normalizeBaseUrl(process.env.SITE_URL, '');

// The profile's site URL wins; SITE_URL covers installations that have not set
// one. The local address only keeps absolute URLs well-formed until either is set.
export const resolveSiteBaseUrl = (profile) => (
    normalizeBaseUrl(profile?.siteUrl, ENV_SITE_URL || LOCAL_SITE_URL)
);

export const hasConfiguredSiteUrl = (profile) => (
    Boolean(ENV_SITE_URL || normalizeBaseUrl(profile?.siteUrl, ''))
);
