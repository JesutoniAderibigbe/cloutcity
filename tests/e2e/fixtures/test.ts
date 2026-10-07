import AxeBuilder from '@axe-core/playwright'
import { test as base, expect, type ConsoleMessage } from '@playwright/test'

/**
 * Shared e2e fixture. Every spec imports `test` and `expect` from here, never from
 * @playwright/test directly, so every test gets:
 *  - a console guard (PERF-1): any console warning or error, or an uncaught page error, fails
 *    the test after it finishes, unless the test lists it in `expectedConsole` (and then it must
 *    appear);
 *  - `checkA11y()` (A11Y-2): an axe scan of the current page that fails on serious or critical
 *    violations.
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
  // Ignored only at warning level: the same text as an error still fails. ANGLE appends
  // "(this message will no longer repeat)" to its last repeat, so that exact suffix is allowed.
  {
    type: 'warning',
    text: /^\[\.WebGL-0x[0-9a-f]+\]GL Driver Message \(OpenGL, Performance, GL_CLOSE_PATH_NV, High\): GPU stall due to ReadPixels(?: \(this message will no longer repeat\))?$/,
  },
]

function isIgnored(message: ConsoleMessage): boolean {
  return IGNORED_CONSOLE_MESSAGES.some(
    (entry) => entry.type === message.type() && entry.text.test(message.text()),
  )
}

/**
 * A console message a test expects on purpose (a failure path it provokes). Matching messages
 * do not fail the guard, but each entry must actually appear, so an expectation can never hide
 * a path that silently stopped logging. Matched on the exact console type, and on the text:
 * a string must equal it exactly, a RegExp must match it. The text is the console text and,
 * for an object argument (a src/lib/log.ts record), that argument as JSON.
 */
export interface ExpectedConsoleMessage {
  readonly type: ReturnType<ConsoleMessage['type']>
  readonly text: string | RegExp
  /** How many times it must appear. Default: at least once. */
  readonly count?: number
}

function matchesText(expected: string | RegExp, text: string): boolean {
  return typeof expected === 'string' ? text === expected : expected.test(text)
}

/** The texts an expectation is matched against: the console text plus object arguments as JSON. */
async function candidateTexts(message: ConsoleMessage): Promise<string[]> {
  const texts = [message.text()]
  for (const arg of message.args()) {
    const value: unknown = await arg.jsonValue().catch(() => undefined)
    if (typeof value === 'object' && value !== null) texts.push(JSON.stringify(value))
  }
  return texts
}

const BLOCKING_IMPACTS = new Set(['serious', 'critical'])

export interface A11yOptions {
  /** CSS selectors to leave out of the scan. Use sparingly and say why at the call site. */
  readonly exclude?: readonly string[]
}

interface Fixtures {
  /**
   * How long the guard keeps listening after the test body ends, so late async warnings
   * (a failed fetch, an effect after the last assertion) still fail the test. Override with
   * `use: { consoleSettleMs }` in playwright.config.ts or `test.use()`.
   */
  consoleSettleMs: number
  /**
   * Console messages this test provokes on purpose (see {@link ExpectedConsoleMessage}).
   * Default none. Set with `test.use()` around the tests that need it. Playwright reads a
   * two-element array whose second element is an object as a `[value, options]` tuple, so wrap
   * the list: `test.use({ expectedConsole: [[first, second], { scope: 'test' }] })` (one entry
   * may be written `[entry]`).
   */
  expectedConsole: readonly ExpectedConsoleMessage[]
  consoleGuard: void
  checkA11y: (options?: A11yOptions) => Promise<void>
}

export const test = base.extend<Fixtures>({
  consoleSettleMs: [250, { option: true }],
  expectedConsole: [[], { option: true }],

  consoleGuard: [
    async ({ page, consoleSettleMs, expectedConsole }, use) => {
      const problems: string[] = []
      // Messages checked against `expectedConsole` once the test ends (their JSON arguments are
      // read asynchronously, so they are collected as promises while the page is open).
      const candidates: Promise<{ type: string; texts: string[]; report: string }>[] = []
      page.on('console', (message) => {
        if (!FAILING_CONSOLE_TYPES.has(message.type())) return
        if (isIgnored(message)) return
        const { url, lineNumber } = message.location()
        const report = `console.${message.type()}: ${message.text()} (${url}:${lineNumber})`
        if (expectedConsole.length === 0) {
          problems.push(report)
          return
        }
        candidates.push(
          candidateTexts(message).then((texts) => ({ type: message.type(), texts, report })),
        )
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

      const seen = expectedConsole.map(() => 0)
      for (const candidate of await Promise.all(candidates)) {
        const index = expectedConsole.findIndex(
          (entry) =>
            entry.type === candidate.type &&
            candidate.texts.some((text) => matchesText(entry.text, text)),
        )
        if (index === -1) problems.push(candidate.report)
        else seen[index] = (seen[index] ?? 0) + 1
      }
      expectedConsole.forEach((entry, index) => {
        const times = seen[index] ?? 0
        const ok = entry.count === undefined ? times > 0 : times === entry.count
        if (!ok) {
          problems.push(
            `expected console.${entry.type} ${String(entry.text)} ${entry.count ?? 'at least 1'} time(s), saw ${times}`,
          )
        }
      })

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
