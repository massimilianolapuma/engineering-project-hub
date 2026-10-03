import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 180_000,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text-summary', 'lcov', 'cobertura'],
      include: ['collector/src/**', 'shared/**', 'src/lib/**', 'src/i18n/**', 'scripts/**'],
    },
  },
});
