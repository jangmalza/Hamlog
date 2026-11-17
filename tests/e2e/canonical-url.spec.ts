import { expect, test } from '@playwright/test';

test('home canonical stays on the site base when filters are in the URL', async ({ page }) => {
  // Use the real profile but without a configured site URL, so the page must fall back
  // to its own origin instead of copying the filtered address.
  await page.route(url => url.pathname === '/api/profile', async route => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, profile: { ...body.profile, siteUrl: '' } } });
  });

  await page.goto('/?category=%EA%B0%9C%EB%B0%9C&tag=list');
  const origin = new URL(page.url()).origin;

  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', origin);
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', origin);
});
