import AxeBuilder from '@axe-core/playwright'
import { test as base, expect, type ConsoleMessage } from '@playwright/test'
import { ONBOARDING_KEY, completedOnboardingSeed } from './onboarding-seed'

/**
 * Shared e2e fixture. Every spec imports `test` and `expect` from here, never from
 * @playwright/test directly, so every test gets:
 *  - a console guard (PERF-1): any console warning or error, or an uncaught page error, fails
 *    the test after it finishes;
 *  - `checkA11y()` (A11Y-2): an axe scan of the current page that fails on serious or critical
 *    violations;
 *  - a completed welcome card (S05a), so specs for other flows start like a returning player.
 *    Welcome-card specs opt out with `test.use({ onboarding: 'fresh' })`.
 */

const FAILING_CONSOLE_TYPES = new Set<ReturnType<ConsoleMessage['type']>>([
  'warning',
  'error',
  'assert',
])

/**
 * Messages the browser itself emits that real players never see. Keep this list tiny and exact:
 * every entry must name the source and why it cannot reach a player.
 */
const IGNORED_CONSOLE_MESSAGES: readonly {
  readonly type: ReturnType<ConsoleMessage['type']>
  readonly text: RegExp
}[] = [
  // ANGLE performance note from SwiftShader, the CPU renderer headless Chromium uses for WebGL.
  // The software compositor reads every WebGL frame back, so any visible canvas logs it, even
  // with no readPixels call. Absent on a hardware GPU (checked with ANGLE Metal, 2026-10-06).
  // Ignored only at warning level: the same text as an error still fails.
  {
    type: 'warning',
    text: /^\[\.WebGL-0x[0-9a-f]+\]GL Driver Message \(OpenGL, Performance, GL_CLOSE_PATH_NV, High\): GPU stall due to ReadPixels$/,
  },
]

function isIgnored(message: ConsoleMessage): boolean {
  return IGNORED_CONSOLE_MESSAGES.some(
    (entry) => entry.type === message.type() && entry.text.test(message.text()),
  )
}

const BLOCKING_IMPACTS = new Set(['serious', 'critical'])

export interface A11yOptions {
  /** CSS selectors to leave out of the scan. Use sparingly and say why at the call site. */
  readonly exclude?: readonly string[]
}

interface Fixtures {
  /**
   * `complete` (default) seeds a passed welcome card before every page load, unless the spec has
   * already stored its own; `fresh` leaves storage alone so the card shows.
   */
  onboarding: 'complete' | 'fresh'
  onboardingSeed: void
  /**
   * How long the guard keeps listening after the test body ends, so late async warnings
   * (a failed fetch, an effect after the last assertion) still fail the test. Override with
   * `use: { consoleSettleMs }` in playwright.config.ts or `test.use()`.
   */
  consoleSettleMs: number
  consoleGuard: void
  checkA11y: (options?: A11yOptions) => Promise<void>
}

export const test = base.extend<Fixtures>({
  consoleSettleMs: [250, { option: true }],

  onboarding: ['complete', { option: true }],

  onboardingSeed: [
    async ({ page, onboarding }, use) => {
      if (onboarding === 'complete') {
        await page.addInitScript(
          ({ key, value }) => {
            // Storage can throw (opaque origins, specs that make it throw on purpose).
            try {
              if (localStorage.getItem(key) === null) localStorage.setItem(key, value)
            } catch {
              // Nothing to seed: the app shows the card, as it would for that player.
            }
          },
          { key: ONBOARDING_KEY, value: JSON.stringify(completedOnboardingSeed()) },
        )
      }
      await use()
    },
    { auto: true },
  ],

  consoleGuard: [
    async ({ page, consoleSettleMs }, use) => {
      const problems: string[] = []
      page.on('console', (message) => {
        if (!FAILING_CONSOLE_TYPES.has(message.type())) return
        if (isIgnored(message)) return
        const { url, lineNumber } = message.location()
        problems.push(`console.${message.type()}: ${message.text()} (${url}:${lineNumber})`)
      })
      page.on('pageerror', (error) => problems.push(`uncaught: ${error.name}: ${error.message}`))

      await use()

      // Let the page settle while it is still open: two animation frames flush pending
      // renders and effects, then a short fixed window catches timers and network callbacks.
      if (!page.isClosed()) {
        await page
          .evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              ),
          )
          // A test may leave the page mid-navigation; the timed wait below still applies.
          .catch(() => undefined)
        await page.waitForTimeout(consoleSettleMs)
      }

      expect(problems, 'console warnings/errors are not allowed (PERF-1)').toEqual([])
    },
    { auto: true },
  ],

  checkA11y: async ({ page }, use) => {
    await use(async (options = {}) => {
      let builder = new AxeBuilder({ page })
      for (const selector of options.exclude ?? []) builder = builder.exclude(selector)
      const { violations } = await builder.analyze()
      const blocking = violations
        .filter((violation) => BLOCKING_IMPACTS.has(violation.impact ?? ''))
        .map((violation) => ({
          rule: violation.id,
          impact: violation.impact,
          help: violation.help,
          targets: violation.nodes.map((node) => node.target.join(' ')),
        }))
      expect(blocking, 'serious or critical accessibility violations (A11Y-2)').toEqual([])
    })
  },
})

export { expect }
