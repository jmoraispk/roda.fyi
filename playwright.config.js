import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:8137',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'python tools/serve.py 8137',
    url: 'http://127.0.0.1:8137',
    reuseExistingServer: true,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 840 },
      },
    },
  ],
});
