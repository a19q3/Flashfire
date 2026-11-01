import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/release',
  outputDir: './test-results/release',
  workers: 1,
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4320',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: 'pnpm exec vite preview --host 127.0.0.1 --port 4320 --outDir .release/site',
    url: 'http://127.0.0.1:4320',
    reuseExistingServer: false,
  },
});
