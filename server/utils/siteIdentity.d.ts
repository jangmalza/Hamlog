interface SiteIdentityProfile {
  title?: string;
  titleSuffix?: string;
  keywords?: string[];
  stack?: string[];
}

export const DEFAULT_SITE_TITLE: string;
export const DEFAULT_SITE_DESCRIPTION: string;
export const LEGACY_TITLE_SUFFIX: string;
export const LEGACY_KEYWORDS: readonly string[];

export function formatHomeTitle(profile?: SiteIdentityProfile | null): string;
export function resolveHomeKeywords(profile?: SiteIdentityProfile | null): string[];
