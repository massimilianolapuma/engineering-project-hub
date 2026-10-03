import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the built static site (astro preview).
 * Self-contained: the web server builds the site from the golden mock snapshots into
 * .e2e-dist/, so a local dist/ built from other data never affects the results.
 * Run: npm run test:e2e   (needs: npx playwright install chromium)
 */
const astro = 'node ./node_modules/astro/bin/astro.mjs';
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://127.0.0.1:4321', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    // --ignore-lock: keep the server in the foreground (Astro 7 auto-backgrounds the preview
    // when it detects an AI agent), so Playwright always stops it when the run ends.
    command: `${astro} build --outDir .e2e-dist && ${astro} preview --outDir .e2e-dist --host 127.0.0.1 --port 4321 --ignore-lock`,
    env: { SNAPSHOT_DIR: 'fixtures/snapshots', ASTRO_TELEMETRY_DISABLED: '1' },
    url: 'http://127.0.0.1:4321',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
