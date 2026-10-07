import { expect, test, type Page } from '@playwright/test'
import { applyThrottle } from './throttle'
import {
  median,
  medianMarks,
  perf,
  profile,
  seedPlayer,
  waitForPlayable,
  writeReport,
  type LoadTimings,
} from './measure'

// Warm load under the cc-mid-4g profile: the same browser context loads `/` once to fill its
// cache, then reloads it perfRun.coldRuns times; the median time to playable is asserted.
// The app has no service worker yet, so "warm" is the browser's HTTP cache.

const tier = perf.perfRun.coldTier
const runs: LoadTimings[] = []
let page: Page

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }, testInfo) => {
  const { viewport, deviceScaleFactor, isMobile, hasTouch, baseURL } = testInfo.project.use
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor,
    isMobile,
    hasTouch,
    baseURL,
  })
  page = await context.newPage()
  await seedPlayer(page, tier)
  await applyThrottle(page, profile)
  await page.goto('/')
  await waitForPlayable(page)
})

test.afterAll(async () => {
  await page.context().close()
})

for (let run = 1; run <= perf.perfRun.coldRuns; run += 1) {
  test(`warm load ${run} of ${perf.perfRun.coldRuns} (${tier} tier)`, async () => {
    await page.reload()
    const timings = await waitForPlayable(page)
    test.info().annotations.push({ type: 'timings', description: JSON.stringify(timings) })
    runs.push(timings)
  })
}

test(`warm median is within budget (${tier} tier)`, () => {
  expect(runs).toHaveLength(perf.perfRun.coldRuns)
  const playableMs = median(runs.map((run) => run.playableMs))
  const shellInteractiveMs = median(runs.map((run) => run.shellInteractiveMs))
  writeReport('warm', {
    profile: perf.perfRun.profile,
    tier,
    cache: 'http',
    runs,
    median: { shellInteractiveMs, playableMs, scene: medianMarks(runs) },
    budget: { playableMs: perf.playableWarmMs },
  })
  expect(playableMs, 'playable, warm (median)').toBeLessThanOrEqual(perf.playableWarmMs)
})
