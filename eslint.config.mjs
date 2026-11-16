// Lint for docs/coding-standard.md (rule numbers in brackets). Zero warnings allowed:
//   npx eslint@10.14.0 --max-warnings 0 .
const browser = Object.fromEntries([
  'window', 'document', 'localStorage', 'fetch', 'console', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'requestAnimationFrame', 'matchMedia', 'getComputedStyle', 'location', 'history',
  'navigator', 'addEventListener', 'confirm', 'Event', 'CustomEvent', 'MutationObserver',
  'IntersectionObserver', 'ResizeObserver', 'AbortController', 'URL', 'Intl', 'google', 'atob',
  'TextDecoder',
].map((g) => [g, 'readonly']));
const worker = Object.fromEntries([
  'fetch', 'console', 'crypto', 'Response', 'Request', 'Headers', 'URL', 'TextEncoder', 'TextDecoder',
  'atob', 'btoa',
].map((g) => [g, 'readonly']));

const rules = {
  'no-eval': 'error', 'no-implied-eval': 'error', 'no-labels': 'error', 'no-with': 'error', // [1]
  'max-lines-per-function': ['warn', { max: 60, skipBlankLines: true, skipComments: true, IIFEs: false }], // [4]
  complexity: ['warn', 15], 'max-depth': ['warn', 4], // [4]
  'no-var': 'error', 'prefer-const': 'warn', 'no-shadow': 'warn', 'no-implicit-globals': 'error', // [6]
  'no-unused-vars': ['warn', { caughtErrors: 'none' }], 'no-empty': ['warn', { allowEmptyCatch: false }], // [7]
  'no-undef': 'error', eqeqeq: ['warn', 'smart'], // [7] [8]
};

export default [
  { ignores: ['node_modules/**', 'worker/.wrangler/**'] },
  { files: ['site/**/*.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: browser },
    rules: { ...rules, strict: ['error', 'global'] } },
  { files: ['worker/**/*.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: worker }, rules },
  { files: ['eslint.config.mjs'], languageOptions: { sourceType: 'module' } },
];
