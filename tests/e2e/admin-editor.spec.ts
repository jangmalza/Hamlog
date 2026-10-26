import { expect, test, type Page } from '@playwright/test';

const backendOrigin = `http://127.0.0.1:${process.env.E2E_API_PORT ?? process.env.PORT ?? '4100'}`;
const loginPasswords = Array.from(new Set([
  process.env.ADMIN_PASSWORD,
  'admin1234',
  'e2e-password'
].filter(Boolean))) as string[];

async function openAdminEditor(page: Page) {
  await page.goto('/admin?section=posts');
  const titleInput = page.getByPlaceholder('제목을 입력하세요');

  if (await titleInput.isVisible().catch(() => false)) {
    return;
  }

  for (const password of loginPasswords) {
    const loggedIn = await page.evaluate(async (candidate) => {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password: candidate })
      });
      return response.ok;
    }, password);

    if (loggedIn) {
      break;
    }
  }

  await page.goto('/admin?section=posts');
  await expect(titleInput).toBeVisible();
}

function createParagraphDocument(text: string) {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text
          }
        ]
      }
    ]
  };
}

async function deletePostFromAdmin(page: Page, postId: string) {
  await page.evaluate(async (id) => {
    localStorage.removeItem(`hamlog_draft_${id}`);
    await fetch(`/api/posts/${id}`, {
      method: 'DELETE',
      credentials: 'include'
    });
  }, postId);
}

test('backend exposes robots and baseline security headers', async ({ request }) => {
  const homeResponse = await request.get(`${backendOrigin}/`);
  expect(homeResponse.status()).toBe(200);

  const csp = homeResponse.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'self'");

  const robotsResponse = await request.get(`${backendOrigin}/robots.txt`);
  expect(robotsResponse.status()).toBe(200);
  expect(robotsResponse.headers()['content-type']).toContain('text/plain');

  const robots = await robotsResponse.text();
  expect(robots).toContain('User-agent: *');
  expect(robots).toContain('Allow: /');
  expect(robots).toContain('Sitemap: https://tech.hamwoo.co.kr/sitemap.xml');
});

test('upgraded editor updates formatting controls and keeps table menus undoable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.text().includes('Duplicate extension names')) errors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openAdminEditor(page);
  const editor = page.locator('.ProseMirror');
  const toolbar = page.getByRole('toolbar', { name: '글 편집 도구' });
  await editor.fill('서식과 표 호환성');
  await editor.press('Control+a');
  const bold = toolbar.getByRole('button', { name: '굵게', exact: true });
  const underline = toolbar.getByRole('button', { name: '밑줄', exact: true });
  await bold.click();
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
  await underline.click();
  await expect(underline).toHaveAttribute('aria-pressed', 'true');
  await expect(editor.locator('strong u, u strong')).toHaveText('서식과 표 호환성');

  await editor.press('Control+End');
  await editor.press('Enter');
  await toolbar.getByRole('button', { name: '표', exact: true }).click();
  const table = editor.locator('table');
  await expect(table.locator('tr')).toHaveCount(3);
  await table.locator('td').first().click();
  await page.keyboard.insertText('표 셀');
  await expect(page.getByRole('button', { name: '아래에 행 추가', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '아래에 행 추가', exact: true }).click();
  await expect(table.locator('tr')).toHaveCount(4);
  await toolbar.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(table.locator('tr')).toHaveCount(3);
  await toolbar.getByRole('button', { name: '다시 실행', exact: true }).click();
  await expect(table.locator('tr')).toHaveCount(4);
  await table.locator('td').first().click();
  await page.getByRole('button', { name: '표 삭제', exact: true }).click();
  await expect(table).toHaveCount(0);
  await expect(editor.locator('strong u, u strong')).toHaveText('서식과 표 호환성');
  expect(errors).toEqual([]);
});

for (const theme of ['light', 'dark'] as const) {
  test(`editor placeholder stays secondary and out of saved content in ${theme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 390, height: 844 });
    await openAdminEditor(page);
    const editor = page.locator('.ProseMirror');
    const hint = editor.locator('p.is-empty[data-placeholder]');
    let postId: string | null = null;

    try {
      await editor.click();
      await expect(hint).toHaveAttribute('data-placeholder', '내용을 입력하세요. /로 블록 추가');
      await page.getByPlaceholder('제목을 입력하세요').fill(`문단 안내 검증 ${theme} ${Date.now()}`);
      await editor.fill('작성한 본문은 그대로 유지됩니다.');
      await editor.press('Enter');
      await expect(hint).toHaveCount(1);
      await expect(hint).toHaveAttribute('data-placeholder', '/로 블록 추가');

      const styles = await hint.evaluate(element => {
        const placeholder = getComputedStyle(element, '::before');
        const paragraph = getComputedStyle(element);
        const background = getComputedStyle(element.closest('.ProseMirror')!).backgroundColor;
        const luminance = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3)
          .map(Number).map(value => value / 255)
          .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
          .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
        const contrast = (color: string) => {
          const foreground = luminance(color);
          const surface = luminance(background);
          return (Math.max(foreground, surface) + 0.05) / (Math.min(foreground, surface) + 0.05);
        };
        return {
          placeholderColor: placeholder.color,
          paragraphColor: paragraph.color,
          placeholderSize: parseFloat(placeholder.fontSize),
          paragraphSize: parseFloat(paragraph.fontSize),
          placeholderContrast: contrast(placeholder.color),
          paragraphContrast: contrast(paragraph.color),
          pointerEvents: placeholder.pointerEvents,
          userSelect: placeholder.userSelect
        };
      });
      expect(styles.placeholderColor).not.toBe(styles.paragraphColor);
      expect(styles.placeholderSize).toBe(14);
      expect(styles.placeholderSize).toBeLessThan(styles.paragraphSize);
      expect(styles.placeholderContrast).toBeGreaterThanOrEqual(4.5);
      expect(styles.placeholderContrast).toBeLessThan(styles.paragraphContrast);
      expect(styles.pointerEvents).toBe('none');
      expect(styles.userSelect).toBe('none');
      await expect(editor).toHaveText('작성한 본문은 그대로 유지됩니다.');
      await page.screenshot({ path: test.info().outputPath(`editor-placeholder-${theme}.png`) });

      await page.keyboard.insertText('두 번째 문단입니다.');
      await expect(hint).toHaveCount(0);
      await editor.press('Enter');
      await editor.press('Enter');
      await expect(hint).toHaveCount(1);
      await expect(hint).toHaveAttribute('data-placeholder', '/로 블록 추가');

      const savedResponse = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/posts');
      await editor.press('Control+s');
      const response = await savedResponse;
      expect(response.status()).toBe(201);
      const saved = await response.json();
      postId = saved.id;
      const savedContent = `${saved.contentHtml} ${JSON.stringify(saved.contentJson)}`;
      expect(savedContent).toContain('작성한 본문은 그대로 유지됩니다.');
      expect(savedContent).toContain('두 번째 문단입니다.');
      expect(savedContent).not.toContain('블록 추가');
      expect(savedContent).not.toContain('data-placeholder');
    } finally {
      if (postId) await deletePostFromAdmin(page, postId);
    }
  });
}

test('admin editor toolbar is grouped and accessible', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await openAdminEditor(page);

  const toolbar = page.getByRole('toolbar', { name: '글 편집 도구' });
  await expect(toolbar).toBeVisible();

  for (const groupName of ['실행 기록', '문단 설정', '텍스트 서식', '정렬', '목록과 인용', '삽입']) {
    await expect(toolbar.getByRole('group', { name: groupName })).toBeVisible();
  }

  await expect(toolbar.getByRole('button', { name: '굵게' })).toHaveAttribute('aria-pressed', 'false');
  await expect(toolbar.getByRole('button', { name: /문단:/ })).toHaveAttribute('aria-expanded', 'false');

  const textColorButton = toolbar.getByRole('button', { name: '글자색' });
  await textColorButton.focus();
  await page.keyboard.press('Enter');
  const textColorMenu = page.getByRole('menu', { name: '글자색' });
  await expect(textColorMenu).toBeVisible();
  const firstTextColor = textColorMenu.getByRole('menuitem', { name: '글자색 #1d1916' });
  const secondTextColor = textColorMenu.getByRole('menuitem', { name: '글자색 #0f766e' });
  const sameColumnLastRowColor = textColorMenu.getByRole('menuitem', { name: '글자색 #b91c1c' });
  await expect(firstTextColor).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(sameColumnLastRowColor).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(firstTextColor).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(secondTextColor).toBeFocused();
  await page.keyboard.press('Home');
  await expect(firstTextColor).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(textColorMenu).toBeHidden();
  await expect(textColorButton).toBeFocused();
  await expect(textColorButton).toHaveAttribute('aria-expanded', 'false');

  const highlightButton = toolbar.getByRole('button', { name: '하이라이트' });
  await highlightButton.focus();
  await page.keyboard.press('Enter');
  const highlightMenu = page.getByRole('menu', { name: '하이라이트' });
  const firstHighlight = highlightMenu.getByRole('menuitem', { name: '하이라이트 #fef3c7' });
  const secondHighlight = highlightMenu.getByRole('menuitem', { name: '하이라이트 #d1fae5' });
  await expect(firstHighlight).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(secondHighlight).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(highlightMenu).toBeHidden();
  await expect(highlightButton).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(secondHighlight).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(highlightButton).toBeFocused();

  await textColorButton.focus();
  await page.keyboard.press('Enter');
  await expect(textColorMenu).toBeVisible();
  await page.keyboard.press('Alt+Shift+P');
  await expect(textColorMenu).toBeHidden();
  const editToggle = page.getByRole('button', { name: '편집', exact: true });
  await expect(editToggle).toBeFocused();
  const toolbarRegion = page.getByTestId('editor-toolbar-region');
  await expect(toolbarRegion)
    .toHaveAttribute('aria-hidden', 'true');
  await expect(toolbarRegion).toHaveAttribute('inert', '');
  await page.keyboard.press('Tab');
  expect(await toolbarRegion.evaluate(element => element.contains(document.activeElement))).toBe(false);
  await page.keyboard.press('Alt+Shift+P');
  await expect(page.getByRole('button', { name: '미리보기' })).toBeFocused();

  await toolbar.getByRole('button', { name: '고급 삽입 메뉴' }).click();
  await expect(page.getByRole('button', { name: /수식/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /유튜브/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Mermaid 다이어그램/ })).toBeVisible();
  await page.keyboard.press('Escape');

  await toolbar.getByRole('button', { name: '코드 블록' }).click();
  await expect(page.getByRole('group', { name: '코드 언어 선택' }).getByRole('button', { name: 'Mermaid' })).toBeVisible();

  await page.getByRole('button', { name: '글 설정 열기' }).click();
  await expect(page.getByRole('heading', { name: '발행과 메타' })).toBeVisible();
  await page.getByRole('button', { name: /^SEO/ }).click();
  await expect(page.getByPlaceholder('검색 결과 제목')).toBeVisible();

  await page.getByTestId('editor-image-input').setInputFiles({
    name: 'too-large.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc((8 * 1024 * 1024) + 1)
  });
  await expect(page.getByText('이미지는 8MB 이하만 가능합니다.')).toBeVisible();

  const toolbarOverflow = await toolbar.getByTestId('editor-toolbar-scroll').evaluate(node => ({
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth
  }));
  expect(toolbarOverflow.scrollWidth).toBeGreaterThan(toolbarOverflow.clientWidth);
});

test('admin editor keeps the mobile workspace focused without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAdminEditor(page);

  const titleInput = page.getByPlaceholder('제목을 입력하세요');
  await expect(titleInput).toBeVisible();
  await expect(page.getByLabel('현재 글 상태: 초안')).toHaveText('초안');
  await expect(page.locator('select[aria-label="글 상태"]')).toHaveCount(0);

  const initialTitleHeight = await titleInput.evaluate(element => element.getBoundingClientRect().height);
  const longTitle = '모바일에서도 긴 제목이 자연스럽게 여러 줄로 표시되는지 확인하는 에디터 제목 입력 테스트입니다';
  await titleInput.fill(longTitle);
  await expect(titleInput).toHaveValue(longTitle);
  await expect.poll(() => titleInput.evaluate(element => element.getBoundingClientRect().height))
    .toBeGreaterThan(initialTitleHeight);

  const titleLayout = await titleInput.evaluate(element => {
    const style = window.getComputedStyle(element);
    return {
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      whiteSpace: style.whiteSpace
    };
  });
  expect(titleLayout.scrollWidth).toBeLessThanOrEqual(titleLayout.clientWidth + 1);
  expect(titleLayout.whiteSpace).not.toBe('nowrap');

  await titleInput.fill('가'.repeat(2000));
  const cappedTitleLayout = await titleInput.evaluate(element => ({
    height: element.getBoundingClientRect().height,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight
  }));
  expect(cappedTitleLayout.height).toBeLessThanOrEqual(145);
  expect(cappedTitleLayout.scrollHeight).toBeGreaterThan(cappedTitleLayout.clientHeight);
  await titleInput.fill(longTitle);

  const toolbar = page.getByRole('toolbar', { name: '글 편집 도구' });
  const toolbarScroll = toolbar.getByTestId('editor-toolbar-scroll');
  const paragraphSelect = toolbar.getByRole('button', { name: /문단:/ });
  await paragraphSelect.click();
  const paragraphList = page.getByRole('listbox', { name: '문단' });
  await expect(paragraphList).toBeVisible();
  const paragraphMenuIsClickable = await paragraphList.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + (rect.width / 2), rect.top + (rect.height / 2));
    return Boolean(hit && element.contains(hit));
  });
  expect(paragraphMenuIsClickable).toBe(true);
  expect(await toolbarScroll.evaluate(element => element.scrollTop)).toBe(0);
  await paragraphList.getByRole('option', { name: '제목 2' }).click();

  const nextToolsButton = toolbar.getByRole('button', { name: '다음 편집 도구 보기' });
  await expect(nextToolsButton).toBeVisible();
  await nextToolsButton.click();
  await expect.poll(() => toolbarScroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await expect(toolbar.getByRole('button', { name: '이전 편집 도구 보기' })).toBeVisible();
  await nextToolsButton.focus();
  await toolbarScroll.evaluate(element => {
    element.scrollLeft = element.scrollWidth;
  });
  await expect(nextToolsButton).toHaveAttribute('aria-disabled', 'true');
  await expect(nextToolsButton).toBeFocused();

  const pageWidth = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(pageWidth.scrollWidth).toBeLessThanOrEqual(pageWidth.clientWidth);

  const listToggle = page.getByRole('button', { name: '목록', exact: true });
  await expect(listToggle).toHaveAttribute('aria-expanded', 'false');
  await listToggle.click();
  await expect(titleInput).toBeHidden();
  await expect(page.getByRole('heading', { name: /개 글/ })).toBeVisible();

  const returnToEditor = page.getByRole('button', { name: '편집기로 돌아가기' });
  await expect(returnToEditor).toBeFocused();
  await returnToEditor.click();
  await expect(titleInput).toBeVisible();
  await expect(listToggle).toBeFocused();
});

test('admin editor resizes an image from its border and keeps the saved width', async ({ page }) => {
  const uniqueId = Date.now();
  const title = `E2E image resize ${uniqueId}`;
  const slug = `e2e-image-resize-${uniqueId}`;
  let postId: string | null = null;

  await page.setViewportSize({ width: 960, height: 900 });
  await openAdminEditor(page);

  try {
    const created = await page.evaluate(async (payload) => {
      const response = await fetch('/api/posts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json() as Promise<{ id: string }>;
    }, {
      slug,
      title,
      summary: '이미지 테두리 크기 조절을 검증하는 테스트 글입니다.',
      category: '미분류',
      contentJson: {
        type: 'doc',
        content: [
          {
            type: 'image',
            attrs: {
              src: '/avatar.jpg',
              alt: '크기 조절 테스트 이미지',
              title: null,
              size: 'custom',
              dataWidth: '50%',
              width: null,
              style: null,
              caption: '테두리를 드래그해 크기를 조절합니다.'
            }
          }
        ]
      },
      publishedAt: '2026-08-26',
      tags: ['e2e'],
      status: 'draft',
      sections: []
    });
    postId = created.id;

    await page.goto(`/admin?section=posts&post=${postId}`);
    const image = page.locator('.image-component img').first();
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await image.click();

    const resizeHandle = page.getByRole('slider', { name: '이미지 너비 조절' });
    await expect(resizeHandle).toHaveAttribute('aria-valuenow', '50');
    const handleBox = await resizeHandle.boundingBox();
    if (!handleBox) throw new Error('이미지 크기 조절점을 찾을 수 없습니다.');

    await page.mouse.move(handleBox.x + (handleBox.width / 2), handleBox.y + (handleBox.height / 2));
    await page.mouse.down();
    await page.mouse.move(handleBox.x + (handleBox.width / 2) - 70, handleBox.y + (handleBox.height / 2));
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(resizeHandle).toHaveAttribute('aria-valuenow', '50');
    const restoredPointerStyles = await page.evaluate(() => ({
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect
    }));
    expect(restoredPointerStyles).toEqual({ cursor: '', userSelect: '' });

    await page.mouse.move(handleBox.x + (handleBox.width / 2), handleBox.y + (handleBox.height / 2));
    await page.mouse.down();
    await page.mouse.move(handleBox.x + (handleBox.width / 2) + 70, handleBox.y + (handleBox.height / 2));
    await page.mouse.up();

    const resizedPercent = Number(await resizeHandle.getAttribute('aria-valuenow'));
    expect(resizedPercent).toBeGreaterThan(50);
    expect(resizedPercent).toBeLessThanOrEqual(100);
    await page.mouse.move(handleBox.x + (handleBox.width / 2) + 140, handleBox.y + (handleBox.height / 2));
    await expect(resizeHandle).toHaveAttribute('aria-valuenow', String(resizedPercent));

    const updateResponsePromise = page.waitForResponse(response => (
      response.url().endsWith(`/api/posts/${postId}`)
      && response.request().method() === 'PUT'
    ));
    await page.getByRole('button', { name: '초안 저장', exact: true }).click();
    const updateResponse = await updateResponsePromise;
    expect(updateResponse.ok()).toBe(true);
    const savedPost = await updateResponse.json();
    const savedImage = savedPost.contentJson?.content?.find(
      (item: { type?: string }) => item.type === 'image'
    );
    expect(savedImage?.attrs?.dataWidth).toBe(`${resizedPercent}%`);
    expect(savedImage?.attrs?.size).toBe('custom');

    await page.reload();
    const reopenedImage = page.locator('.image-component img').first();
    await expect(reopenedImage).toBeVisible();
    await reopenedImage.click();
    const reopenedHandle = page.getByRole('slider', { name: '이미지 너비 조절' });
    await expect(reopenedHandle).toHaveAttribute('aria-valuenow', String(resizedPercent));

    await page.setViewportSize({ width: 390, height: 844 });
    await reopenedHandle.focus();
    await page.keyboard.press('Home');
    await expect(reopenedHandle).toHaveAttribute('aria-valuenow', '25');
    await expect(reopenedHandle).toBeFocused();
    await page.keyboard.press('End');
    await expect(reopenedHandle).toHaveAttribute('aria-valuenow', '100');
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(reopenedHandle).toHaveAttribute('aria-valuenow', '90');

    const mobileLayout = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(mobileLayout.scrollWidth).toBeLessThanOrEqual(mobileLayout.clientWidth);
  } finally {
    if (postId) await deletePostFromAdmin(page, postId);
  }
});

test('admin editor drags existing images into an undoable side-by-side layout', async ({ page }) => {
  const uniqueId = Date.now();
  const title = `E2E image layout drag ${uniqueId}`;
  const slug = `e2e-image-layout-drag-${uniqueId}`;
  let postId: string | null = null;

  await page.setViewportSize({ width: 1000, height: 900 });
  await openAdminEditor(page);

  try {
    const created = await page.evaluate(async (payload) => {
      const response = await fetch('/api/posts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json() as Promise<{ id: string }>;
    }, {
      slug,
      title,
      summary: '기존 이미지 드래그 레이아웃을 검증하는 테스트 글입니다.',
      category: '미분류',
      contentJson: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '레이아웃 앞 문단' }] },
          {
            type: 'image',
            attrs: {
              src: '/avatar.jpg?layout=a',
              alt: '레이아웃 이미지 A',
              size: 'custom',
              dataWidth: '75%',
              caption: 'A 캡션'
            }
          },
          {
            type: 'image',
            attrs: {
              src: '/avatar.jpg?layout=b',
              alt: '레이아웃 이미지 B',
              size: 'full',
              caption: 'B 캡션'
            }
          },
          { type: 'paragraph', content: [{ type: 'text', text: '레이아웃 뒤 문단' }] }
        ]
      },
      publishedAt: '2026-08-26',
      tags: ['e2e'],
      status: 'draft',
      sections: []
    });
    postId = created.id;
    await page.goto(`/admin?section=posts&post=${postId}`);

    const imageA = page.locator('img[alt="레이아웃 이미지 A"]');
    const imageB = page.locator('img[alt="레이아웃 이미지 B"]');
    await expect(imageA).toBeVisible();
    await expect(imageB).toBeVisible();
    const sourceBox = await imageA.boundingBox();
    const targetBox = await imageB.boundingBox();
    if (!sourceBox || !targetBox) throw new Error('이미지 드래그 좌표를 찾을 수 없습니다.');

    await page.mouse.move(sourceBox.x + (sourceBox.width / 2), sourceBox.y + (sourceBox.height / 2));
    await page.mouse.down();
    await page.mouse.move(sourceBox.x + (sourceBox.width / 2) + 8, sourceBox.y + (sourceBox.height / 2), { steps: 3 });
    await page.mouse.move(targetBox.x + targetBox.width - 8, targetBox.y + (targetBox.height / 2), { steps: 12 });

    const targetDecoration = page.locator('.image-layout-drop-target').filter({ has: imageB });
    await expect(targetDecoration).toHaveAttribute('data-image-drop-side', 'right');
    await page.mouse.up();

    const columns = page.locator('.ProseMirror [data-type="columns"]');
    await expect(columns).toHaveCount(1);
    await expect(columns.locator(':scope > [data-type="column"]')).toHaveCount(2);
    await expect.poll(() => columns.locator('img').evaluateAll(images => (
      images.map(image => image.getAttribute('alt'))
    ))).toEqual(['레이아웃 이미지 B', '레이아웃 이미지 A']);
    await expect(page.getByText('레이아웃 앞 문단')).toBeVisible();
    await expect(page.getByText('레이아웃 뒤 문단')).toBeVisible();

    await page.keyboard.press('Control+z');
    await expect(columns).toHaveCount(0);
    await expect.poll(() => page.locator('.ProseMirror .image-component img').evaluateAll(images => (
      images.map(image => image.getAttribute('alt'))
    ))).toEqual(['레이아웃 이미지 A', '레이아웃 이미지 B']);
    await page.keyboard.press('Control+Shift+z');
    await expect(columns).toHaveCount(1);

    const updateResponsePromise = page.waitForResponse(response => (
      response.url().endsWith(`/api/posts/${postId}`)
      && response.request().method() === 'PUT'
    ));
    await page.getByRole('button', { name: '초안 저장', exact: true }).click();
    const updateResponse = await updateResponsePromise;
    expect(updateResponse.ok()).toBe(true);
    const savedPost = await updateResponse.json();
    const savedLayout = savedPost.contentJson?.content?.find(
      (item: { type?: string }) => item.type === 'columns'
    );
    expect(savedLayout?.content).toHaveLength(2);
    expect(savedLayout?.content?.[0]?.content?.[0]?.attrs?.alt).toBe('레이아웃 이미지 B');
    expect(savedLayout?.content?.[1]?.content?.[0]?.attrs?.dataWidth).toBe('75%');

    await page.reload();
    await expect(page.locator('.ProseMirror [data-type="columns"]')).toHaveCount(1);

    await page.setViewportSize({ width: 390, height: 844 });
    const reopenedImageA = page.locator('img[alt="레이아웃 이미지 A"]');
    await reopenedImageA.click();
    const layoutControls = page.getByRole('group', { name: '이미지 배치' });
    await expect(layoutControls).toBeVisible();
    await expect(page.getByRole('button', { name: '레이아웃 해제' })).toHaveCount(1);
    const moveLeft = layoutControls.getByRole('button', { name: '이미지 열을 앞으로 이동 (왼쪽 또는 위)' });
    const moveRight = layoutControls.getByRole('button', { name: '이미지 열을 뒤로 이동 (오른쪽 또는 아래)' });
    await expect(moveLeft).toBeEnabled();
    await expect(moveRight).toBeDisabled();
    await moveLeft.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => columns.locator('img').evaluateAll(images => (
      images.map(image => image.getAttribute('alt'))
    ))).toEqual(['레이아웃 이미지 A', '레이아웃 이미지 B']);
    await expect(layoutControls).toBeVisible();
    await expect(page.locator('.ProseMirror')).toBeFocused();

    const mobileLayout = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(mobileLayout.scrollWidth).toBeLessThanOrEqual(mobileLayout.clientWidth);

    await layoutControls.getByRole('button', { name: '레이아웃 해제' }).click();
    await expect(columns).toHaveCount(0);
    await expect.poll(() => page.locator('.ProseMirror .image-component img').evaluateAll(images => (
      images.map(image => image.getAttribute('alt'))
    ))).toEqual(['레이아웃 이미지 A', '레이아웃 이미지 B']);
    await expect(page.getByText('레이아웃 앞 문단')).toBeVisible();
    await expect(page.getByText('레이아웃 뒤 문단')).toBeVisible();

    const ungroupSavePromise = page.waitForResponse(response => (
      response.url().endsWith(`/api/posts/${postId}`)
      && response.request().method() === 'PUT'
    ));
    await page.getByRole('button', { name: '초안 저장', exact: true }).click();
    const ungroupSaveResponse = await ungroupSavePromise;
    expect(ungroupSaveResponse.ok()).toBe(true);
    const ungroupedPost = await ungroupSaveResponse.json();
    expect(ungroupedPost.contentJson?.content?.some(
      (item: { type?: string }) => item.type === 'columns'
    )).toBe(false);

    await page.reload();
    await expect(page.locator('.ProseMirror [data-type="columns"]')).toHaveCount(0);
  } finally {
    if (postId) await deletePostFromAdmin(page, postId);
  }
});

test('image upload never inserts into a different post after navigation', async ({ page }) => {
  const uniqueId = Date.now();
  const firstTitle = `E2E upload race source ${uniqueId}`;
  const secondTitle = `E2E upload race target ${uniqueId}`;
  const postIds: string[] = [];
  let releaseUpload: (() => void) | null = null;
  const cleanedUploads: string[] = [];

  await openAdminEditor(page);
  try {
    const createdPosts = await page.evaluate(async ({ firstTitle, secondTitle, uniqueId }) => {
      const createPost = async (title: string, suffix: string) => {
        const response = await fetch('/api/posts', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            slug: `e2e-upload-race-${uniqueId}-${suffix}`,
            summary: '업로드 중 글 전환 경합을 검증하는 테스트 글입니다.',
            category: '미분류',
            contentJson: {
              type: 'doc',
              content: [{
                type: 'paragraph',
                content: [{ type: 'text', text: `${title} 본문` }]
              }]
            },
            status: 'draft',
            tags: [],
            sections: []
          })
        });
        if (!response.ok) throw new Error(await response.text());
        return response.json() as Promise<{ id: string }>;
      };
      return Promise.all([
        createPost(firstTitle, 'source'),
        createPost(secondTitle, 'target')
      ]);
    }, { firstTitle, secondTitle, uniqueId });
    postIds.push(...createdPosts.map(post => post.id));

    await page.goto(`/admin?section=posts&post=${postIds[0]}`);
    await expect(page.getByPlaceholder('제목을 입력하세요')).toHaveValue(firstTitle);

    let signalUploadStarted: (() => void) | null = null;
    const uploadStarted = new Promise<void>(resolve => { signalUploadStarted = resolve; });
    const uploadGate = new Promise<void>(resolve => { releaseUpload = resolve; });
    await page.route('**/api/uploads', async route => {
      signalUploadStarted?.();
      await uploadGate;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ filename: 'race.png', url: '/uploads/race.png' })
      });
    });
    await page.route('**/api/uploads/unused', async route => {
      if (route.request().method() !== 'DELETE') {
        await route.fallback();
        return;
      }
      const payload = route.request().postDataJSON() as { filenames?: string[] };
      cleanedUploads.push(...(payload.filenames ?? []));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ deleted: [], deletedBytes: 0, remainingUnused: [] })
      });
    });

    await page.getByTestId('editor-image-input').setInputFiles({
      name: 'race.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==', 'base64')
    });
    await uploadStarted;

    await page.evaluate((postId) => {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('post', postId);
      window.history.pushState({}, '', nextUrl);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, postIds[1]);
    await expect(page.getByPlaceholder('제목을 입력하세요')).toHaveValue(secondTitle);

    releaseUpload();
    releaseUpload = null;
    await expect(page.getByText('업로드 중 편집 중인 글이 바뀌어 이미지를 삽입하지 않았습니다. 다시 시도해 주세요.')).toBeVisible();
    await expect.poll(() => cleanedUploads).toEqual(['race.png']);
    await expect(page.locator('.ProseMirror img[src="/uploads/race.png"]')).toHaveCount(0);
    await expect(page.getByText(`${secondTitle} 본문`)).toBeVisible();
  } finally {
    releaseUpload?.();
    await page.unroute('**/api/uploads');
    await page.unroute('**/api/uploads/unused');
    for (const postId of postIds) await deletePostFromAdmin(page, postId);
  }
});

test('column layout conversion and ungrouping preserve every block and undo once', async ({ page }) => {
  const uniqueId = Date.now();
  const title = `E2E lossless columns ${uniqueId}`;
  let postId: string | null = null;

  await openAdminEditor(page);
  try {
    const created = await page.evaluate(async ({ title, uniqueId }) => {
      const response = await fetch('/api/posts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          slug: `e2e-lossless-columns-${uniqueId}`,
          summary: '열 변환과 해제 시 모든 블록 보존을 검증하는 테스트 글입니다.',
          category: '미분류',
          contentJson: {
            type: 'doc',
            content: [{
              type: 'columns',
              attrs: { layout: 'three-column' },
              content: [
                {
                  type: 'column',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: '첫 번째 열' }] }]
                },
                {
                  type: 'column',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: '두 번째 열 A' }] },
                    { type: 'paragraph', content: [{ type: 'text', text: '두 번째 열 B' }] }
                  ]
                },
                {
                  type: 'column',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: '세 번째 열 A' }] },
                    { type: 'paragraph', content: [{ type: 'text', text: '세 번째 열 B' }] }
                  ]
                }
              ]
            }]
          },
          status: 'draft',
          tags: [],
          sections: []
        })
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json() as Promise<{ id: string }>;
    }, { title, uniqueId });
    postId = created.id;
    await page.goto(`/admin?section=posts&post=${postId}`);

    const columns = page.locator('.ProseMirror [data-type="columns"]');
    const directColumns = columns.locator(':scope > [data-type="column"]');
    await expect(directColumns).toHaveCount(3);
    await expect(page.getByRole('button', { name: '2단 레이아웃' })).toBeHidden();
    // The editor mounts after the full document is ready. Select the layout
    // explicitly instead of relying on an initialization transaction to show its menu.
    await directColumns.first().getByText('첫 번째 열', { exact: true }).click();
    await expect(page.getByRole('button', { name: '2단 레이아웃' })).toBeVisible();
    // Moving keyboard focus into the menu must not hide it or lose selection.
    await page.getByRole('button', { name: '2단 레이아웃' }).focus();
    await expect(page.getByRole('button', { name: '레이아웃 해제' })).toBeVisible();
    await page.getByRole('button', { name: '2단 레이아웃' }).click();
    await expect(directColumns).toHaveCount(2);
    await expect(directColumns.nth(1)).toContainText('두 번째 열 A');
    await expect(directColumns.nth(1)).toContainText('두 번째 열 B');
    await expect(directColumns.nth(1)).toContainText('세 번째 열 A');
    await expect(directColumns.nth(1)).toContainText('세 번째 열 B');

    await page.keyboard.press('Control+z');
    await expect(directColumns).toHaveCount(3);
    await expect(directColumns.nth(2)).toContainText('세 번째 열 A');
    await expect(directColumns.nth(2)).toContainText('세 번째 열 B');

    await page.getByRole('button', { name: '레이아웃 해제' }).click();
    await expect(columns).toHaveCount(0);
    await expect.poll(() => page.locator('.ProseMirror > p').evaluateAll(paragraphs => (
      paragraphs.map(paragraph => paragraph.textContent)
    ))).toEqual([
      '첫 번째 열',
      '두 번째 열 A',
      '두 번째 열 B',
      '세 번째 열 A',
      '세 번째 열 B'
    ]);

    await page.keyboard.press('Control+z');
    await expect(directColumns).toHaveCount(3);
  } finally {
    if (postId) await deletePostFromAdmin(page, postId);
  }
});

test('a delayed saved table shows its menu only after focus and keeps keyboard menu actions undoable', async ({ page }) => {
  const uniqueId = Date.now();
  let postId: string | null = null;
  let releaseRead = () => {};
  const gate = new Promise<void>(resolve => { releaseRead = resolve; });
  await openAdminEditor(page);
  try {
    const created = await page.evaluate(async uniqueId => {
      const response = await fetch('/api/posts', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `E2E loaded table ${uniqueId}`, slug: `e2e-loaded-table-${uniqueId}`, status: 'draft', tags: [],
          contentJson: { type: 'doc', content: [{ type: 'table', content: [
            { type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '저장된 첫 셀' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '저장된 둘째 셀' }] }] }
            ] }
          ] }] }
        })
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json() as Promise<{ id: string }>;
    }, uniqueId);
    postId = created.id;
    await page.route('**/api/posts', async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response });
    });
    await page.goto(`/admin?section=posts&post=${postId}`);
    await expect(page.getByTestId('admin-post-load-state')).toContainText('선택한 글을 불러오는 중');
    await expect(page.locator('.ProseMirror')).toHaveCount(0);
    releaseRead();
    const table = page.locator('.ProseMirror table');
    await expect(table.locator('tr')).toHaveCount(1);
    const addRow = page.getByRole('button', { name: '아래에 행 추가', exact: true });
    await expect(addRow).toBeHidden();
    await table.getByText('저장된 첫 셀', { exact: true }).click();
    await expect(addRow).toBeVisible();
    await addRow.focus();
    await expect(addRow).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(table.locator('tr')).toHaveCount(2);
    await page.keyboard.press('Control+z');
    await expect(table.locator('tr')).toHaveCount(1);
    await expect(table).toContainText('저장된 첫 셀');
    await expect(table).toContainText('저장된 둘째 셀');
  } finally {
    releaseRead();
    await page.unroute('**/api/posts');
    if (postId) await deletePostFromAdmin(page, postId);
  }
});

test('admin editor inserts, renders, and reopens Mermaid diagrams', async ({ page }) => {
  await openAdminEditor(page);

  const toolbar = page.getByRole('toolbar', { name: '글 편집 도구' });
  await toolbar.getByRole('button', { name: '고급 삽입 메뉴' }).click();
  await page.getByRole('button', { name: /Mermaid 다이어그램/ }).click();

  const insertDialog = page.getByRole('dialog', { name: 'Mermaid 다이어그램 삽입' });
  const sourceInput = insertDialog.getByRole('textbox', { name: 'Mermaid 다이어그램 삽입' });
  const normalizedSource = [
    '%%{init: {"htmlLabels": true}}%%',
    'flowchart LR',
    '    A["사용자 브라우저"] --> B["Nginx<br/>80 · 443"]'
  ].join('\n');
  const fencedSource = ['```mermaid', normalizedSource, '```'].join('\n');
  await sourceInput.fill(fencedSource);
  await insertDialog.getByRole('button', { name: '삽입' }).click();

  const mermaidNode = page.locator('.mermaid-node');
  await expect(mermaidNode).toBeVisible();
  await expect(mermaidNode.locator('.mermaid-render svg')).toBeVisible({ timeout: 15_000 });
  await expect(mermaidNode.locator('.mermaid-render svg')).toContainText('사용자 브라우저');

  await mermaidNode.getByRole('button', { name: 'Mermaid 소스 편집' }).click();
  const editDialog = page.getByRole('dialog', { name: 'Mermaid 다이어그램 편집' });
  await expect(editDialog.getByRole('textbox')).toHaveValue(normalizedSource);
  await page.keyboard.press('Escape');
});

test('published fenced Mermaid code block renders as a public diagram', async ({ page }) => {
  const uniqueId = Date.now();
  const title = `E2E Mermaid Code Block ${uniqueId}`;
  const slug = `e2e-mermaid-code-block-${uniqueId}`;
  const mermaidSource = [
    '```mermaid',
    'flowchart LR',
    '    A["사용자 브라우저"] --> B["Nginx<br/>80 · 443"]',
    '```'
  ].join('\n');
  let postId: string | null = null;

  await openAdminEditor(page);

  try {
    const created = await page.evaluate(async (payload) => {
      const response = await fetch('/api/posts', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json() as Promise<{ id: string }>;
    }, {
      slug,
      title,
      summary: 'Mermaid fenced code block E2E coverage.',
      category: '미분류',
      contentJson: {
        type: 'doc',
        content: [
          {
            type: 'codeBlock',
            attrs: { language: 'plaintext' },
            content: [{ type: 'text', text: mermaidSource }]
          }
        ]
      },
      publishedAt: '2026-07-14',
      tags: ['e2e', 'mermaid'],
      status: 'published',
      sections: []
    });

    postId = created.id;

    await page.goto(`/posts/${slug}`);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();

    const diagram = page.locator('.mermaid-block svg');
    await expect(diagram).toBeVisible({ timeout: 15_000 });
    await expect(diagram).toContainText('사용자 브라우저');
    await expect(page.getByText('```mermaid')).toHaveCount(0);
  } finally {
    if (postId) {
      await deletePostFromAdmin(page, postId);
    }
  }
});

test('admin editor converts pasted Markdown and keeps rich, plain, and code pastes as before', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openAdminEditor(page);
  const editor = page.locator('.ProseMirror').first();
  const toolbar = page.getByRole('toolbar', { name: '글 편집 도구' });
  const paste = (entries: Record<string, string>) => editor.evaluate((element, data) => {
    const transfer = new DataTransfer();
    for (const [type, value] of Object.entries(data)) transfer.setData(type, value);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, entries);
  const clearEditor = async () => {
    await editor.press('Control+a');
    await editor.press('Delete');
  };
  const markdown = [
    '# 배포 가이드',
    '',
    '**굵게**와 `kubectl` [문서](https://example.com/docs)',
    '',
    '## 준비',
    '',
    '- 첫째',
    '- 둘째',
    '',
    '| 이름 | 값 |',
    '| --- | --- |',
    '| a | 1 |',
    '',
    '```ts',
    'const ready = true;',
    '```',
    '',
    '```mermaid',
    'graph TD',
    '  A-->B',
    '```'
  ].join('\n');

  await editor.click();
  await paste({ 'text/plain': markdown });
  await expect(editor.locator('h2')).toHaveText('배포 가이드');
  await expect(editor.locator('h3')).toHaveText('준비');
  await expect(editor.locator('h1')).toHaveCount(0);
  await expect(editor.locator('strong')).toHaveText('굵게');
  await expect(editor.locator('p code')).toHaveText('kubectl');
  await expect(editor.locator('a[href="https://example.com/docs"]')).toHaveText('문서');
  await expect(editor.locator('ul > li')).toHaveCount(2);
  await expect(editor.locator('table td').first()).toHaveText('a');
  await expect(editor.locator('pre code.language-ts')).toHaveText('const ready = true;');
  await expect(editor.locator('[data-type="mermaid"]')).toHaveCount(1);

  // The whole conversion is one paste step.
  await toolbar.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(editor.locator('h2, h3, ul, table, pre, [data-type="mermaid"]')).toHaveCount(0);

  await paste({ 'text/plain': '# 제목처럼 보임\n- 항목', 'text/html': '<p><em>리치 텍스트</em></p>' });
  await expect(editor.locator('em')).toHaveText('리치 텍스트');
  await expect(editor.locator('h2, ul')).toHaveCount(0);

  await clearEditor();
  await editor.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'V', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true
  })));
  await paste({ 'text/plain': '# 그대로 둘 제목\n- 그대로 둘 항목' });
  await expect(editor).toContainText('# 그대로 둘 제목');
  await expect(editor.locator('h2, ul')).toHaveCount(0);

  await clearEditor();
  await toolbar.getByRole('button', { name: '코드 블록', exact: true }).click();
  await paste({ 'text/plain': '# 코드 안의 주석\n- 목록 아님' });
  await expect(editor.locator('pre')).toHaveCount(1);
  await expect(editor.locator('pre')).toContainText('# 코드 안의 주석');
  await expect(editor.locator('h2, ul')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('publish shortcut opens the confirmation dialog instead of publishing immediately', async ({ page }) => {
  await openAdminEditor(page);
  await page.getByPlaceholder('제목을 입력하세요').fill('Shortcut publish safety');

  const toolbar = page.getByRole('toolbar', { name: '글 편집 도구' });
  const paragraphSelect = toolbar.getByRole('button', { name: /문단:/ });
  await paragraphSelect.click();
  const paragraphList = page.getByRole('listbox', { name: '문단' });
  await expect(paragraphList).toBeVisible();

  await page.keyboard.press('Control+Enter');
  const dialog = page.getByRole('dialog', { name: '발행 설정' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  await expect(paragraphList).toBeHidden();
  await expect(dialog.getByRole('button', { name: '비공개 저장' })).toBeVisible();
  const dialogLayout = await dialog.evaluate(element => {
    const dialogRect = element.getBoundingClientRect();
    const qualityRect = element.querySelector('[aria-labelledby="publish-quality-title"]')
      ?.getBoundingClientRect();
    return {
      scrollTop: element.scrollTop,
      qualityInsideViewport: Boolean(
        qualityRect
        && qualityRect.top >= dialogRect.top
        && qualityRect.top < dialogRect.bottom
      )
    };
  });
  expect(dialogLayout.scrollTop).toBeLessThanOrEqual(1);
  expect(dialogLayout.qualityInsideViewport).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(paragraphSelect).toBeFocused();
});

test('failed publish validation keeps the editor in draft status', async ({ page }) => {
  await openAdminEditor(page);
  await page.getByPlaceholder('제목을 입력하세요').fill('Publish validation status safety');

  await page.getByTestId('post-publish-button').click();
  const dialog = page.getByRole('dialog', { name: '발행 설정' });
  await dialog.locator('input[type="radio"]').first().check();
  await expect(dialog.locator('[data-quality-id="required-fields"]'))
    .toContainText('본문이 없습니다');
  await dialog.getByRole('button', { name: '공개 발행' }).click();

  await expect(dialog).toBeVisible();
  await expect(page.getByText('본문 내용을 입력하세요.')).toBeVisible();
  await expect(page.getByLabel('현재 글 상태: 초안')).toHaveText('초안');
});

test('publish dialog reports a duplicate post URL before saving', async ({ page }) => {
  const uniqueId = Date.now();
  const existingSlug = `e2e-duplicate-slug-${uniqueId}`;
  let existingPostId: string | null = null;

  await openAdminEditor(page);

  try {
    const created = await page.evaluate(async (payload) => {
      const response = await fetch('/api/posts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json() as Promise<{ id: string }>;
    }, {
      slug: existingSlug,
      title: `Existing duplicate URL post ${uniqueId}`,
      summary: '중복 URL 검증을 위해 미리 생성한 테스트 글입니다.',
      category: '미분류',
      contentJson: createParagraphDocument(`Existing post body ${uniqueId}.`),
      publishedAt: '2026-08-26',
      tags: [],
      status: 'draft',
      sections: []
    });
    existingPostId = created.id;

    await page.reload();
    await expect(page.getByPlaceholder('제목을 입력하세요')).toBeVisible();
    await page.getByPlaceholder('제목을 입력하세요').fill(`New post ${uniqueId}`);
    await page.getByTestId('post-publish-button').click();

    const dialog = page.getByRole('dialog', { name: '발행 설정' });
    await dialog.getByRole('textbox', { name: '글 URL' }).fill(existingSlug);

    const requiredFields = dialog.locator('[data-quality-id="required-fields"]');
    await expect(requiredFields).toContainText('이미 사용 중인 URL입니다');
    await expect(dialog.getByText('1개 필수 확인')).toBeVisible();
  } finally {
    if (existingPostId) {
      await page.keyboard.press('Escape').catch(() => undefined);
      await deletePostFromAdmin(page, existingPostId);
    }
  }
});

test('publish dialog shows non-blocking document quality guidance', async ({ page }) => {
  await openAdminEditor(page);
  await page.getByPlaceholder('제목을 입력하세요').fill('발행 품질 점검 테스트');

  const toolbar = page.getByRole('toolbar', { name: '글 편집 도구' });
  await toolbar.getByRole('button', { name: /문단:/ }).click();
  await page.getByRole('listbox', { name: '문단' }).getByRole('option', { name: '제목 3' }).click();

  const editor = page.locator('.ProseMirror').first();
  await editor.click();
  await page.keyboard.type('상위 제목 없이 작성된 소제목');

  await page.getByTestId('post-publish-button').click();
  const dialog = page.getByRole('dialog', { name: '발행 설정' });
  await dialog.locator('input[type="radio"]').first().check();

  const qualityRegion = dialog.getByRole('region', { name: '발행 전 점검' });
  await expect(qualityRegion).toBeVisible();
  await expect(qualityRegion.locator('[data-quality-id="heading-structure"]'))
    .toContainText('제목 2보다 먼저 나온 제목 3');
  await expect(qualityRegion.locator('[data-quality-id="seo-description"]'))
    .toContainText('50자 이상');
  await expect(dialog.getByRole('button', { name: '공개 발행' })).toBeEnabled();
});

test('admin editor detects autosave drafts with metadata-only changes', async ({ page }) => {
  const uniqueId = Date.now();
  const title = `E2E Autosave Metadata ${uniqueId}`;
  const slug = `e2e-autosave-metadata-${uniqueId}`;
  const summary = 'Metadata autosave regression test summary.';
  const publishedAt = '2026-07-01';
  const body = `Metadata autosave body ${uniqueId}.`;
  const contentJson = createParagraphDocument(body);
  let postId: string | null = null;

  await openAdminEditor(page);

  try {
    const created = await page.evaluate(async (payload) => {
      const response = await fetch('/api/posts', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json() as Promise<{ id: string }>;
    }, {
      slug,
      title,
      summary,
      category: '미분류',
      contentJson,
      publishedAt,
      tags: ['e2e'],
      status: 'draft',
      sections: []
    });

    postId = created.id;

    const draft = {
      title,
      slug,
      summary,
      category: '미분류',
      contentJson,
      contentHtml: '',
      publishedAt,
      tags: ['e2e'],
      series: '',
      featured: false,
      cover: '',
      status: 'draft',
      scheduledAt: '',
      seoTitle: '',
      seoDescription: '자동저장 SEO 설명만 변경됨',
      seoOgImage: '',
      seoCanonicalUrl: '',
      seoKeywords: ''
    };

    await page.evaluate(({ id, autosaveDraft }) => {
      localStorage.setItem(`hamlog_draft_${id}`, JSON.stringify({
        draft: autosaveDraft,
        updatedAt: '2026-07-01T00:00:00.000Z'
      }));
    }, { id: postId, autosaveDraft: draft });

    await page.goto(`/admin?section=posts&post=${postId}`);
    await expect(page.getByText('임시 저장본이 있습니다. 복구 또는 삭제를 선택하세요.')).toBeVisible();
  } finally {
    if (postId) {
      await deletePostFromAdmin(page, postId);
    }
  }
});

test('admin editor restores legacy partial autosave data safely', async ({ page }) => {
  await openAdminEditor(page);

  await page.evaluate(() => {
    localStorage.setItem('hamlog_draft_new', JSON.stringify({
      title: 'Legacy autosave title',
      contentHtml: '<p>Legacy autosave body</p>'
    }));
  });
  await page.reload();

  await expect(page.getByText('임시 저장본이 있습니다. 복구 또는 삭제를 선택하세요.')).toBeVisible();
  // Deliberately cross the autosave debounce: an unresolved recovery copy must survive.
  await page.waitForTimeout(1250);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hamlog_draft_new') || '{}').title))
    .toBe('Legacy autosave title');
  await page.getByRole('button', { name: '복구', exact: true }).click();
  await expect(page.getByPlaceholder('제목을 입력하세요')).toHaveValue('Legacy autosave title');
  await expect(page.locator('.ProseMirror').first()).toContainText('Legacy autosave body');
});

test('admin can publish a simple post and view it publicly', async ({ page }) => {
  const uniqueId = Date.now();
  const title = `E2E Editor Smoke ${uniqueId}`;
  const slug = `e2e-editor-smoke-${uniqueId}`;
  const body = `This post was created by an editor smoke test ${uniqueId}.`;
  const seoTitle = `SEO ${title}`;

  await openAdminEditor(page);
  await page.getByPlaceholder('제목을 입력하세요').fill(title);

  const editor = page.locator('.ProseMirror').first();
  await editor.click();
  await page.keyboard.type(body);

  await page.getByRole('button', { name: /^SEO/ }).click();
  await page.getByPlaceholder('검색 결과 제목').fill(seoTitle);

  await page.getByTestId('post-publish-button').click();
  const publishDialog = page.getByRole('dialog', { name: '발행 설정' });
  await expect(publishDialog).toBeVisible();
  await publishDialog.locator('input[type="radio"]').first().check();
  await expect(publishDialog.locator('[data-quality-id="seo-description"]'))
    .toContainText('권장');

  await Promise.all([
    page.waitForResponse(response =>
      response.url().includes('/api/posts') && response.request().method() === 'POST'
    ),
    publishDialog.getByRole('button', { name: '공개 발행' }).click()
  ]);

  await expect(page.getByText('발행되었습니다.')).toBeVisible();
  await expect(page.getByLabel('현재 글 상태: 발행')).toHaveText('발행');

  await page.keyboard.press('Control+Shift+S');
  await expect(publishDialog).toBeVisible();
  await expect(publishDialog.locator('input[type="radio"]').first()).toBeChecked();
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 1700, height: 900 });
  await page.goto(`/posts/${slug}`);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page.getByText(body)).toBeVisible();
  const measurePostContentWidth = () => page.locator('.post-content').evaluate(element =>
    Math.round(element.getBoundingClientRect().width)
  );
  const postContentWidth = await measurePostContentWidth();
  expect(postContentWidth).toBeGreaterThanOrEqual(840);
  expect(postContentWidth).toBeLessThanOrEqual(920);

  await page.setViewportSize({ width: 1535, height: 900 });
  const contentWidthBelowSidebarBreakpoint = await measurePostContentWidth();
  await page.setViewportSize({ width: 1536, height: 900 });
  const contentWidthWithSidebars = await measurePostContentWidth();
  expect(Math.abs(contentWidthWithSidebars - contentWidthBelowSidebarBreakpoint)).toBeLessThanOrEqual(2);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobilePageWidth = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(mobilePageWidth.scrollWidth).toBeLessThanOrEqual(mobilePageWidth.clientWidth);

  const seoResponse = await page.request.get(`${backendOrigin}/posts/${slug}`);
  expect(seoResponse.status()).toBe(200);
  const seoHtml = await seoResponse.text();
  expect(seoHtml).toContain(`<title>${seoTitle}</title>`);
  expect(seoHtml).toContain(`<meta property="og:type" content="article" />`);
  expect(seoHtml).toContain(`/posts/${slug}`);

  const detailResponse = await page.request.get(`${backendOrigin}/api/posts/${slug}`);
  expect(detailResponse.status()).toBe(200);
  const savedPost = await detailResponse.json();
  expect(savedPost.seo?.title).toBe(seoTitle);

  await page.goto('/admin');
  await page.evaluate(async (postSlug) => {
    const listResponse = await fetch('/api/posts', { credentials: 'include' });
    const { posts } = await listResponse.json();
    const target = posts.find((post: { id: string; slug: string }) => post.slug === postSlug);
    if (target) {
      await fetch(`/api/posts/${target.id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
    }
  }, slug);
});

test('public SPA keeps images, robots, and BlogPosting schema in sync across routes', async ({ page }) => {
  const uniqueId = Date.now();
  const title = `E2E SEO Route State ${uniqueId}`;
  const slug = `e2e-seo-route-state-${uniqueId}`;
  let postId: string | null = null;

  const readBlogPostingSchemas = () => page.evaluate(() => (
    Array.from(document.head.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'))
      .map(script => {
        try {
          return JSON.parse(script.textContent ?? '');
        } catch {
          return null;
        }
      })
      .filter(schema => schema?.['@type'] === 'BlogPosting')
  ));
  const navigateInSpa = (path: string) => page.evaluate(nextPath => {
    window.history.pushState({}, '', nextPath);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);

  await openAdminEditor(page);

  try {
    const created = await page.evaluate(async (payload) => {
      const response = await fetch('/api/posts', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json() as Promise<{ id: string }>;
    }, {
      slug,
      title,
      summary: 'Client-side SEO state regression coverage.',
      category: '미분류',
      contentJson: createParagraphDocument('SEO route state body.'),
      publishedAt: '2026-08-10',
      tags: ['e2e', 'seo'],
      status: 'published',
      sections: []
    });
    postId = created.id;

    await page.goto('/');
    await expect(page.getByRole('heading', { name: '전체 글' })).toBeVisible();
    const homeOgImage = page.locator('meta[property="og:image"]');
    const homeTwitterImage = page.locator('meta[name="twitter:image"]');
    await expect(homeOgImage).toHaveCount(1);
    await expect(homeTwitterImage).toHaveCount(1);
    await expect.poll(() => homeOgImage.getAttribute('content')).not.toBe('');
    const hydratedHomeImage = await homeOgImage.getAttribute('content');
    expect(hydratedHomeImage).toBeTruthy();
    await expect(homeTwitterImage).toHaveAttribute('content', hydratedHomeImage!);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', /\/favicon\.svg$/);

    let releasePostRequest: (() => void) | undefined;
    let markPostRequestStarted: (() => void) | undefined;
    const postRequestGate = new Promise<void>(resolve => {
      releasePostRequest = resolve;
    });
    const postRequestStarted = new Promise<void>(resolve => {
      markPostRequestStarted = resolve;
    });
    await page.route(`**/api/posts/${slug}`, async route => {
      markPostRequestStarted?.();
      await postRequestGate;
      await route.continue();
    });

    await page.evaluate(({ postTitle, postSlug }) => {
      document.title = postTitle;
      document.querySelector('link[rel="canonical"]')?.setAttribute(
        'href',
        `${window.location.origin}/posts/${postSlug}`
      );
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.text = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: postTitle
      });
      document.head.appendChild(script);
    }, { postTitle: title, postSlug: slug });

    await navigateInSpa(`/posts/${slug}`);
    await postRequestStarted;
    try {
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
      await expect(page).toHaveTitle(title);
      expect(await readBlogPostingSchemas()).toHaveLength(1);
    } finally {
      releasePostRequest?.();
    }

    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await page.unroute(`**/api/posts/${slug}`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await expect.poll(async () => (await readBlogPostingSchemas()).length).toBe(1);
    const [postSchema] = await readBlogPostingSchemas();
    expect(postSchema.headline).toBe(title);
    expect(postSchema.publisher?.logo?.url).toMatch(/\/favicon\.svg$/);

    await page.getByRole('link', { name: '메인화면으로 돌아가기' }).click();
    await expect(page.getByRole('heading', { name: '전체 글' })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await expect.poll(async () => (await readBlogPostingSchemas()).length).toBe(0);

    await navigateInSpa(`/posts/${slug}`);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await expect.poll(async () => (await readBlogPostingSchemas()).length).toBe(1);

    await navigateInSpa(`/posts/missing-${uniqueId}`);
    await expect(page.getByRole('heading', { name: '해당 글이 존재하지 않습니다.' })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    await expect.poll(async () => (await readBlogPostingSchemas()).length).toBe(0);

    await navigateInSpa(`/missing-page-${uniqueId}`);
    await expect(page.getByRole('heading', { name: '페이지를 찾을 수 없습니다' })).toBeVisible();
    await expect(page.getByText('404 · Not Found')).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    expect(await readBlogPostingSchemas()).toHaveLength(0);

    await page.getByRole('link', { name: '홈으로 돌아가기' }).click();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await expect.poll(() => page.locator('meta[property="og:image"]').getAttribute('content')).not.toBe('');
    await expect.poll(() => page.locator('meta[name="twitter:image"]').getAttribute('content')).not.toBe('');
  } finally {
    if (postId) {
      await deletePostFromAdmin(page, postId);
    }
  }
});
