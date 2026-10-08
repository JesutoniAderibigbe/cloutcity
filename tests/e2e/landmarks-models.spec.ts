import type { Page } from '@playwright/test'
import { expect, test } from './fixtures/test'
import {
  blockLandmarkModels,
  landmarksState,
  seedTier,
  waitForCityModels,
} from './helpers/cityModels'
import { placeName, readJson, scenePins } from './helpers/places'
import { waitForMapSettled } from './helpers/scene'

// S07a: code-built landmark models (bridges, buildings, stations, government halls) at their
// real frames, per-tier levels of detail through drei Detailed, name chips from copy, badge pins
// lifted over each model, and every model reachable from the Places panel.
// S07c: the Blender-built models replace the kit once they load (high L0-L2, mid L1-L3, low
// L2-L3), on the district material, so the renderer holds no program the kit-only map lacks.

type PerTier<T> = { low: T; mid: T; high: T }
type Category = 'bridge' | 'building' | 'station' | 'government'
const perf = readJson<{
  landmarkTrianglesMax: Record<Category, PerTier<number>>
  landmarkTrianglesOverride: Record<string, PerTier<number>>
  outlines: PerTier<boolean>
}>('data/config/perf.json')
const models = readJson<{ models: { id: string; archetype: string }[] }>(
  'data/landmarks/models.json',
).models
const blender = readJson<{ landmarks: { id: string }[] }>(
  'data/landmarks/blender.derived.json',
).landmarks
/** Every landmark drawn: a kit model, a Blender model, or both. */
const drawnIds = [...new Set([...models.map((m) => m.id), ...blender.map((b) => b.id)])].sort()
const landmarkData = readJson<{ landmarks: { id: string; category: Category }[] }>(
  'data/landmarks/landmarks.json',
).landmarks
const categoryOf = (id: string) => landmarkData.find((l) => l.id === id)?.category ?? 'building'
/** A Blender model's caps, as its lock pinned them (scripts/blender/run.ts). */
const lockCaps = (id: string) =>
  readJson<{ caps: PerTier<number> }>(`data/landmarks/blender/${id}.lock.json`).caps

async function boot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__CLOUTCITY_E2E__ = true
  })
  await page.goto('/')
  await waitForMapSettled(page)
  await waitForCityModels(page)
}

// The kit-only loads refuse every model file; the browser reports each refused request.
test.use({ injectedConsoleErrors: [/^Failed to load resource: net::ERR_INTERNET_DISCONNECTED$/] })

for (const tier of ['low', 'mid', 'high'] as const) {
  test(`${tier}: every modelled landmark is built from the kit within its triangle budget`, async ({
    page,
  }) => {
    if (tier !== 'low') await seedTier(page, tier)
    // The Blender models refused, so every landmark keeps its kit (the offline fallback).
    await blockLandmarkModels(page)
    await boot(page)
    const state = await landmarksState(page)
    if (state === null) throw new Error('the landmarks hook is missing')
    expect(state.tier).toBe(tier)
    expect(state.failed).toEqual([])
    expect(state.glbFailed).toHaveLength(blender.length)
    expect(state.landmarks.map((l) => l.id).sort()).toEqual(drawnIds)
    const kitIds = new Set(models.map((m) => m.id))
    for (const landmark of state.landmarks.filter((l) => kitIds.has(l.id))) {
      expect(landmark.source, landmark.id).toBe('kit')
      expect(landmark.built, landmark.id).toBe(true)
      // Low builds L1 and L2 only; mid and high three levels.
      expect(landmark.triangles, landmark.id).toHaveLength(tier === 'low' ? 2 : 3)
      const cap =
        perf.landmarkTrianglesOverride[landmark.id]?.[tier] ??
        perf.landmarkTrianglesMax[categoryOf(landmark.id)][tier]
      expect(landmark.triangles[0] ?? Infinity, landmark.id).toBeLessThanOrEqual(cap)
      expect(landmark.lod.cullM, landmark.id).toBeGreaterThan(3000)
      if (landmark.style === 'teaser' || !perf.outlines[tier]) {
        expect(landmark.outlineVisible, landmark.id).toBe(false)
      }
    }
    // The ferry stands on "expanding soon" land: a dimmed teaser.
    expect(state.landmarks.find((l) => l.id === 'staten-island-ferry')?.style).toBe('teaser')
  })

  test(`${tier}: the Blender models replace the kit with no new shader program`, async ({
    page,
  }) => {
    if (tier !== 'low') await seedTier(page, tier)
    await blockLandmarkModels(page)
    await boot(page)
    const kitOnly = await page.evaluate(() => window.__cloutcityTest?.scene?.programKeys() ?? [])

    await page.unrouteAll()
    await page.reload()
    await waitForMapSettled(page)
    await waitForCityModels(page)
    const state = await landmarksState(page)
    if (state === null) throw new Error('the landmarks hook is missing')
    expect(state.glbFailed).toEqual([])
    for (const id of blender.map((b) => b.id)) {
      const landmark = state.landmarks.find((l) => l.id === id)
      expect(landmark?.source, id).toBe('glb')
      // High draws L0-L2, mid L1-L3, low L2-L3; the finest within the lock's cap for the tier.
      expect(landmark?.triangles, id).toHaveLength(tier === 'low' ? 2 : 3)
      expect(landmark?.triangles[0] ?? Infinity, id).toBeLessThanOrEqual(lockCaps(id)[tier])
      expect(landmark?.lod.cullM ?? 0, id).toBeGreaterThan(3000)
    }
    const drawn = await page.evaluate(() => window.__cloutcityTest?.scene?.programKeys() ?? [])
    test.info().annotations.push({
      type: 'programs',
      description: `${tier}: kit only ${kitOnly.length}, with the Blender models ${drawn.length}`,
    })
    // No program the kit-only map lacks; there may be fewer (no kit outline left in view).
    expect(drawn.filter((key) => !kitOnly.includes(key))).toEqual([])
  })
}

test('modelled landmark pins are badges lifted over their models, and chips show copy names', async ({
  page,
}) => {
  await boot(page)
  const pins = await scenePins(page)
  const state = await landmarksState(page)
  if (state === null) throw new Error('the landmarks hook is missing')
  for (const id of drawnIds)
    expect(
      pins.some((pin) => pin.id === id),
      id,
    ).toBe(true)
  const names = drawnIds.map((id) => placeName(id)).sort()
  expect([...state.chips.texts].sort()).toEqual(names)
})

test('a landmark opened from the Places panel comes into view with its model drawn', async ({
  page,
}) => {
  await boot(page)
  const id = 'queensboro-bridge'
  await page.evaluate((placeId) => {
    if (window.__cloutcityPlaces?.open(placeId) !== true) throw new Error(`no place ${placeId}`)
  }, id)
  await expect(page.locator(`[data-place-sheet="${id}"]`)).toBeVisible()
  await waitForMapSettled(page)
  await expect
    .poll(async () => (await landmarksState(page))?.landmarks.find((l) => l.id === id)?.level)
    .not.toBeNull()
  const landmark = (await landmarksState(page))?.landmarks.find((l) => l.id === id)
  expect(landmark?.screen).not.toBeNull()
})
