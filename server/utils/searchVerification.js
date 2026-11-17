import { replaceHeadTag } from './seoHtml.js';

const SEARCH_VERIFICATION_META = [
  ['GOOGLE_SITE_VERIFICATION', 'google-site-verification'],
  ['NAVER_SITE_VERIFICATION', 'naver-site-verification'],
  ['DAUM_SITE_VERIFICATION', 'daum-site-verification']
];

const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const normalizeRobotsValue = (value = '') => String(value)
  .replace(/[\r\n]+/g, ' ')
  .trim();

export const injectSearchVerificationMeta = (html) => (
  SEARCH_VERIFICATION_META.reduce((nextHtml, [envName, metaName]) => {
    const verification = String(process.env[envName] ?? '').trim();

    if (!verification) {
      return nextHtml;
    }

    return replaceHeadTag(
      nextHtml,
      new RegExp(`<meta name="${metaName}" content=".*?" \\/>`),
      `<meta name="${metaName}" content="${escapeHtml(verification)}" />`
    );
  }, html)
);

export const buildRobotsTxt = (baseUrl) => {
  const siteUrl = String(baseUrl || '').trim().replace(/\/+$/, '');
  const lines = [
    'User-agent: *',
    'Allow: /'
  ];
  const daumPin = normalizeRobotsValue(process.env.DAUM_WEBMASTER_PIN ?? '');

  if (daumPin) {
    lines.push(`DaumWebMasterTool: ${daumPin}`);
  }

  if (siteUrl) {
    lines.push(`Sitemap: ${siteUrl}/sitemap.xml`);
  }

  return `${lines.join('\n')}\n`;
};
