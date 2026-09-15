import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-undef': 'error',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-condition': 'warn',
    },
  },
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'public/**',
    ],
  },
];
