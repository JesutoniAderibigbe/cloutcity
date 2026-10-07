import type { Page } from '@playwright/test'
import { expect, test, waitForWelcomeGate } from './fixtures/test'
import {
  boroughs,
  copyText,
  hitsCanvas,
  pinConfig,
  placeName,
  places,
  readJson,
  scenePins,
  type HookPin,
} from './helpers/places'
import { waitForMapSettled } from './helpers/scene'
import { touchGesture } from './helpers/touch'

// S04c: tappable place pins on the 3D map. Tap points come from the scene test hook
// (src/scene/testHooks.tsx `pins()`), so the spec never hard-codes screen positions. Places are
// brought into view through the place hook (origin `hook`), which flies the camera like the
// Places panel does.

const perf = readJson<{ drawCallsMax: { mid: number }; trianglesMax: { mid: number } }>(
  'data/config/perf.json',
)
const focusConfig = readJson<{ focus: { maxDistanceM: number } }>('data/config/scene.json').focus

/** Pins the default view must show, in Queens, before anything moves the camera. */
const MIN_PINS_ON_SCREEN = 3

async function boot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__CLOUTCITY_E2E__ = true
  })
  await page.goto('/')
  await waitForWelcomeGate(page)
  await page.waitForFunction(() => window.__cloutcityPlaces !== undefined)
  await waitForMapSettled(page)
}

/** Opens and closes a place through the hook: the camera flies to it, the sheet goes away. */
async function bringIntoView(page: Page, id: string): Promise<void> {
  await page.evaluate((placeId) => {
    if (window.__cloutcityPlaces?.open(placeId) !== true) throw new Error(`no place ${placeId}`)
  }, id)
  await expect(page.locator(`[data-place-sheet="${id}"]`)).toBeVisible()
  await page.evaluate(() => window.__cloutcityPlaces?.close())
  await expect(page.locator('[data-place-sheet]')).toHaveCount(0)
  await waitForMapSettled(page)
}

/** A pin on screen with no other pin close enough to make a tap on it ambiguous. */
function isolated(pins: readonly HookPin[], id: string): HookPin | null {
  const target = pins.find((pin) => pin.id === id)
  if (target?.screen == null) return null
  const { x, y } = target.screen
  const clear = pins.every(
    (pin) =>
      pin.id === id ||
      pin.screen === null ||
      Math.hypot(pin.screen.x - x, pin.screen.y - y) >
        pinConfig.hitRadiusPx + pinConfig.ambiguityPx + 4,
  )
  return clear ? target : null
}

async function tap(page: Page, point: { x: number; y: number }, touch: boolean): Promise<void> {
  if (touch) await page.touchscreen.tap(point.x, point.y)
  else await page.mouse.click(point.x, point.y)
}

const CANDIDATES = ['jamaica-station', 'flushing-meadows', 'queens-ballpark', 'glowmatic']

/** Brings candidates into view until one is isolated on screen, and returns it. */
async function isolatedPin(page: Page): Promise<HookPin & { screen: { x: number; y: number } }> {
  for (const id of CANDIDATES) {
    await bringIntoView(page, id)
    const pin = isolated(await scenePins(page), id)
    if (pin?.screen != null && (await hitsCanvas(page, pin.screen))) {
      return { ...pin, screen: pin.screen }
    }
  }
  throw new Error('no isolated pin on screen among the candidates')
}

test.describe('place pins on the 3D map', () => {
  test.beforeEach(async ({ page }) => {
    await boot(page)
  })

  test('every place has a pin; borough land style and pin counts follow the data', async ({
    page,
  }) => {
    const hook = await page.evaluate(() => {
      const scene = window.__cloutcityTest?.scene
      return { count: scene?.pinCount(), boroughs: scene?.boroughs(), pins: scene?.pins() }
    })
    expect(hook.count).toBe(places.length)
    expect(hook.pins?.map((pin) => pin.id)).toEqual(places.map((place) => place.id))
    expect(hook.boroughs?.map((b) => b.id)).toEqual(boroughs.map((b) => b.id))
    for (const borough of boroughs) {
      const view = hook.boroughs?.find((b) => b.id === borough.id)
      const dimmed = borough.teaserLandmarkIds.length > 0
      expect(view, borough.id).toEqual({
        id: borough.id,
        land: dimmed ? 'dimmed' : 'normal',
        pinCount: places.filter((place) => place.borough === borough.id).length,
        chip: dimmed,
      })
    }
    const styleOf = (id: string) => hook.pins?.find((pin) => pin.id === id)?.style
    expect(styleOf('bronx-ballpark')).toBe('teaser')
    expect(styleOf('staten-island-ferry')).toBe('teaser')
    expect(styleOf('september-11-memorial')).toBe('memorial')
    expect(styleOf('glowmatic')).toBe('normal')
    // The default Queens view already shows pins.
    expect(hook.pins?.filter((pin) => pin.screen !== null).length).toBeGreaterThanOrEqual(
      MIN_PINS_ON_SCREEN,
    )
  })

  test('the default view with pins and chips stays within the mid-tier budget', async ({
    page,
  }) => {
    const info = await page.evaluate(() => window.__cloutcityTest?.scene?.renderInfo())
    test.info().annotations.push({ type: 'default-view', description: JSON.stringify(info) })
    expect(info?.calls).toBeLessThanOrEqual(perf.drawCallsMax.mid)
    expect(info?.triangles).toBeLessThanOrEqual(perf.trianglesMax.mid)
  })

  test('tapping a pin opens its place sheet and rings it; the panel opens the same place', async ({
    page,
    checkA11y,
  }, testInfo) => {
    const touch = !!testInfo.project.use.hasTouch
    const pin = await isolatedPin(page)
    const name = placeName(pin.id)

    // A tap a few pixels off the head still lands: the target is at least 44 px across.
    await tap(page, { x: pin.screen.x + pinConfig.hitRadiusPx - 4, y: pin.screen.y }, touch)
    const sheet = page.locator(`[data-place-sheet="${pin.id}"]`)
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('heading', { name })).toBeVisible()
    await expect(page.locator('[data-place-announcer]')).toHaveText(
      copyText('places.announce.opened', { place: name }),
    )
    expect(await page.evaluate(() => window.__cloutcityTest?.scene?.selectedPlaceId())).toBe(pin.id)
    await checkA11y()

    // Close it, then pick the same place from the Places panel: the same sheet opens.
    await sheet
      .getByRole('button', { name: copyText('place.sheet.closeLabel', { place: name }) })
      .click()
    await expect(sheet).toHaveCount(0)
    expect(await page.evaluate(() => window.__cloutcityTest?.scene?.selectedPlaceId())).toBeNull()
    await page.locator('[data-places-button]').click()
    const panel = page.getByRole('dialog', { name: copyText('places.panel.title') })
    await panel.locator(`[data-place-button="${pin.id}"]`).click()
    await expect(sheet).toBeVisible()
    await expect(panel).toBeHidden()
    await expect(page.locator('[data-place-announcer]')).toHaveText(
      copyText('places.announce.opened', { place: name }),
    )
    expect(await page.evaluate(() => window.__cloutcityTest?.scene?.selectedPlaceId())).toBe(pin.id)
  })

  test('a tap on empty map or a drag across a pin opens nothing', async ({ page }, testInfo) => {
    const touch = !!testInfo.project.use.hasTouch
    const pin = await isolatedPin(page)
    // Far from every pin: nothing opens.
    const pins = await scenePins(page)
    const viewport = page.viewportSize()
    if (!viewport) throw new Error('no viewport')
    const empty = [
      { x: pin.screen.x, y: pin.screen.y + 120 },
      { x: pin.screen.x, y: pin.screen.y - 120 },
    ].find((point) =>
      pins.every(
        (other) =>
          other.screen === null ||
          Math.hypot(other.screen.x - point.x, other.screen.y - point.y) > 60,
      ),
    )
    if (empty === undefined || !(await hitsCanvas(page, empty))) throw new Error('no empty spot')
    await tap(page, empty, touch)
    await waitForMapSettled(page)
    await expect(page.locator('[data-place-sheet]')).toHaveCount(0)

    // A drag that starts on the pin pans the map instead of opening it.
    if (touch) {
      await touchGesture(page, [pin.screen], [{ x: pin.screen.x - 80, y: pin.screen.y }])
    } else {
      await page.mouse.move(pin.screen.x, pin.screen.y)
      await page.mouse.down()
      await page.mouse.move(pin.screen.x - 80, pin.screen.y, { steps: 4 })
      await page.mouse.up()
    }
    await waitForMapSettled(page)
    await expect(page.locator('[data-place-sheet]')).toHaveCount(0)
    await expect(page.locator('[data-places-panel]')).toHaveCount(0)
  })

  test('a tap on pins too close to tell apart offers a choice in the Places panel', async ({
    page,
  }, testInfo) => {
    const touch = !!testInfo.project.use.hasTouch
    // Zoom far out so neighbouring places stack on screen.
    const canvas = page.locator('[data-scene-root] canvas')
    await canvas.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      for (let i = 0; i < 30; i++) {
        element.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: 2000,
            deltaMode: WheelEvent.DOM_DELTA_PIXEL,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            bubbles: true,
            cancelable: true,
          }),
        )
      }
    })
    await waitForMapSettled(page)
    const pins = (await scenePins(page)).filter((pin) => pin.screen !== null)
    let pair: [HookPin, HookPin] | undefined
    for (const a of pins) {
      for (const b of pins) {
        if (a === b || a.screen === null || b.screen === null) continue
        if (Math.hypot(a.screen.x - b.screen.x, a.screen.y - b.screen.y) <= pinConfig.ambiguityPx) {
          if (await hitsCanvas(page, a.screen)) pair = [a, b]
        }
        if (pair) break
      }
      if (pair) break
    }
    if (pair?.[0].screen == null) throw new Error('no stacked pins at the zoomed-out view')
    const [first, second] = pair
    if (first.screen === null) throw new Error('unreachable')

    await tap(page, first.screen, touch)
    const chooser = page.getByRole('dialog', { name: copyText('places.panel.chooserTitle') })
    await expect(chooser).toBeVisible()
    await expect(chooser).toHaveAttribute('data-places-panel', 'chooser')
    await expect(chooser.locator(`[data-place-button="${first.id}"]`)).toBeVisible()
    await expect(chooser.locator(`[data-place-button="${second.id}"]`)).toBeVisible()
    await expect(page.locator('[data-place-sheet]')).toHaveCount(0)

    await chooser.locator(`[data-place-button="${second.id}"]`).click()
    await expect(page.locator(`[data-place-sheet="${second.id}"]`)).toBeVisible()
  })

  test('a place picked in the panel brings the camera to it', async ({ page }) => {
    const target = 'september-11-memorial'
    await page.locator('[data-places-button]').click()
    await page.locator(`[data-place-button="${target}"]`).click()
    await expect(page.locator(`[data-place-sheet="${target}"]`)).toBeVisible()
    await waitForMapSettled(page)
    const camera = await page.evaluate(() => window.__cloutcityTest?.scene?.camera())
    const pin = (await scenePins(page)).find((p) => p.id === target)
    expect(camera?.distance ?? Infinity).toBeLessThanOrEqual(focusConfig.maxDistanceM + 1)
    // The place is in view, near the middle of the canvas.
    const viewport = page.viewportSize()
    if (!viewport || pin?.screen == null) throw new Error('the place is not on screen')
    expect(Math.abs(pin.screen.x - viewport.width / 2)).toBeLessThan(viewport.width / 4)
  })
})

test.describe('place pins with reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } })

  test('the camera cuts to a place picked in the panel instead of flying', async ({ page }) => {
    await boot(page)
    const target = 'statue-of-liberty'
    const before = await page.evaluate(() => window.__cloutcityTest?.scene?.frames() ?? 0)
    await page.locator('[data-places-button]').click()
    await page.locator(`[data-place-button="${target}"]`).click()
    await expect(page.locator(`[data-place-sheet="${target}"]`)).toBeVisible()
    await waitForMapSettled(page)
    const after = await page.evaluate(() => window.__cloutcityTest?.scene?.frames() ?? 0)
    // A cut renders a frame or two, never a tween's worth of frames.
    expect(after - before).toBeLessThanOrEqual(3)
    const camera = await page.evaluate(() => window.__cloutcityTest?.scene?.camera())
    expect(camera?.distance ?? Infinity).toBeLessThanOrEqual(focusConfig.maxDistanceM + 1)
  })
})
