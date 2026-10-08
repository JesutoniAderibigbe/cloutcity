import { describe, expect, it } from 'vitest'
import { perf, scene } from '@/lib/data/config'
import { LANDMARK_FOCUS_DISTANCE_M } from '@/lib/data/schemas/landmarkModels'
import { QUALITY_TIERS } from '@/lib/data/schemas/config'
import { GLB_TIER_LEVELS, landmarkLod } from './lod'
import { TIER_LEVELS } from './buildLandmark'

describe('landmarkLod', () => {
  it('has one distance per built level of the tier', () => {
    for (const tier of QUALITY_TIERS) {
      const lod = landmarkLod(scene.landmarks, tier, perf.lodDistanceScale[tier], false)
      expect(lod.distances).toHaveLength(TIER_LEVELS[tier].length)
      expect(lod.distances[0]).toBe(0)
    }
  })

  it('scales by the tier and stretches bridges', () => {
    const plain = landmarkLod(scene.landmarks, 'mid', 1, false)
    const scaled = landmarkLod(scene.landmarks, 'mid', 0.5, false)
    const bridge = landmarkLod(scene.landmarks, 'mid', 1, true)
    expect(scaled.cullM).toBe(plain.cullM / 2)
    expect(bridge.cullM).toBe(plain.cullM * scene.landmarks.bridgeDistanceMultiplier)
    expect(bridge.distances[1]).toBe(
      (plain.distances[1] ?? 0) * scene.landmarks.bridgeDistanceMultiplier,
    )
  })

  it('never culls a focused landmark on any tier (S04c focus distance)', () => {
    for (const tier of QUALITY_TIERS) {
      const lod = landmarkLod(scene.landmarks, tier, perf.lodDistanceScale[tier], false)
      expect(lod.cullM, tier).toBeGreaterThan(LANDMARK_FOCUS_DISTANCE_M)
    }
  })
})

describe('GLB_TIER_LEVELS (S07c)', () => {
  it('draws as many Blender levels as the kit has distances, finest first', () => {
    for (const tier of QUALITY_TIERS) {
      const levels = GLB_TIER_LEVELS[tier]
      expect(levels, tier).toHaveLength(TIER_LEVELS[tier].length)
      expect(
        [...levels].sort((a, b) => a - b),
        tier,
      ).toEqual(levels)
      for (const level of levels) expect(level).toBeGreaterThanOrEqual(0)
      for (const level of levels) expect(level).toBeLessThanOrEqual(3)
    }
    expect(GLB_TIER_LEVELS.low.at(-1)).toBe(3)
  })
})
