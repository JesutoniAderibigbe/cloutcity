import type { Page, Request, Route } from '@playwright/test'
import type { EventContext } from '@/engine/events'
import { expect, test } from './fixtures/test'

// S05c (DEC-11): the shell of / carries only the boot path. Every other feature loads in its own
// chunk on first use, with a loading state inside its overlay zone; the welcome card loads as a
// boot island while the page behind it stays inert. Chunks outside the shell are held back or
// failed on purpose here: shell chunks are the scripts the prerendered HTML lists.

const BODEGA: EventContext = {
  borough: 'queens',
  locationId: null,
  locationCategory: 'bodega',
  clout: 0,
  itemIds: [],
}

const EVENT_MARKER = 'cc-feature:event-sheet'
const PLACE_MARKER = 'cc-feature:place-sheet'

/** Controls chunk requests outside the shell: pass, hold until released, or fail. */
class ChunkGate {
  mode: 'pass' | 'hold' | 'fail' = 'pass'
  /** Bodies of the non-shell chunks served so far, in request order. */
  readonly served: string[] = []
  private releaseHeld: () => void = () => {}
  private held = Promise.resolve()

  hold(): void {
    this.mode = 'hold'
    this.held = new Promise((resolve) => {
      this.releaseHeld = resolve
    })
  }

  release(): void {
    this.mode = 'pass'
    this.releaseHeld()
  }

  static async install(page: Page): Promise<ChunkGate> {
    const gate = new ChunkGate()
    const html = await (await page.request.get('/')).text()
    const shell = new Set(
      Array.from(html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g), (match) => match[1]),
    )
    await page.route('**/_next/static/chunks/**/*.js', async (route: Route, request: Request) => {
      const path = new URL(request.url()).pathname
      if (shell.has(path)) return route.continue()
      if (gate.mode === 'fail') return route.abort('failed')
      if (gate.mode === 'hold') await gate.held
      const response = await route.fetch()
      const body = await response.text()
      gate.served.push(body)
      return route.fulfill({ response, body })
    })
    return gate
  }
}

async function bootWithHooks(page: Page) {
  await page.addInitScript(() => {
    window.__CLOUTCITY_E2E__ = true
  })
  await page.goto('/')
  await page.waitForFunction(
    () => window.__cloutcityTest?.events !== undefined && window.__cloutcityPlaces !== undefined,
  )
}

const sheetZone = (page: Page) => page.locator('[data-overlay-zone="sheet"]')

test.describe('lazy features', () => {
  test('the event sheet loads only when an event opens, with a loading state in the sheet zone', async ({
    page,
    checkA11y,
  }) => {
    const gate = await ChunkGate.install(page)
    await bootWithHooks(page)
    expect(gate.served.some((body) => body.includes(EVENT_MARKER))).toBe(false)

    gate.hold()
    const before = gate.served.length
    await page.evaluate(
      (context) => window.__cloutcityTest?.events?.open('bodega-cat', context),
      BODEGA,
    )

    const loading = sheetZone(page).getByRole('status', { name: 'Loading the event' })
    await expect(loading).toBeVisible()
    await expect(loading).toHaveAttribute('aria-busy', 'true')
    await checkA11y()

    gate.release()
    const dialog = sheetZone(page).getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(loading).toHaveCount(0)
    expect(gate.served.slice(before).some((body) => body.includes(EVENT_MARKER))).toBe(true)
  })

  test('the place sheet loads only when a place opens, with a loading state in the sheet zone', async ({
    page,
    checkA11y,
  }) => {
    const gate = await ChunkGate.install(page)
    await bootWithHooks(page)
    expect(gate.served.some((body) => body.includes(PLACE_MARKER))).toBe(false)

    gate.hold()
    const before = gate.served.length
    await page.evaluate(() => window.__cloutcityPlaces?.open('steam-vent-coffee'))

    const loading = sheetZone(page).getByRole('status', { name: 'Loading this place' })
    await expect(loading).toBeVisible()
    await checkA11y()

    gate.release()
    await expect(page.locator('[data-place-sheet="steam-vent-coffee"]')).toBeVisible()
    await expect(loading).toHaveCount(0)
    expect(gate.served.slice(before).some((body) => body.includes(PLACE_MARKER))).toBe(true)
  })
})

test.describe('lazy features: a failed load', () => {
  // The test aborts the chunk itself, which Chromium reports as a resource error.
  test.use({ injectedConsoleErrors: [/^Failed to load resource: net::ERR_FAILED$/] })

  test('a feature whose chunk fails offers a retry in its zone, which loads it', async ({
    page,
    checkA11y,
  }) => {
    const gate = await ChunkGate.install(page)
    await bootWithHooks(page)

    gate.mode = 'fail'
    await page.evaluate(() => window.__cloutcityPlaces?.open('steam-vent-coffee'))
    const retry = sheetZone(page).getByRole('button', { name: 'Try again' })
    await expect(retry).toBeVisible()
    await expect(sheetZone(page)).toContainText("That didn't load")
    await checkA11y()

    gate.mode = 'pass'
    await retry.click()
    await expect(page.locator('[data-place-sheet="steam-vent-coffee"]')).toBeVisible()
    await expect(retry).toHaveCount(0)
  })
})

test.describe('welcome boot island', () => {
  test.use({ onboarding: 'fresh' })

  test('a fresh visitor sees the loading card with the page inert, then the welcome card, with no gap', async ({
    page,
    checkA11y,
  }) => {
    // Every change to the background's `inert`, with whether the card was showing at the time.
    await page.addInitScript(() => {
      const log: { inert: boolean; dialog: boolean }[] = []
      Object.assign(window, { __inertLog: log })
      const record = () => {
        const background = document.querySelector('[data-overlay-background]')
        if (background === null) return
        const entry = {
          inert: background.hasAttribute('inert'),
          dialog: document.querySelector('[data-welcome-dialog]') !== null,
        }
        const last = log.at(-1)
        if (last?.inert !== entry.inert || last.dialog !== entry.dialog) log.push(entry)
      }
      new MutationObserver(record).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['inert'],
      })
    })
    const gate = await ChunkGate.install(page)
    gate.hold()
    await page.goto('/', { waitUntil: 'commit' })

    const loading = page
      .locator('[data-overlay-modal]')
      .getByRole('status', { name: 'Loading the welcome card' })
    await expect(loading).toBeVisible()
    await expect(page.locator('[data-overlay-background]')).toHaveAttribute('inert', '')
    await checkA11y()

    gate.release()
    await expect(page.getByRole('dialog', { name: 'Welcome to Clout City' })).toBeVisible()
    await expect(page.locator('[data-overlay-background]')).toHaveAttribute('inert', '')

    const log = await page.evaluate(
      () => (window as unknown as { __inertLog: { inert: boolean; dialog: boolean }[] }).__inertLog,
    )
    const closed = log.findIndex((entry) => entry.inert)
    const shown = log.findIndex((entry) => entry.dialog)
    expect(closed, 'the page goes inert before the card shows').toBeGreaterThanOrEqual(0)
    expect(shown).toBeGreaterThan(closed)
    expect(
      log.slice(closed).every((entry) => entry.inert),
      JSON.stringify(log),
    ).toBe(true)
  })
})
