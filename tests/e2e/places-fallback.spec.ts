import type { ConsoleMessage } from '@playwright/test'
import { expect, test, waitForWelcomeGate } from './fixtures/test'
import {
  completePlaceSelection,
  expectFallbackAndPanel,
  NO_WEBGL_WARNING,
  placesPanel as panel,
} from './helpers/fallback'
import { SCENE_READY_TIMEOUT_MS, waitForMapSettled } from './helpers/scene'

// S04c: when WebGL is unavailable or its context is lost, the static fallback map shows, the
// Places panel opens by itself (without taking focus) and the game stays playable; a restored
// context brings the 3D map back in place, without remounting the canvas.

test.describe('no WebGL: getContext refuses WebGL', () => {
  test.use({ expectedConsole: [NO_WEBGL_WARNING] })

  test('shows the fallback map and the Places panel, and a place can be played', async ({
    page,
    checkA11y,
  }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (/webgl/i.test(type)) return null
        return (original as (...a: unknown[]) => unknown).call(this, type, ...rest)
      } as typeof HTMLCanvasElement.prototype.getContext
    })
    await page.goto('/')
    await waitForWelcomeGate(page)
    await expect(page.locator('[data-scene-root]')).toHaveAttribute('data-scene-status', 'error')
    await expect(page.locator('canvas')).toHaveCount(0)
    await expectFallbackAndPanel(page, 'map.error.device')
    await checkA11y()
    await completePlaceSelection(page, 'steam-vent-coffee')
  })
})

test.describe('a lost WebGL context', () => {
  test('falls back to the panel, then restores the map in place', async ({ page }) => {
    // Context loss is an expected condition: info level only (the console guard fails on any
    // warning), each line exactly once.
    const lines: string[] = []
    page.on('console', (message: ConsoleMessage) => {
      if (message.type() === 'info' || message.type() === 'log') {
        lines.push(`${message.type()}: ${message.text()}`)
      }
    })
    await page.goto('/')
    await waitForWelcomeGate(page)
    await waitForMapSettled(page)
    const root = page.locator('[data-scene-root]')
    await expect(root).toHaveAttribute('data-scene-status', 'ready')
    // Tag the canvas: after the restore it must be the very same element (no remount).
    await page.locator('[data-scene-root] canvas').evaluate((canvas) => {
      canvas.setAttribute('data-e2e-canvas', 'original')
    })

    expect(await page.evaluate(() => window.__cloutcityTest?.scene?.loseContext())).toBe(true)
    await expect(root).toHaveAttribute('data-scene-status', 'lost')
    await expectFallbackAndPanel(page, 'map.lost')

    expect(await page.evaluate(() => window.__cloutcityTest?.scene?.restoreContext())).toBe(true)
    await expect(root).toHaveAttribute('data-scene-status', 'ready', {
      timeout: SCENE_READY_TIMEOUT_MS,
    })
    await expect(page.locator('[data-scene-fallback]')).toHaveCount(0)
    // The auto-opened panel closes again with the map back.
    await expect(panel(page)).toHaveCount(0)
    await expect(page.locator('canvas[data-e2e-canvas="original"]')).toHaveCount(1)
    await expect(page.locator('canvas')).toHaveCount(1)
    await waitForMapSettled(page)
    const info = await page.evaluate(() => window.__cloutcityTest?.scene?.renderInfo())
    expect(info?.calls ?? 0).toBeGreaterThan(0)
    expect(await page.evaluate(() => window.__cloutcityTest?.scene?.pinCount())).toBeGreaterThan(0)

    const count = (pattern: RegExp) => lines.filter((line) => pattern.test(line)).length
    expect(count(/^log: THREE\.WebGLRenderer: Context Lost\.$/)).toBe(1)
    expect(count(/^log: THREE\.WebGLRenderer: Context Restored\.$/)).toBe(1)
    expect(count(/^info: .*msg: 3D map context lost; showing the Places panel,/)).toBe(1)
    expect(count(/^info: .*msg: 3D map context restored,/)).toBe(1)
  })

  test('a panel the player used during the loss stays open after the restore', async ({ page }) => {
    await page.goto('/')
    await waitForWelcomeGate(page)
    await waitForMapSettled(page)
    await page.evaluate(() => window.__cloutcityTest?.scene?.loseContext())
    await expect(panel(page)).toBeVisible()
    await panel(page).locator('[data-place-button="glowmatic"]').click()
    await expect(page.locator('[data-place-sheet="glowmatic"]')).toBeVisible()
    await page.evaluate(() => window.__cloutcityTest?.scene?.restoreContext())
    await expect(page.locator('[data-scene-root]')).toHaveAttribute('data-scene-status', 'ready', {
      timeout: SCENE_READY_TIMEOUT_MS,
    })
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-place-sheet]')).toHaveCount(0)
    await expect(panel(page)).toBeVisible()
  })
})
