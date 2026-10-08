/**
 * The pedestrian variants (S16b decision 12, the S04l `PedestrianKitSource` seam): each is one
 * pre-merged skinned model (body, face and hair, about 840 triangles) posed by its frame's rig.
 * Their `_SLOT` order is skin, top, bottom, hair, shoes, so the ambient colour buckets (skin,
 * top, bottom, accent) recolour skin and clothes per instance and keep hair and shoes as
 * accents. They never use the player look's parts, so pedestrians stay visibly different from
 * players (UX-3).
 */
export interface NpcVariant {
  /** Catalog model id of the merged pedestrian. */
  readonly model: string
  /** Catalog id of the rig whose `walk` clip poses it. */
  readonly rig: string
}

export const NPC_VARIANTS: readonly NpcVariant[] = [
  { model: 'npc-woman', rig: 'avatar-rig-f' },
  { model: 'npc-man', rig: 'avatar-rig-m' },
]
