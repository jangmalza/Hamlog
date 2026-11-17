import { useLayoutEffect, type ReactNode } from 'react';

// Matches PRERENDER_ROOT_ID in server/utils/seoHtml.js.
const PRERENDER_ROOT_ID = 'prerender-root';

const hasPrerenderedPage = () => (
  typeof document !== 'undefined' && document.getElementById(PRERENDER_ROOT_ID) !== null
);

/**
 * Removes the server-rendered page once the client page in the same commit is ready.
 * Rendered next to the page inside its Suspense boundary, so it only mounts after a
 * lazy page chunk has loaded; the layout effect runs before paint, so readers never
 * see a blank frame or a spinner between the two.
 */
export function PrerenderHandoff() {
  useLayoutEffect(() => {
    document.getElementById(PRERENDER_ROOT_ID)?.remove();
  }, []);
  return null;
}

/** While the prerendered page is still showing, a route fallback must not cover it. */
export function RouteFallback({ children }: { children: ReactNode }) {
  return hasPrerenderedPage() ? null : children;
}
