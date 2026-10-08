/**
 * Level-of-detail distances of one landmark for one tier (S07a): scene.json `landmarks.lod`
 * (levels nearest first, then the cull distance), times the tier's lodDistanceScale (S04b),
 * times `bridgeDistanceMultiplier` for bridges, which are long and seen from far away.
 */
import type { QualityTier } from '@/lib/data/schemas/config'
import type { SceneConfig } from '@/lib/data/schemas/scene'

/**
 * The Blender models' four levels per tier (S07c), finest first: each tier draws its levels at
 * the switch distances below, as the kit draws its own (scripts/blender/cclib/lod.py
 * TIER_LEVELS builds them to these tiers' caps).
 */
export const GLB_TIER_LEVELS: Readonly<Record<QualityTier, readonly number[]>> = {
  high: [0, 1, 2],
  mid: [1, 2, 3],
  low: [2, 3],
}

export interface LandmarkLod {
  /** Where each built level starts, nearest first (the first is 0). */
  readonly distances: readonly number[]
  /** Beyond this the landmark is not drawn at all. */
  readonly cullM: number
}

export function landmarkLod(
  config: SceneConfig['landmarks'],
  tier: QualityTier,
  lodDistanceScale: number,
  isBridge: boolean,
): LandmarkLod {
  const factor = lodDistanceScale * (isBridge ? config.bridgeDistanceMultiplier : 1)
  const tierLod = config.lod[tier]
  return {
    distances: tierLod.distancesM.map((distance) => distance * factor),
    cullM: tierLod.cullM * factor,
  }
}
