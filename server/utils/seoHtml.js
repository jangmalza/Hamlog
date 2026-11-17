export const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const escapeXml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

export const wrapCdata = (value = '') => `<![CDATA[${String(value).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

// Replacement strings are passed through functions: String#replace would
// otherwise expand $&, $', $` and $1 found in post or profile text.
export const replaceHeadTag = (html, pattern, replacement) => (
  pattern.test(html)
    ? html.replace(pattern, () => replacement)
    : html.replace('</head>', () => `  ${replacement}\n</head>`)
);

export const removeHeadTag = (html, pattern) => html.replace(pattern, '');

export const injectAppRootContent = (html, content) => {
  const emptyRootPattern = /<div\s+id=(["'])root\1\s*><\/div>/i;
  return emptyRootPattern.test(html)
    ? html.replace(emptyRootPattern, () => `<div id="root">${content}</div>`)
    : html;
};

const serializeJsonForHtml = (value) => JSON.stringify(value)
  .replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e')
  .replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');

export const injectJsonData = (html, id, value) => {
  const safeId = escapeHtml(id);
  const dataBlock = `<script id="${safeId}" type="application/json">${serializeJsonForHtml(value)}</script>`;
  return html.replace('</head>', () => `  ${dataBlock}\n</head>`);
};

export const normalizeBaseUrl = (value, fallback) => {
  const candidate = String(value || fallback).trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(candidate) ? candidate : fallback;
};

export const toAbsoluteUrl = (baseUrl, value = '', fallbackPath = '/avatar.jpg') => {
  if (!value) return `${baseUrl}${fallbackPath.startsWith('/') ? '' : '/'}${fallbackPath}`;
  if (/^https?:\/\//i.test(value)) return value;
  return `${baseUrl}${value.startsWith('/') ? '' : '/'}${value}`;
};
