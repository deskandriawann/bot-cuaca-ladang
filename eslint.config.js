// Pemeriksaan kode (npm run lint). Aturan bawaan ESLint yang direkomendasikan, ditambah beberapa yang
// sering menangkap salah ketik: variabel tak terpakai, perbandingan longgar, dan impor ganda.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'data/', 'data-dev/', 'assets/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-duplicate-imports': 'error',
    },
  },
  {
    // Skrip yang berjalan di browser pengurus: ditulis gaya lama (var, function) agar jalan di HP lama
    files: ['src/admin/static/**/*.js'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
    rules: { 'no-var': 'off', 'prefer-const': 'off' },
  },
];
