import { expect, test } from '@playwright/test';

const backendOrigin = `http://127.0.0.1:${process.env.E2E_API_PORT ?? process.env.PORT ?? '4100'}`;

test('production home defers the editor bundle until the authenticated editor opens', async ({ page }) => {
  const scripts: string[] = [];
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/assets/') && pathname.endsWith('.js')) scripts.push(pathname);
  });

  await page.goto(`${backendOrigin}/`, { waitUntil: 'networkidle' });
  await expect(page.locator('.public-site h1').first()).toBeVisible();
  expect(scripts.some(pathname => pathname.includes('/editor-vendor-'))).toBe(false);

  const login = await page.request.post(`${backendOrigin}/api/auth/login`, {
    data: { password: process.env.ADMIN_PASSWORD ?? 'e2e-password' }
  });
  expect(login.ok()).toBe(true);
  await page.goto(`${backendOrigin}/admin?section=posts`);
  await expect(page.locator('.ProseMirror')).toBeVisible();
  expect(scripts.some(pathname => pathname.includes('/editor-vendor-'))).toBe(true);
});

test('production home keeps a styled shell until bootstrap hydration completes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });

  let releaseClientBundle = () => {};
  const clientBundleGate = new Promise<void>(resolve => {
    releaseClientBundle = resolve;
  });

  await page.route(/\/assets\/.*\.js(?:\?.*)?$/, async route => {
    await clientBundleGate;
    await route.continue();
  });

  const navigation = page.goto(`${backendOrigin}/`, { waitUntil: 'load' });

  try {
    const shell = page.locator('[data-prerendered="home"]');
    await expect(shell).toBeVisible();
    await expect(shell).toHaveClass(/public-site/);
    // The HTML can be visible before the stylesheet finishes loading while JS is gated.
    await expect(shell).toHaveCSS('font-family', /Noto Serif KR/);
    await expect(page.locator('.prerender-section')).toBeVisible();
    await expect(page.getByText('블로그 정보 불러오는 중...', { exact: true })).toHaveCount(0);

    const shellMetrics = await shell.evaluate(element => {
      const container = element.querySelector('.prerender-container');
      const containerRect = container?.getBoundingClientRect();
      return {
        fontFamily: getComputedStyle(element).fontFamily,
        containerWidth: containerRect?.width ?? 0
      };
    });

    expect(shellMetrics.fontFamily).toContain('Noto Serif KR');
    expect(shellMetrics.containerWidth).toBeGreaterThan(700);
    expect(shellMetrics.containerWidth).toBeLessThan(1280);
  } finally {
    releaseClientBundle();
    await navigation;
  }

  await expect(page.locator('[data-prerendered]')).toHaveCount(0);
  await expect(page.getByText('블로그 정보 불러오는 중...', { exact: true })).toHaveCount(0);
  await expect(page.locator('.public-site h1').first()).toBeVisible();
});

test('direct production post preserves rich editor content through bootstrap', async ({ page, request }) => {
  const uniqueId = Date.now();
  const title = `Bootstrap rich content ${uniqueId}`;
  const slug = `bootstrap-rich-content-${uniqueId}`;
  let postId = '';

  const loginResponse = await request.post(`${backendOrigin}/api/auth/login`, {
    data: { password: process.env.ADMIN_PASSWORD ?? 'e2e-password' }
  });
  expect(loginResponse.status()).toBe(200);
  const authCookie = loginResponse.headers()['set-cookie']?.split(';', 1)[0] ?? '';
  expect(authCookie).not.toBe('');

  try {
    const createResponse = await request.post(`${backendOrigin}/api/posts`, {
      headers: { Cookie: authCookie, Origin: backendOrigin },
      data: {
        slug,
        title,
        summary: '초기 데이터가 리치 콘텐츠 표현을 보존하는지 확인합니다.',
        category: '미분류',
        contentJson: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: '인라인 수식 ' },
                { type: 'math', attrs: { latex: 'x^2' } }
              ]
            },
            {
              type: 'mermaid',
              attrs: { source: 'flowchart LR\n    A[직접 접속] --> B[정상 표시]' }
            },
            {
              type: 'columns',
              attrs: { layout: 'two-column' },
              content: [
                {
                  type: 'column',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: '왼쪽 열' }] }]
                },
                {
                  type: 'column',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: '오른쪽 열' }] }]
                }
              ]
            },
            {
              type: 'linkCard',
              attrs: {
                url: 'https://example.com/guide',
                title: '문서 카드',
                description: '링크 카드 설명',
                image: '',
                domain: 'example.com'
              }
            }
          ]
        },
        publishedAt: '2026-08-24',
        tags: ['bootstrap', 'rich-content'],
        status: 'published',
        sections: []
      }
    });
    expect(createResponse.status()).toBe(201);
    const created = await createResponse.json() as { id: string };
    postId = created.id;

    await page.goto(`${backendOrigin}/posts/${slug}`);

    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByText('글 불러오는 중...', { exact: true })).toHaveCount(0);
    await expect(page.locator('.math-render .katex')).toBeVisible();
    await expect(page.locator('.mermaid-block svg')).toContainText('직접 접속', { timeout: 15_000 });
    await expect(page.locator('div[data-type="columns"]')).toBeVisible();
    await expect(page.getByRole('link', { name: /문서 카드/ })).toHaveAttribute(
      'href',
      'https://example.com/guide'
    );
  } finally {
    if (postId) {
      const deleteResponse = await request.delete(`${backendOrigin}/api/posts/${postId}`, {
        headers: { Cookie: authCookie, Origin: backendOrigin },
        // Rendering can outlast the HTTP keep-alive socket. Retry only a
        // connection reset for this idempotent fixture cleanup, not assertions.
        maxRetries: 1
      });
      expect(deleteResponse.status()).toBe(204);
    }
  }
});

test('production post keeps the prerendered article until the post page is ready', async ({ page, request }) => {
  const login = await request.post(`${backendOrigin}/api/auth/login`, {
    data: { password: process.env.ADMIN_PASSWORD ?? 'e2e-password' }
  });
  expect(login.ok()).toBe(true);
  const cookie = login.headers()['set-cookie']?.split(';', 1)[0] ?? '';
  const slug = `prerender-handoff-${Date.now()}`;
  const created = await request.post(`${backendOrigin}/api/posts`, {
    headers: { Cookie: cookie, Origin: backendOrigin },
    data: {
      slug, title: slug, summary: '미리 그린 글이 실제 글 화면으로 바로 넘어가는지 확인합니다.',
      category: '미분류', tags: [], status: 'published', publishedAt: '2026-01-01', sections: [],
      contentHtml: '<h2>첫 절</h2><p>본문입니다.</p>'
    }
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json() as { id: string };

  // The post HTML starts downloading the lazy post page with the entry script,
  // and the build manifest that lists the chunks is not served.
  const postHtml = await (await request.get(`${backendOrigin}/posts/${slug}`)).text();
  expect(postHtml).toMatch(/<link rel="modulepreload" crossorigin href="\/assets\/PostPage-[^"]+\.js" \/>/);
  expect((await request.get(`${backendOrigin}/.vite/manifest.json`)).status()).toBe(404);

  // Hold back only the post page chunk; everything else loads normally.
  let releasePostPage = () => {};
  const postPageGate = new Promise<void>(resolve => { releasePostPage = resolve; });
  await page.route(/\/assets\/PostPage-[^/]+\.js(?:\?.*)?$/, async route => {
    await postPageGate;
    await route.continue();
  });

  try {
    await page.goto(`${backendOrigin}/posts/${slug}`, { waitUntil: 'commit' });
    const prerendered = page.locator('[data-prerendered="post"]');
    await expect(prerendered).toBeVisible();
    // The client app has started (React root mounted) but the post page is still loading.
    await expect(page.locator('#root')).toBeAttached();
    await page.waitForTimeout(500);
    await expect(prerendered).toBeVisible();
    await expect(page.getByText('페이지 불러오는 중...', { exact: true })).toHaveCount(0);

    releasePostPage();
    await expect(page.locator('[data-prerendered]')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: slug })).toBeVisible();
    await expect(page.getByText('페이지 불러오는 중...', { exact: true })).toHaveCount(0);
  } finally {
    releasePostPage();
    const removed = await request.delete(`${backendOrigin}/api/posts/${id}`, {
      headers: { Cookie: cookie, Origin: backendOrigin }
    });
    expect(removed.status()).toBe(204);
  }
});
