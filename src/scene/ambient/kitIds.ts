/**
 * Which catalog models the ambient kits are made from (S04l), three-free so the server can list
 * them in the page's ambient assets (src/lib/data/districts.ts) without loading the bakers.
 */
import type { AmbientTier, PerAmbientTier } from '@/lib/world/ambient/types'

export interface KenneyPedestrianParts {
  readonly body: string
  readonly head: string
}

/** The shared avatar rig (catalog id) and the clip the pose is taken from. */
export const AVATAR_RIG_ID = 'avatar-rig'
export const WALK_CLIP = 'walk'

/**
 * Which Kenney parts each tier bakes (one kit = one InstancedMesh per bucket): the lightest
 * low-tier bodies and heads that are not the default player look (scene.json models.player).
 * Temporary until S16b; its source decides its own kits.
 */
export const KENNEY_TEMP_PEDESTRIANS: PerAmbientTier<readonly KenneyPedestrianParts[]> = {
  low: [{ body: 'body-male-b', head: 'head-male-f' }],
  mid: [{ body: 'body-male-b', head: 'head-male-f' }],
  high: [
    { body: 'body-male-b', head: 'head-male-f' },
    { body: 'body-female-b', head: 'head-female-f' },
  ],
}

/** The model ids the `kenney-temp` source loads for a tier, rig first. */
export function kenneyTempModelIds(tier: AmbientTier): string[] {
  return [
    AVATAR_RIG_ID,
    ...KENNEY_TEMP_PEDESTRIANS[tier].flatMap((parts) => [parts.body, parts.head]),
  ]
}

/** The models a pedestrian source loads (none for a source that has not landed yet). */
export function pedestrianModelIds(source: 'kenney-temp' | 's16b', tier: AmbientTier): string[] {
  return source === 'kenney-temp' ? kenneyTempModelIds(tier) : []
}
