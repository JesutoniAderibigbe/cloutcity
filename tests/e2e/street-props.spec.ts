import type { Page } from '@playwright/test'
import { expect, test } from './fixtures/test'
import { seedTier, waitForCityModels } from './helpers/cityModels'
import { at, seedClockSave } from './helpers/dayNight'
import { readJson } from './helpers/places'
import { SCENE_READY_TIMEOUT_MS, waitForMapSettled } from './helpers/scene'

// S04i: street dressing. Hand-made props on the real LION streets around the camera focus, merged
// per 200 m chunk onto the district material (no new shader program), drawn only once the camera
// zooms in on mid and high, glowing at night, never pickable, and nothing at all on low.

type PerTier<T> = { low: T; mid: T; high: T }
const perf = readJson<{
  drawCallsMax: PerTier<number>
  trianglesMax: PerTier<number>
  programsMax: PerTier<number>
  streetProps: {
    instancesMax: Record<string, PerTier<number>>
    trianglesMax: PerTier<number>
    drawCallsMax: PerTier<number>
  }
}>('data/config/perf.json')
const props = readJson<{
  showBelowDistanceM: { mid: number; high: number }
  prefetchBelowDistanceM: { mid: number; high: number }
}>('data/config/props.json')

/** Requests for the streets file and the props' models. */
function watchPropRequests(page: Page): string[] {
  const urls: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/geo/streets') urls.push(`${url.pathname}${url.search}`)
  })
  return urls
}

const camera = (page: Page) => page.evaluate(() => window.__cloutcityTest?.scene?.camera() ?? null)
const propsState = (page: Page) =>
  page.evaluate(() => window.__cloutcityTest?.scene?.props() ?? null)

/** Wheel steps on the canvas centre (MapControls zooms towards the cursor) until within `m`. */
async function zoomWithin(page: Page, m: number): Promise<void> {
  const canvas = page.locator('[data-scene-root] canvas')
  const box = await canvas.boundingBox()
  if (box === null) throw new Error('no canvas')
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  for (let i = 0; i < 80; i++) {
    const distance = (await camera(page))?.distance ?? Infinity
    if (distance <= m) return
    await canvas.evaluate((element, { x, y }) => {
      element.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -100,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
        }),
      )
    }, point)
  }
  throw new Error(`could not zoom within ${m} m`)
}

/** Waits until the props have loaded, placed and built, and on-demand rendering is idle. */
async function waitForProps(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const scene = window.__cloutcityTest?.scene
      const state = scene?.props()
      return (
        state !== null &&
        state !== undefined &&
        (state.status === 'ready' || state.status === 'failed') &&
        'busy' in state &&
        !state.busy &&
        scene?.pendingFrames() === 0
      )
    },
    null,
    { polling: 'raf', timeout: SCENE_READY_TIMEOUT_MS * 2 },
  )
}

for (const tier of ['mid', 'high'] as const) {
  test(`${tier}: nothing loads at the default view; zoomed in, props draw within every cap on the district program`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const requests = watchPropRequests(page)
    await seedTier(page, tier)
    await page.goto('/')
    await waitForMapSettled(page)
    await waitForCityModels(page)

    // The default view: no streets file, no props chunk, nothing drawn.
    expect(requests).toEqual([])
    expect(await propsState(page)).toEqual({ status: 'idle' })
    const programsBefore = await page.evaluate(() => window.__cloutcityTest?.scene?.programKeys())

    await zoomWithin(page, props.showBelowDistanceM[tier] * 0.8)
    await waitForProps(page)
    const state = await propsState(page)
    if (state === null || !('chunksDrawn' in state)) throw new Error('props did not load')
    expect(state.status).toBe('ready')
    expect(state.tier).toBe(tier)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatch(/^\/geo\/streets\?v=[0-9a-f]{12}$/)

    expect(state.chunksDrawn).toBeGreaterThan(0)
    expect(state.chunksDrawn).toBeLessThanOrEqual(perf.streetProps.drawCallsMax[tier])
    const distances = state.chunks.map((c) => c.distance)
    expect(distances).toEqual([...distances].sort((a, b) => a - b))
    for (const [model, n] of Object.entries(state.instances)) {
      expect(n, model).toBeLessThanOrEqual(perf.streetProps.instancesMax[model]?.[tier] ?? 0)
    }
    expect(state.triangles).toBeLessThanOrEqual(perf.streetProps.trianglesMax[tier])
    expect(state.material).toBe('district')
    expect(state.raycastOff).toBe(true)

    // The whole frame stays inside the tier's budgets, with no new shader program.
    const info = await page.evaluate(() => window.__cloutcityTest?.scene?.renderInfo())
    expect(info?.calls ?? Infinity).toBeLessThanOrEqual(perf.drawCallsMax[tier])
    expect(info?.triangles ?? Infinity).toBeLessThanOrEqual(perf.trianglesMax[tier])
    const programsAfter = await page.evaluate(() => window.__cloutcityTest?.scene?.programKeys())
    expect(programsAfter).toEqual(programsBefore)
    expect(programsAfter?.length ?? Infinity).toBeLessThanOrEqual(perf.programsMax[tier])

    // Idle: the props draw nothing on their own (FLAKE-9: a window of at least 6 s).
    const frames = await page.evaluate(() => window.__cloutcityTest?.scene?.frames() ?? -1)
    await page.waitForTimeout(6_500)
    expect(await page.evaluate(() => window.__cloutcityTest?.scene?.frames() ?? -2)).toBe(frames)

    // Zoomed back out, nothing is drawn.
    await page.locator('[data-scene-root] canvas').evaluate((element) => {
      for (let i = 0; i < 40; i++) {
        element.dispatchEvent(
          new WheelEvent('wheel', { deltaY: 200, bubbles: true, cancelable: true }),
        )
      }
    })
    await expect
      .poll(async () => {
        const after = await propsState(page)
        return after !== null && 'chunksDrawn' in after ? after.chunksDrawn : -1
      })
      .toBe(0)
  })
}

test('mid at night: streetlights and taxi signs glow through the shared night glow', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await seedClockSave(page, at(21))
  await seedTier(page, 'mid')
  await page.goto('/')
  await waitForMapSettled(page)
  await waitForCityModels(page)
  await zoomWithin(page, props.showBelowDistanceM.mid * 0.8)
  await waitForProps(page)
  const state = await propsState(page)
  if (state === null || !('glowVertices' in state)) throw new Error('props did not load')
  expect(state.instances.streetlight ?? 0).toBeGreaterThan(0)
  expect(state.glowVertices).toBeGreaterThan(0)
  const buildings = await page.evaluate(() => window.__cloutcityTest?.scene?.buildings())
  expect(buildings?.nightGlow).toBe(1)
})

test('low: props are off, the streets are never fetched however close the camera comes', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const requests = watchPropRequests(page)
  await page.goto('/')
  await waitForMapSettled(page)
  await waitForCityModels(page)
  expect(await page.evaluate(() => window.__cloutcityTest?.scene?.quality().active)).toBe('low')
  await zoomWithin(page, props.showBelowDistanceM.mid * 0.5)
  await page.waitForTimeout(2_000)
  expect(await propsState(page)).toEqual({ status: 'off' })
  expect(requests).toEqual([])
})
