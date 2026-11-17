import type { Post, SiteMeta } from '../types/blog';
import type { Category } from '../types/category';

interface BootstrapBase {
  profile: SiteMeta;
  posts: Post[];
  categories: Category[];
  // Present when the site URL is configured (profile or SITE_URL).
  siteUrl?: string;
}

export type AppBootstrapData =
  | (BootstrapBase & { route: 'home' })
  | (BootstrapBase & { route: 'post'; post: Post });

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const readBootstrapData = (): AppBootstrapData | null => {
  if (typeof document === 'undefined') return null;

  const element = document.getElementById('hamlog-bootstrap');
  if (!element) return null;

  try {
    const parsed: unknown = JSON.parse(element.textContent ?? '');
    if (!isRecord(parsed)) return null;
    if (parsed.route !== 'home' && parsed.route !== 'post') return null;
    if (!isRecord(parsed.profile)) return null;
    if (!Array.isArray(parsed.posts) || !Array.isArray(parsed.categories)) return null;
    if (parsed.route === 'post' && !isRecord(parsed.post)) return null;

    return parsed as unknown as AppBootstrapData;
  } catch {
    return null;
  } finally {
    element.remove();
  }
};

export const appBootstrapData = readBootstrapData();
