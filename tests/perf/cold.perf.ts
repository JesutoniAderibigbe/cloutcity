import { expect, test } from '@playwright/test'
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

// Cold load under the cc-mid-4g profile on the perf run's tier (CLAUDE.md "Performance budgets"):
// the shell visible and interactive, and the map playable (city drawn, the player's avatar
// placed), each as the median of perfRun.coldRuns loads. Every load gets a fresh browser
// context, so nothing is cached.

const tier = perf.perfRun.coldTier
const runs: LoadTimings[] = []

test.describe.configure({ mode: 'serial' })

for (let run = 1; run <= perf.perfRun.coldRuns; run += 1) {
  test(`cold load ${run} of ${perf.perfRun.coldRuns} (${tier} tier)`, async ({ page }) => {
    await seedPlayer(page, tier)
    await applyThrottle(page, profile)
    await page.goto('/')
    const timings = await waitForPlayable(page)
    test.info().annotations.push({ type: 'timings', description: JSON.stringify(timings) })
    runs.push(timings)
  })
}

test(`cold medians are within budget (${tier} tier)`, () => {
  expect(runs).toHaveLength(perf.perfRun.coldRuns)
  const shellInteractiveMs = median(runs.map((run) => run.shellInteractiveMs))
  const playableMs = median(runs.map((run) => run.playableMs))
  writeReport('cold', {
    profile: perf.perfRun.profile,
    tier,
    runs,
    median: { shellInteractiveMs, playableMs, scene: medianMarks(runs) },
    budget: {
      shellInteractiveMs: perf.shellInteractiveColdMs,
      playableMs: perf.playableColdMs[tier],
    },
  })
  expect
    .soft(shellInteractiveMs, 'shell interactive, cold (median)')
    .toBeLessThanOrEqual(perf.shellInteractiveColdMs)
  expect(playableMs, 'playable, cold (median)').toBeLessThanOrEqual(perf.playableColdMs[tier])
})
