import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
export default [
  { ignores: ['dist/**', 'node_modules/**', 'vite.config.js.timestamp-*', 'artifacts/**'] },
  {
    files: ['**/*.{js,jsx}'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest', sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node }
    },
    plugins: { react },
    settings: { react: { version: '18.3' } },
    rules: {
      ...react.configs.recommended.rules,
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  }
];
