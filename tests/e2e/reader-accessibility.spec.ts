import { expect, test, type APIRequestContext } from '@playwright/test';

const backendOrigin = `http://127.0.0.1:${process.env.E2E_API_PORT ?? process.env.PORT ?? '4100'}`;

async function createPostWithComment(request: APIRequestContext) {
  const login = await request.post(`${backendOrigin}/api/auth/login`, {
    data: { password: process.env.ADMIN_PASSWORD ?? 'e2e-password' }
  });
  expect(login.ok()).toBe(true);
  const cookie = login.headers()['set-cookie']?.split(';', 1)[0] ?? '';
  const slug = `reader-a11y-${Date.now()}`;
  const created = await request.post(`${backendOrigin}/api/posts`, {
    headers: { Cookie: cookie, Origin: backendOrigin },
    data: {
      slug, title: slug, summary: '독자 접근성을 확인하는 글입니다.',
      category: '미분류', tags: [], status: 'published', publishedAt: '2026-01-01', sections: [],
      contentHtml: '<h2>본문</h2><p>내용입니다.</p>'
    }
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json() as { id: string };
  const comment = await request.post(`${backendOrigin}/api/comments`, {
    headers: { Origin: backendOrigin },
    data: { postId: id, author: '독자', password: 'reader-pass', content: '접근성 확인 댓글' }
  });
  expect(comment.status()).toBe(201);
  return {
    slug,
    cleanup: async () => {
      const removed = await request.delete(`${backendOrigin}/api/posts/${id}`, {
        headers: { Cookie: cookie, Origin: backendOrigin }
      });
      expect(removed.status()).toBe(204);
    }
  };
}

test('keyboard readers can skip to the content and use the comment dialog', async ({ page, request }) => {
  const fixture = await createPostWithComment(request);
  try {
    await page.goto(`/posts/${fixture.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: fixture.slug })).toBeVisible();

    // The skip link is the first stop and moves focus into the main content.
    await page.keyboard.press('Tab');
    const skipLink = page.getByRole('link', { name: '본문으로 건너뛰기' });
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main-content')).toBeFocused();

    // Comment inputs have names, not only placeholders.
    await expect(page.getByRole('textbox', { name: '이름' })).toBeVisible();
    await expect(page.getByLabel('댓글 비밀번호')).toBeVisible();
    await expect(page.getByRole('textbox', { name: '댓글 내용' })).toBeVisible();

    // The delete button is reachable by keyboard and opens a real dialog.
    const deleteButton = page.getByRole('button', { name: '독자님의 댓글 삭제' });
    await deleteButton.focus();
    await expect(deleteButton).toHaveCSS('opacity', '1');
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: '댓글 삭제' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('댓글 비밀번호')).toBeFocused();

    // Tab stays inside the dialog, and Escape closes it and returns focus.
    for (let step = 0; step < 4; step += 1) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(deleteButton).toBeFocused();
  } finally {
    await fixture.cleanup();
  }
});

// Each test publishes its own post so the home page always has a card to check,
// whatever other tests or a fresh CI data directory left behind.
test('cards that replace the server-rendered home are not animated in again', async ({ page, request }) => {
  const fixture = await createPostWithComment(request);
  try {
    await page.goto(`${backendOrigin}/`);
    await expect(page.locator('[data-prerendered]')).toHaveCount(0);
    const card = page.locator(`main#main-content a[href="/posts/${fixture.slug}"]`).first();
    await expect(card).toBeVisible();
    await expect(page.locator('main#main-content .animate-slide-up')).toHaveCount(0);
  } finally {
    await fixture.cleanup();
  }
});

test('card entrance animations respect reduced motion', async ({ browser, request }) => {
  const fixture = await createPostWithComment(request);
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  try {
    // The development server has no server-rendered page, so cards use the animation class.
    await page.goto('/');
    const animated = page.locator(`main#main-content a.animate-slide-up[href="/posts/${fixture.slug}"]`).first();
    await expect(animated).toBeVisible();
    await expect(animated).toHaveCSS('animation-name', 'none');
  } finally {
    await context.close();
    await fixture.cleanup();
  }
});
