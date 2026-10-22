import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'docs/', 'node_modules/', 'idl/', 'abi/', 'test/fixtures/'] },
  js.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.node },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
      'max-len': [
        'warn',
        { code: 120, ignoreStrings: true, ignoreTemplateLiterals: true, ignoreUrls: true },
      ],
    },
  },
];
