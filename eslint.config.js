import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  { ignores: ['dist', 'src-tauri', 'coverage', 'node_modules', 'eslint.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['scripts/*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,

      // The app intentionally keeps an up-to-date state mirror in a ref so that
      // window-level handlers never read stale closures, and renderers are
      // created lazily outside of render. Both are deliberate.
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',

      // Promise-returning platform methods and test doubles are async by
      // contract even when a specific implementation resolves immediately.
      '@typescript-eslint/require-await': 'off',

      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      'jsx-a11y/no-noninteractive-tabindex': [
        'error',
        { tags: [], roles: ['separator', 'region'] },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly' },
    },
    rules: {
      'no-undef': 'off',
      'no-console': 'off',
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}', 'vite.config.ts', 'scripts/**/*.mjs'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      'jsx-a11y/no-noninteractive-tabindex': 'off',
    },
  },
);
