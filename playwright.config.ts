import { defineConfig, devices } from '@playwright/test';

const API_PORT = process.env.E2E_API_PORT ?? process.env.PORT ?? '4100';
const WEB_PORT = process.env.E2E_WEB_PORT ?? '5174';
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;
const shouldReuseServer = process.env.PLAYWRIGHT_REUSE_SERVER === 'true';
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 8_000
  },
  forbidOnly: isCI,
  // One retry keeps a single flaky run from blocking a deploy; such tests are still
  // reported as flaky. Failures keep a trace and screenshot for the uploaded artifact.
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_ORIGIN,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: [
    {
      command: `HAMLOG_DATA_DIR=.tmp/e2e/data HAMLOG_UPLOAD_DIR=.tmp/e2e/uploads PORT=${API_PORT} ADMIN_PASSWORD=${process.env.ADMIN_PASSWORD ?? 'e2e-password'} JWT_SECRET=${process.env.JWT_SECRET ?? 'e2e-secret'} CORS_ORIGINS=${WEB_ORIGIN} npm run server`,
      url: `${API_ORIGIN}/api/health`,
      reuseExistingServer: shouldReuseServer,
      timeout: 30_000
    },
    {
      command: `VITE_DEV_API_TARGET=${API_ORIGIN} npm run dev -- --host 127.0.0.1 --port ${WEB_PORT}`,
      url: WEB_ORIGIN,
      reuseExistingServer: shouldReuseServer,
      timeout: 30_000
    }
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
