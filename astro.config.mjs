// @ts-check
import { defineConfig } from 'astro/config';

// SITE_URL / BASE_PATH are provided by actions/configure-pages in CI.
// Locally both default to a root deployment.
const site = process.env.SITE_URL || 'http://localhost:4321';
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  site,
  base,
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'auto' },
  i18n: {
    locales: ['en', 'it'],
    defaultLocale: 'en',
    routing: { prefixDefaultLocale: false },
  },
  vite: {
    resolve: { tsconfigPaths: true },
    // Never inline scripts: the pages ship a CSP with script-src 'self' (no inline code).
    build: { assetsInlineLimit: 0 },
  },
  devToolbar: { enabled: false },
});
