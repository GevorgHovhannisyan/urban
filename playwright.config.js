import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PORT || 4174;
const BASE_URL = process.env.TEST_BASE_URL || `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e/specs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // Skipped when TEST_BASE_URL is set explicitly (e.g. to point at an
  // already-running server) — otherwise Playwright boots an isolated
  // instance itself (see bootstrap-server.mjs) with its own temp database,
  // never the shared dev/production one.
  webServer: process.env.TEST_BASE_URL ? undefined : {
    command: 'node tests/e2e/bootstrap-server.mjs',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
