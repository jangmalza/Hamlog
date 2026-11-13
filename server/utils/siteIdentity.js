// Site identity rules shared by the server-rendered HTML and the client SEO hooks,
// so both produce the same home title and keywords for a profile.

export const DEFAULT_SITE_TITLE = 'Hamlog';
export const DEFAULT_SITE_DESCRIPTION = 'Hamlog로 운영하는 블로그입니다.';

// Profiles saved before titleSuffix and keywords existed were rendered with
// these built-in values. Upgrades keep them so a running site's SEO does not
// change; new installations start without them.
export const LEGACY_TITLE_SUFFIX = '클라우드 엔지니어링과 개발 기록';
export const LEGACY_KEYWORDS = Object.freeze(['클라우드 엔지니어링', 'DevOps', '인프라', 'AWS', 'GCP', 'Kubernetes']);

const toText = (value) => String(value ?? '').trim();
const toTextList = (value) => (Array.isArray(value) ? value.map(toText).filter(Boolean) : []);

export function formatHomeTitle(profile) {
    const title = toText(profile?.title) || DEFAULT_SITE_TITLE;
    const suffix = toText(profile?.titleSuffix);
    return !suffix || title.includes('|') ? title : `${title} | ${suffix}`;
}

export function resolveHomeKeywords(profile) {
    return Array.from(new Set([...toTextList(profile?.keywords), ...toTextList(profile?.stack)]));
}
