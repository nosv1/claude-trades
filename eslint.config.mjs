// Lint for the coding standard (nosv1/nosv1 CODING.md; rules in eslint-standard.mjs, a copy of the hub's) and
// this repo's docs/coding-standard.md. npm run lint runs it with --max-warnings 0. Old findings are in
// eslint-suppressions.json, which only shrinks: fix them when you're in the file, then npm run lint:prune.
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { linterOptions, standardRules, typeAwareRules } from './eslint-standard.mjs';

const typed = {
  parser: tseslint.parser,
  parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
};

export default [
  { ignores: ['node_modules/**', 'worker/.wrangler/**'] },
  { linterOptions },
  {
    // The page: classic scripts sharing window.TP and window.TP_SYNC, each in strict mode.
    files: ['site/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...globals.browser, google: 'readonly' },
      ...typed },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: { ...standardRules, ...typeAwareRules, strict: ['error', 'global'] },
  },
  {
    files: ['worker/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: globals.serviceworker, ...typed },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: { ...standardRules, ...typeAwareRules },
  },
  {
    files: ['eslint.config.mjs', 'eslint-standard.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: globals.node },
  },
];
