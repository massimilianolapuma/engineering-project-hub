import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/',
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
  prettier,
);
