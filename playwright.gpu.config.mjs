import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'scratch-gpu.spec.ts',
  outputDir: 'test-results/gpu',
  use: {
    baseURL: 'http://127.0.0.1:5175',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader'] },
  },
  projects: [
    { name: 'gpu-chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev -- --port 5175 --strictPort',
    url: 'http://127.0.0.1:5175',
    reuseExistingServer: false,
  },
})
