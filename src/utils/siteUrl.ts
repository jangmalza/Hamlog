import { appBootstrapData } from './appBootstrap';

const normalizeBaseUrl = (value?: string) => {
  const trimmed = value?.trim() ?? '';
  return /^https?:\/\//i.test(trimmed) ? trimmed.replace(/\/+$/, '') : '';
};

// Same order as the server: the profile site URL, then the base the server
// resolved for this page (covers SITE_URL-only setups), then the current origin.
export const resolveSiteBaseUrl = (profileSiteUrl?: string) => (
  normalizeBaseUrl(profileSiteUrl)
  || normalizeBaseUrl(appBootstrapData?.siteUrl)
  || (typeof window !== 'undefined' ? window.location.origin : '')
);
