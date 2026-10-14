import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5174/'

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: 'scratch-gpu.spec.ts',
  outputDir: 'test-results',
  fullyParallel: true,
  use: { baseURL, screenshot: 'only-on-failure', trace: 'retain-on-failure', reducedMotion: 'reduce' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run preview -- --port 5174 --strictPort',
    url: baseURL,
    env: { VITE_BASE_PATH: new URL(baseURL).pathname },
    reuseExistingServer: false,
  },
})
