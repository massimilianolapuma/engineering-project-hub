import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      '.claude/',
      '.superpowers/',
      '.playwright-mcp/',
      '.e2e-dist/',
      'config.local/',
      '.astro/',
      'coverage/',
      'node_modules/',
      'public/data/',
      'playwright-report/',
      'test-results/',
      '.remember/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'off',
    },
  },
  {
    files: ['src/scripts/**/*.ts', 'public/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
  // D7 / ADR 0013: source credentials (collector) and target credentials (notifier) never share
  // a code path. The notifier uses only shared/** and the model.
  {
    files: ['notifier/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/collector/**', '**/collector'],
              message: 'The notifier must not import the collector (ADR 0013).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['collector/**/*.ts', 'src/**/*.ts', 'src/**/*.astro', 'shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/notifier/**', '**/notifier'],
              message: 'Only the notify job may run notifier code (ADR 0013).',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
