import { expect, test, type APIRequestContext } from '@playwright/test';

const backendOrigin = `http://127.0.0.1:${process.env.E2E_API_PORT ?? process.env.PORT ?? '4100'}`;
const codeBlock = (language: string, text: string) => ({
  type: 'codeBlock',
  attrs: { language },
  content: [{ type: 'text', text }]
});

// The author typed these entity names literally, e.g. in a post about HTML escaping.
const ESCAPING_EXAMPLE = 'a &lt; b &amp;&amp; c';
const PYTHON_EXAMPLE = 'def greet(name):\n    return name';

async function createPost(request: APIRequestContext) {
  const login = await request.post(`${backendOrigin}/api/auth/login`, {
    data: { password: process.env.ADMIN_PASSWORD ?? 'e2e-password' }
  });
  expect(login.ok()).toBe(true);
  const cookie = login.headers()['set-cookie']?.split(';', 1)[0] ?? '';
  const slug = `code-blocks-${Date.now()}`;
  const response = await request.post(`${backendOrigin}/api/posts`, {
    headers: { Cookie: cookie, Origin: backendOrigin },
    data: {
      slug, title: slug, summary: '코드 블록 표시와 복사를 확인하는 글입니다.',
      category: '미분류', tags: [], status: 'published', publishedAt: '2026-01-01', sections: [],
      contentJson: { type: 'doc', content: [codeBlock('xml', ESCAPING_EXAMPLE), codeBlock('python', PYTHON_EXAMPLE)] }
    }
  });
  expect(response.status()).toBe(201);
  const saved = await response.json() as { id: string };
  return {
    slug,
    cleanup: async () => {
      const removed = await request.delete(`${backendOrigin}/api/posts/${saved.id}`, {
        headers: { Cookie: cookie, Origin: backendOrigin }
      });
      expect(removed.status()).toBe(204);
    }
  };
}

test('code blocks show and copy literal entities, and highlight Python', async ({ page, context, request }) => {
  const fixture = await createPost(request);
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(`/posts/${fixture.slug}`);

    const escapingBlock = page.locator('.post-content pre').filter({ hasText: 'a &lt; b' });
    await expect(escapingBlock).toContainText(ESCAPING_EXAMPLE);

    const copyButtons = page.getByRole('button', { name: '코드 복사' });
    await expect(copyButtons).toHaveCount(2);
    await copyButtons.first().click();
    await expect(page.getByRole('button', { name: '코드 복사됨' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(ESCAPING_EXAMPLE);

    const pythonBlock = page.locator('.post-content pre').filter({ hasText: 'def greet' });
    // react-syntax-highlighter keeps only the "token" class and colors tokens inline.
    const keyword = pythonBlock.locator('span.token', { hasText: /^def$/ });
    await expect(keyword).toHaveCount(1);
    await expect(keyword).not.toHaveCSS('color', 'rgb(212, 212, 212)');
  } finally {
    await fixture.cleanup();
  }
});

test('a denied clipboard does not claim the code was copied', async ({ page, request }) => {
  const fixture = await createPost(request);
  try {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) }
      });
    });
    await page.goto(`/posts/${fixture.slug}`);
    const copy = page.getByRole('button', { name: '코드 복사' }).first();
    await copy.click();
    await expect(page.getByRole('button', { name: '코드 복사됨' })).toHaveCount(0);
    await expect(copy).toBeVisible();
  } finally {
    await fixture.cleanup();
  }
});
