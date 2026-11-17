import { expect, test } from '@playwright/test';

const backendOrigin = `http://127.0.0.1:${process.env.E2E_API_PORT ?? process.env.PORT ?? '4100'}`;

test('home canonical stays on the site base when filters are in the URL', async ({ page, request }) => {
  // Use the real profile but without a configured site URL, so the page must fall back
  // to its own origin instead of copying the filtered address. The profile is fetched
  // once up front so late duplicate requests never read a disposed response.
  const { profile } = await (await request.get(`${backendOrigin}/api/profile`)).json();
  await page.route(url => url.pathname === '/api/profile', route => route.fulfill({
    json: { profile: { ...profile, siteUrl: '' } }
  }));

  await page.goto('/?category=%EA%B0%9C%EB%B0%9C&tag=list');
  const origin = new URL(page.url()).origin;

  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', origin);
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', origin);
});
