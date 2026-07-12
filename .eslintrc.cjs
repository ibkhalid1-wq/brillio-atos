module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs', 'supabase/functions'],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  settings: { react: { version: '18.2' } },
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    'react/prop-types': 'off',
    'no-unused-vars': 'warn',
  },
  overrides: [
    {
      // TypeScript: the real codebase. tsc owns type errors; eslint owns
      // correctness rules tsc can't see (hooks deps, unused vars, etc.).
      files: ['**/*.ts', '**/*.tsx'],
      parser: '@typescript-eslint/parser',
      plugins: ['@typescript-eslint'],
      rules: {
        // Registry files co-locate components with their constants by design;
        // fast-refresh granularity is not worth splitting them.
        'react-refresh/only-export-components': 'off',
        // while(true) polling loops are idiomatic in the stream readers.
        'no-constant-condition': ['error', { checkLoops: false }],
        'no-unused-vars': 'off',
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        'no-undef': 'off', // tsc catches real cases; eslint false-positives on TS globals/types
        'no-redeclare': 'off', // TS function overloads
      },
    },
  ],
}
