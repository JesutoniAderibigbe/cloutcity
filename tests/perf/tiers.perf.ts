import { expect, test } from '@playwright/test'
import { QUALITY_TIERS, type QualityTier } from '@/lib/data/schemas/config'
import type { SceneGlState, SceneQualityState } from '@/scene/testHooks'
import { perf, seedPlayer, waitForPlayable, writeReport } from './measure'

// Draw calls and triangles at the default (Queens start) view on every tier, and the tier's
// renderer settings: DPR cap, antialias, PCFShadowMap shadows (high only), outlines. Counts do
// not depend on the network or CPU, so these loads are not throttled. Headless Chromium renders
// on SwiftShader, which the picker puts on the low tier: each tier is chosen in settings.

interface TierResult {
  readonly calls: number
  readonly triangles: number
  readonly gl: SceneGlState
  readonly quality: SceneQualityState
}

const results: Partial<Record<QualityTier, TierResult>> = {}

test.describe.configure({ mode: 'serial' })

for (const tier of QUALITY_TIERS) {
  test(`${tier} tier at the default view`, async ({ page }) => {
    await seedPlayer(page, tier)
    await page.goto('/')
    await waitForPlayable(page)
    // The view has settled: on-demand rendering has nothing left to draw.
    await page.waitForFunction(() => window.__cloutcityTest?.scene?.pendingFrames() === 0, null, {
      polling: 'raf',
    })
    const result = await page.evaluate(() => {
      const scene = window.__cloutcityTest?.scene
      if (scene === undefined) throw new Error('the scene test hook is missing')
      return { ...scene.renderInfo(), gl: scene.gl(), quality: scene.quality() }
    })
    results[tier] = result
    test.info().annotations.push({ type: tier, description: JSON.stringify(result) })

    expect(result.quality.active).toBe(tier)
    expect(result.gl.dprCap).toBe(perf.dprCap[tier])
    expect(result.gl.pixelRatio).toBeLessThanOrEqual(perf.dprCap[tier])
    expect(result.gl.antialias).toBe(perf.antialias[tier])
    expect(result.gl.shadowMap.type).toBe('PCFShadowMap')
    const shadows = perf.shadows[tier] === 'pcf-directional'
    expect(result.gl.shadowMap.enabled).toBe(shadows)
    expect(result.gl.sun).toEqual({
      castShadow: shadows,
      mapSizePx: perf.shadowMapSizePx[tier],
    })
    expect(result.gl.outlines).toBe(perf.outlines[tier])
    expect.soft(result.calls, `${tier}: draw calls`).toBeLessThanOrEqual(perf.drawCallsMax[tier])
    expect(result.triangles, `${tier}: triangles`).toBeLessThanOrEqual(perf.trianglesMax[tier])
  })
}

test.afterAll(() => {
  writeReport('tiers', {
    view: 'default (Queens start)',
    results,
    budget: { drawCallsMax: perf.drawCallsMax, trianglesMax: perf.trianglesMax },
  })
})
