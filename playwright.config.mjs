import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: 'scratch-gpu.spec.ts',
  outputDir: 'test-results',
  fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:5174', screenshot: 'only-on-failure', trace: 'retain-on-failure', reducedMotion: 'reduce' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: { command: 'npm run preview -- --port 5174 --strictPort', url: 'http://127.0.0.1:5174', reuseExistingServer: false },
})
