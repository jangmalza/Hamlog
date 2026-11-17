// Matches PRERENDER_ROOT_ID in server/utils/seoHtml.js.
const PRERENDER_ROOT_ID = 'prerender-root';

const findPrerenderedPage = () => (
  typeof document === 'undefined' ? null : document.getElementById(PRERENDER_ROOT_ID)
);

// True from page load until the client page replaces the server-rendered one.
let handoffPending = findPrerenderedPage() !== null;

export const hasPrerenderedPage = () => findPrerenderedPage() !== null;

/**
 * Components rendered in the same commit that replaces the server HTML should
 * look exactly like it, e.g. skip entrance animations that would hide content
 * the reader is already looking at.
 */
export const isPrerenderHandoffPending = () => handoffPending;

export const removePrerenderedPage = () => {
  findPrerenderedPage()?.remove();
  handoffPending = false;
};
