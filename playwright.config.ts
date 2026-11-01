import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results/e2e',
  fullyParallel: false,
  workers: 2,
  timeout: 60_000,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4317',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm dev --host 127.0.0.1 --port 4317',
    url: 'http://127.0.0.1:4317',
    reuseExistingServer: true,
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'], viewport: { width: 844, height: 390 }, isMobile: true },
    },
    {
      name: 'edge-cross-browser',
      grep: /@cross-browser/,
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },
    {
      name: 'firefox-cross-browser',
      grep: /@cross-browser/,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'ios-webkit-cross-browser',
      grep: /@cross-browser/,
      use: { ...devices['iPhone 13'] },
    },
  ],
});
