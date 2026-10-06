import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import prettier from 'eslint-config-prettier/flat'

// Number.prototype / Date.prototype locale formatting, banned outside src/lib/format.ts.
const NUMBER_FORMAT_METHODS =
  '/^(toLocaleString|toLocaleDateString|toLocaleTimeString|toPrecision|toFixed)$/'

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
    // UX-2 / GR-11: player-facing numbers and money go through src/lib/format.ts only.
    // Any reference to `Intl` is banned (it also catches aliases, destructuring, computed
    // access and globalThis.Intl / window.Intl), as are the Number/Date locale formatters
    // however they are reached, and hand-built "$" amounts.
    files: ['src/**/*.{js,jsx,mjs,ts,tsx}'],
    ignores: ['src/lib/format.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Identifier[name='Intl']",
          message: 'Format numbers with src/lib/format.ts (formatMoney, formatCount).',
        },
        {
          selector: `MemberExpression[property.name=${NUMBER_FORMAT_METHODS}]`,
          message: 'Format numbers with src/lib/format.ts (formatMoney, formatCount).',
        },
        {
          selector: `MemberExpression[computed=true][property.value=${NUMBER_FORMAT_METHODS}]`,
          message: 'Format numbers with src/lib/format.ts (formatMoney, formatCount).',
        },
        {
          selector: `MemberExpression[computed=true] > TemplateLiteral.property > TemplateElement[value.raw=${NUMBER_FORMAT_METHODS}]`,
          message: 'Format numbers with src/lib/format.ts (formatMoney, formatCount).',
        },
        {
          selector: `ObjectPattern > Property[key.name=${NUMBER_FORMAT_METHODS}]`,
          message: 'Format numbers with src/lib/format.ts (formatMoney, formatCount).',
        },
        {
          selector: 'TemplateLiteral > TemplateElement[tail=false][value.raw=/\\$$/]',
          message: 'Money must go through formatMoney (src/lib/format.ts), not a "$" template.',
        },
        {
          selector: "BinaryExpression[operator='+'] > Literal.left[value=/\\$$/]",
          message: 'Money must go through formatMoney (src/lib/format.ts), not "$" + value.',
        },
        {
          selector: 'JSXText[value=/\\$\\s*$/] + JSXExpressionContainer',
          message: 'Money must go through formatMoney (src/lib/format.ts), not "$" in JSX.',
        },
      ],
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
