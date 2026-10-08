/**
 * Which catalog models the ambient kits are made from (S04l), three-free so the server can list
 * them in the page's ambient assets (src/lib/data/districts.ts) without loading the bakers.
 */
import type { AmbientTier, PerAmbientTier } from '@/lib/world/ambient/types'
import { NPC_VARIANTS, type NpcVariant } from '../avatar/npc'

/** The clip a pedestrian's pose is taken from. */
export const WALK_CLIP = 'walk'

/**
 * The S16b pedestrians each tier bakes (one kit = one InstancedMesh per bucket): the merged
 * `npc-*` models, never the player look's parts (UX-3).
 */
export const PEDESTRIANS: PerAmbientTier<readonly NpcVariant[]> = {
  // One kit on low: the man, furthest from the default player look (a woman in casual wear).
  low: NPC_VARIANTS.filter((variant) => variant.model === 'npc-man'),
  mid: NPC_VARIANTS,
  high: NPC_VARIANTS,
}

/** The model ids the `s16b` source loads for a tier: each kit's rig and model, once each. */
export function pedestrianModelIds(tier: AmbientTier): string[] {
  return [...new Set(PEDESTRIANS[tier].flatMap((variant) => [variant.rig, variant.model]))]
}
