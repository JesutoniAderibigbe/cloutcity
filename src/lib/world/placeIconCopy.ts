/**
 * The labels of the place icon groups (S04k): "Coffee", "Nightlife", from the `categories`
 * namespace, which loads with this module's chunk (DEC-11). Only the Places panel renders them,
 * so the namespace never joins the boot islands that read src/lib/world/places.ts.
 */
import { copy, isCopyKey } from '@/lib/copy'
import type { PlaceIconGroup } from '@/lib/data/schemas/content'
import { placeIconLabelKey } from './placeIcons'
import '@/lib/copy/ns/categories'

export function placeGroupLabel(group: PlaceIconGroup): string {
  const key = placeIconLabelKey(group)
  if (!isCopyKey(key)) throw new Error(`No copy key "${key}" for place icon group ${group}`)
  return copy(key)
}
