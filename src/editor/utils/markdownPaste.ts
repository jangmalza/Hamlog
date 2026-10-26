import { Marked } from 'marked';
import type { TokenizerAndRendererExtension, Tokens } from 'marked';

// Larger pastes keep the default plain-text behaviour instead of blocking input.
const MAX_MARKDOWN_PASTE_LENGTH = 200_000;
const MIN_ARTICLE_HEADING_LEVEL = 2;
const MAX_ARTICLE_HEADING_LEVEL = 3;

const BLOCK_PATTERNS = [
  /^ {0,3}#{1,6}[ \t]+\S/, // heading
  /^ {0,3}(?:```|~~~)/, // fenced code
  /^ {0,3}>/, // blockquote
  /^ {0,3}[-*+][ \t]+\S/, // bullet list
  /^ {0,3}\d{1,9}[.)][ \t]+\S/, // ordered list
  /^ {0,3}\$\$/ // display math
];
const TABLE_DELIMITER_PATTERN = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$/;
// `__x__` is left out and `**` must sit on word boundaries: plain text such as
// `__init__.py` or `2**10` is far more common in pastes than that emphasis.
const INLINE_PATTERNS = [
  /!?\[[^\]\n]+\]\([^)\s]+(?:[ \t]+"[^"\n]*")?\)/, // link or image
  /(?:^|[^\w*])\*\*[^*\s][^*\n]*\*\*(?![\w*])/,
  /`[^`\n]+`/,
  /\$\$[^$\n]+\$\$/
];

// Code editors put styled spans in text/html; their plain text is still the source.
// `pre`/`code`/`p` mean the source already chose a structure (code is code).
const PRESENTATIONAL_HTML_TAGS = new Set([
  'html', 'head', 'body', 'meta', 'style', 'div', 'span', 'br', 'font'
]);

export interface MarkdownPasteData {
  text: string;
  html?: string;
  vscodeEditorData?: string;
}

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const isSingleLine = (text: string) => !/\r|\n/.test(text.trim());

export const looksLikeMarkdown = (text: string): boolean => {
  if (isSingleLine(text)) {
    return INLINE_PATTERNS.some(pattern => pattern.test(text));
  }
  // Inline-only multi-line text keeps one paragraph per line as a plain paste does.
  return text.split(/\r\n?|\n/).some(line => (
    BLOCK_PATTERNS.some(pattern => pattern.test(line))
    || TABLE_DELIMITER_PATTERN.test(line)
  ));
};

export const isPresentationalHtml = (html: string): boolean => {
  for (const match of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9:-]*)/g)) {
    if (!PRESENTATIONAL_HTML_TAGS.has(match[1].toLowerCase())) return false;
  }
  return true;
};

const readVscodeMode = (vscodeEditorData: string) => {
  try {
    const mode = (JSON.parse(vscodeEditorData) as { mode?: unknown }).mode;
    return typeof mode === 'string' ? mode : null;
  } catch {
    return null;
  }
};

export const shouldConvertMarkdownPaste = ({ text, html = '', vscodeEditorData = '' }: MarkdownPasteData) => {
  if (!text.trim() || text.length > MAX_MARKDOWN_PASTE_LENGTH) return false;
  // Copied from a ProseMirror editor (including this one): keep its exact nodes.
  if (html.includes('data-pm-slice')) return false;
  if (vscodeEditorData) {
    // VS Code reports the source language; only Markdown files are converted.
    const mode = readVscodeMode(vscodeEditorData);
    if (mode && mode !== 'markdown') return false;
  } else if (html.trim() && !isPresentationalHtml(html)) {
    // Rich HTML (rendered pages, docs, other editors) keeps its own formatting.
    return false;
  }
  return looksLikeMarkdown(text);
};

const mathExtension: TokenizerAndRendererExtension = {
  name: 'hamlogMath',
  level: 'inline',
  start(src) {
    const index = src.indexOf('$$');
    return index < 0 ? undefined : index;
  },
  tokenizer(src) {
    const match = /^\$\$([\s\S]+?)\$\$/.exec(src);
    if (!match || !match[1].trim()) return undefined;
    return { type: 'hamlogMath', raw: match[0], latex: match[1].trim() };
  },
  renderer(token) {
    return `<span data-type="math" data-latex="${escapeHtml(String(token.latex))}"></span>`;
  }
};

const normalizeCodeLanguage = (lang?: string) => (
  (lang ?? '').trim().split(/\s+/)[0].replace(/[^\w#+.-]/g, '').toLowerCase()
);

const createMarkdownParser = () => {
  let headingShift = 0;
  const parser = new Marked({ gfm: true, breaks: false });
  parser.use({
    extensions: [mathExtension],
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const level = Math.min(depth + headingShift, MAX_ARTICLE_HEADING_LEVEL);
        return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>\n`;
      },
      code({ text, lang }: Tokens.Code) {
        const language = normalizeCodeLanguage(lang);
        if (language === 'mermaid') {
          return `<div data-type="mermaid" data-source="${escapeHtml(text)}"></div>\n`;
        }
        const languageClass = language ? ` class="language-${language}"` : '';
        // No trailing newline: it would become an empty last line in the code block.
        return `<pre><code${languageClass}>${escapeHtml(text)}</code></pre>\n`;
      },
      checkbox({ checked }: Tokens.Checkbox) {
        // The editor has no task list; keep the state readable as text.
        return checked ? '[x] ' : '[ ] ';
      }
    }
  });
  const setHeadingShift = (shift: number) => {
    headingShift = shift;
  };
  return { parser, setHeadingShift };
};

/**
 * Converts pasted Markdown to editor HTML. The article title is the page's only
 * H1, so the top heading level in the paste starts at H2 and deeper levels stop at H3.
 */
export const markdownToEditorHtml = (text: string): string => {
  const { parser, setHeadingShift } = createMarkdownParser();
  if (isSingleLine(text)) {
    return parser.parseInline(text.trim(), { async: false });
  }

  const tokens = parser.lexer(text);
  let minDepth = Infinity;
  parser.walkTokens(tokens, token => {
    if (token.type === 'heading') minDepth = Math.min(minDepth, (token as Tokens.Heading).depth);
  });
  setHeadingShift(Number.isFinite(minDepth) ? Math.max(0, MIN_ARTICLE_HEADING_LEVEL - minDepth) : 0);
  return parser.parser(tokens);
};
