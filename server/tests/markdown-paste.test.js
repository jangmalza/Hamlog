import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPresentationalHtml,
  looksLikeMarkdown,
  markdownToEditorHtml,
  shouldConvertMarkdownPaste
} from '../../src/editor/utils/markdownPaste.ts';

const markdownDocument = [
  '# 배포 가이드',
  '',
  '본문의 **굵은 글씨**와 `inline code`, [문서](https://example.com/docs)',
  '',
  '## 준비',
  '',
  '- 첫째',
  '- 둘째'
].join('\n');

test('multi-line pastes convert only when a block-level Markdown marker is present', () => {
  for (const text of [
    markdownDocument,
    '설명\n\n```ts\nconst a = 1;\n```',
    '1. 하나\n2. 둘',
    '> 인용한 문장\n> 이어지는 줄',
    '| 이름 | 값 |\n| --- | :-: |\n| a | 1 |',
    '수식\n$$\nE = mc^2\n$$'
  ]) {
    assert.equal(looksLikeMarkdown(text), true, text);
  }

  for (const text of [
    '그냥 여러 줄\n텍스트입니다',
    // Inline-only lines keep one paragraph per line, as a plain paste does.
    '`npm ci` 실행\n그다음 `npm test`',
    '#해시태그는 제목이 아닙니다\n다음 줄',
    '-5도와\n+3도'
  ]) {
    assert.equal(looksLikeMarkdown(text), false, text);
  }
});

test('single-line pastes convert only inline Markdown', () => {
  assert.equal(looksLikeMarkdown('**굵게** 표시'), true);
  assert.equal(looksLikeMarkdown('[링크](https://example.com) 참고'), true);
  assert.equal(looksLikeMarkdown('`kubectl get pods` 실행'), true);
  assert.equal(looksLikeMarkdown('# 한 줄 제목'), false);
  assert.equal(looksLikeMarkdown('- 한 줄 목록'), false);
  assert.equal(looksLikeMarkdown('https://example.com/a_b_c'), false);
  assert.equal(looksLikeMarkdown('가격은 $5에서 $10 사이'), false);
  assert.equal(looksLikeMarkdown('이 문장은**굵게**를 씁니다'), true);
  // Plain code-like text must not turn into emphasis.
  assert.equal(looksLikeMarkdown('__init__.py'), false);
  assert.equal(looksLikeMarkdown('if __name__ == "__main__":'), false);
  assert.equal(looksLikeMarkdown('2**10 and 3**4'), false);
  assert.equal(looksLikeMarkdown('a ** b ** c'), false);
});

test('code and editor clipboard HTML is never converted', () => {
  const code = '# install deps\nnpm ci\n- not a list';
  for (const html of [
    // Copied from this editor (or another ProseMirror editor).
    `<pre data-pm-slice="0 0 []"><code class="language-bash">${code}</code></pre>`,
    '<p data-pm-slice="1 1 []">1. 설치</p><p>2. 실행</p>',
    // Docs sites, GitHub, and IDE rich copies.
    `<pre><code>${code}</code></pre>`,
    `<html><head><style>.x{}</style></head><body><pre><span>${code}</span></pre></body></html>`,
    `<code>${code}</code>`
  ]) {
    assert.equal(shouldConvertMarkdownPaste({ text: code, html }), false, html);
  }
});

test('rich HTML clipboard data keeps its own formatting', () => {
  assert.equal(shouldConvertMarkdownPaste({ text: markdownDocument }), true);
  assert.equal(shouldConvertMarkdownPaste({
    text: markdownDocument,
    html: '<meta charset="utf-8"><h1>배포 가이드</h1><ul><li>첫째</li></ul>'
  }), false);
  // Code editors and plain pages wrap the source text in presentational markup.
  assert.equal(shouldConvertMarkdownPaste({
    text: markdownDocument,
    html: '<meta charset="utf-8"><!--StartFragment--><div style="color: #ccc"><span># 배포 가이드</span><br></div>'
  }), true);
  assert.equal(isPresentationalHtml('<div><span style="color: #ccc">- a</span><br></div>'), true);
  assert.equal(isPresentationalHtml('<pre style="white-space: pre-wrap"><code>- a</code></pre>'), false);
  assert.equal(isPresentationalHtml('<p>- 웹 페이지 문단</p>'), false);
  assert.equal(isPresentationalHtml('<p>문단 <a href="https://example.com">링크</a></p>'), false);
});

test('VS Code pastes convert only from Markdown files', () => {
  const html = '<div><span># 배포 가이드</span></div>';
  assert.equal(shouldConvertMarkdownPaste({
    text: markdownDocument,
    html,
    vscodeEditorData: '{"version":1,"mode":"markdown"}'
  }), true);
  assert.equal(shouldConvertMarkdownPaste({
    text: '# 설치\npip install hamlog',
    html,
    vscodeEditorData: '{"version":1,"mode":"python"}'
  }), false);
  assert.equal(shouldConvertMarkdownPaste({
    text: markdownDocument,
    html,
    vscodeEditorData: 'not json'
  }), true);
});

test('empty and very large pastes keep the default paste behaviour', () => {
  assert.equal(shouldConvertMarkdownPaste({ text: '   \n ' }), false);
  assert.equal(shouldConvertMarkdownPaste({ text: `# 제목\n${'a'.repeat(200_001)}` }), false);
});

test('the top pasted heading becomes H2 and deeper levels stop at H3', () => {
  const html = markdownToEditorHtml('# 하나\n\n## 둘\n\n### 셋\n\n###### 여섯');
  assert.match(html, /<h2>하나<\/h2>/);
  assert.match(html, /<h3>둘<\/h3>/);
  assert.match(html, /<h3>셋<\/h3>/);
  assert.match(html, /<h3>여섯<\/h3>/);
  assert.doesNotMatch(html, /<h[1456]>/);

  // A paste that already starts at H2 or H3 keeps its levels.
  const nested = markdownToEditorHtml('## 둘\n\n### 셋');
  assert.match(nested, /<h2>둘<\/h2>[\s\S]*<h3>셋<\/h3>/);
  assert.match(markdownToEditorHtml('### 셋\n\n본문'), /<h3>셋<\/h3>/);
});

test('Markdown blocks map to the editor schema', () => {
  const html = markdownToEditorHtml([
    '```TypeScript title="app.ts"',
    'const a = 1 < 2;',
    '```',
    '',
    '```mermaid',
    'graph TD',
    '  A-->B',
    '```',
    '',
    '$$',
    'E = mc^2',
    '$$',
    '',
    '- [ ] 할 일',
    '- [x] 완료',
    '',
    '| 이름 | 값 |',
    '| --- | --- |',
    '| a | 1 |'
  ].join('\n'));

  // No trailing newline: it would add an empty last line to the code block.
  assert.match(html, /<pre><code class="language-typescript">const a = 1 &lt; 2;<\/code><\/pre>/);
  assert.match(html, /<div data-type="mermaid" data-source="graph TD\n {2}A--&gt;B"><\/div>/);
  assert.match(html, /<span data-type="math" data-latex="E = mc\^2"><\/span>/);
  assert.match(html, /<li>\[ \] 할 일<\/li>/);
  assert.match(html, /<li>\[x\] 완료<\/li>/);
  assert.doesNotMatch(html, /<input/);
  assert.match(html, /<table>[\s\S]*<th>이름<\/th>[\s\S]*<td>1<\/td>/);
});

test('single-line Markdown converts to inline HTML without a wrapping paragraph', () => {
  assert.equal(
    markdownToEditorHtml('**굵게**와 [링크](https://example.com) 그리고 $$x^2$$'),
    '<strong>굵게</strong>와 <a href="https://example.com">링크</a> 그리고 <span data-type="math" data-latex="x^2"></span>'
  );
});
