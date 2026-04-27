import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests-e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:7373',
    headless: true,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
});
