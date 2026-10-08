/**
 * The low tier's capsule colour from the look (S16a, D10): the top the player wears (a worn top
 * wins over the creator's choice), so the look still shows where the hand-made avatar is not
 * drawn. It runs in the city's 3D chunk, so it reads a tiny table the server resolves
 * (src/scene/CityScene.tsx `lookTint`) instead of the look options.
 */
import type { PublicAvatar } from '@/engine/appearance'

export interface LookTintTable {
  /** Garment colour id → hex. */
  readonly garment: Readonly<Record<string, string>>
  /** Top item id → the garment colour id it wears. */
  readonly topByItem: Readonly<Record<string, string>>
}

/** The capsule's colour for `avatar`, or null when its top has no colour in the table. */
export function lookTint(avatar: PublicAvatar, table: LookTintTable): string | null {
  const worn = avatar.worn.find((itemId) => Object.hasOwn(table.topByItem, itemId))
  const top = worn === undefined ? avatar.look.top : (table.topByItem[worn] ?? avatar.look.top)
  return Object.hasOwn(table.garment, top) ? (table.garment[top] ?? null) : null
}
