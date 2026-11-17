import { expect, test } from '@playwright/test';

const backendOrigin = `http://127.0.0.1:${process.env.E2E_API_PORT ?? process.env.PORT ?? '4100'}`;

test('게시글 카드는 저장된 조회수를 오른쪽 하단에 표시한다', async ({ page, request }) => {
  const uniqueId = Date.now();
  const title = `조회수 카드 테스트 ${uniqueId}`;
  const slug = `post-card-views-${uniqueId}`;
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
        summary: '게시글 카드 오른쪽 하단의 조회수 표시를 검증합니다.',
        category: '테스트',
        contentJson: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '조회수 테스트 본문' }] }]
        },
        publishedAt: new Date().toISOString(),
        tags: ['조회수', '카드'],
        status: 'published',
        sections: []
      }
    });
    expect(createResponse.status()).toBe(201);
    const created = await createResponse.json() as { id: string };
    postId = created.id;

    for (let index = 0; index < 2; index += 1) {
      // View counting only accepts the site's own origin, like a reader's browser sends.
      const viewResponse = await request.post(`${backendOrigin}/api/posts/${slug}/view`, {
        headers: { Origin: backendOrigin }
      });
      expect(viewResponse.status()).toBe(200);
    }

    await page.goto('/');
    const compactCard = page.locator('#writing').locator(`a[href="/posts/${slug}"]`);
    const viewCount = compactCard.getByTestId('post-view-count');
    await expect(compactCard).toBeVisible();
    await expect(viewCount).toHaveText('조회 2회');
    await expect(viewCount).toHaveAttribute('aria-label', '조회 2회');

    const desktopPosition = await compactCard.evaluate(card => {
      const counter = card.querySelector<HTMLElement>('[data-testid="post-view-count"]');
      if (!counter) throw new Error('조회수 표시를 찾을 수 없습니다.');
      const cardRect = card.getBoundingClientRect();
      const counterRect = counter.getBoundingClientRect();
      return {
        rightGap: Math.round(cardRect.right - counterRect.right),
        bottomGap: Math.round(cardRect.bottom - counterRect.bottom)
      };
    });
    expect(desktopPosition.rightGap).toBeGreaterThanOrEqual(10);
    expect(desktopPosition.rightGap).toBeLessThanOrEqual(20);
    expect(desktopPosition.bottomGap).toBeGreaterThanOrEqual(10);
    expect(desktopPosition.bottomGap).toBeLessThanOrEqual(20);

    await page.setViewportSize({ width: 320, height: 720 });
    await expect(viewCount).toBeVisible();
    const pageWidth = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(pageWidth.scrollWidth).toBeLessThanOrEqual(pageWidth.clientWidth);
  } finally {
    if (postId) {
      const deleteResponse = await request.delete(`${backendOrigin}/api/posts/${postId}`, {
        headers: { Cookie: authCookie, Origin: backendOrigin }
      });
      expect(deleteResponse.status()).toBe(204);
    }
  }
});
