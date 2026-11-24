// End-to-end tests: the real app in a real browser, against its own API and a fresh database.
// Run them with scripts/e2e.sh, which makes the database; Playwright starts both servers.
// The app is built first and served as it ships (vite build, then vite preview), not by the dev
// server: that tests the real bundle, and loads far faster on a slow CI machine (measured).
import { defineConfig, devices } from '@playwright/test'

const CI = !!process.env.CI
const API = 'http://localhost:8011'
const APP = 'http://localhost:5174'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  // every test signs up its own company, so they run side by side without touching each other
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: APP,
    // the app counts days in Tashkent; so does the browser, whatever machine runs the tests
    timezoneId: 'Asia/Tashkent',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: process.env.E2E_API_COMMAND ?? 'poetry run uvicorn app.main:main_app --port 8011',
      cwd: '..',
      url: `${API}/api/v1/auth/me`, // answers 401 once it's up
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
    {
      command: 'npx vite build && npx vite preview --port 5174 --strictPort',
      url: APP,
      env: { OPEN_ERP_API: API },
      reuseExistingServer: !CI,
    },
  ],
})
