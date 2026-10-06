import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import prettier from 'eslint-config-prettier/flat'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // eslint-config-next registers jsx-a11y with only a handful of rules; turn on the full
  // recommended set (A11Y-2). The plugin object is the same instance, so no redefinition.
  {
    files: ['**/*.{js,jsx,mjs,ts,tsx}'],
    rules: jsxA11y.flatConfigs.recommended.rules,
  },
  {
    rules: {
      // All logging goes through src/lib/log.ts.
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Playwright fixtures receive a `use` callback that is not React's `use` hook.
    files: ['tests/e2e/**/*.ts'],
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },
  prettier,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'coverage/**',
    'test-results/**',
    'playwright-report/**',
    'blob-report/**',
    'supabase/.temp/**',
    '.cache/**',
    '.claude/**',
    'docs/**',
  ]),
])

export default eslintConfig
