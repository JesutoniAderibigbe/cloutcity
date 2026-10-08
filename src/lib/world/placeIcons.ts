/**
 * Place icons (S04k): each place category's icon group (data/places/icons.json), shown on
 * its map pin (src/scene/pins/PinMarks.tsx) and beside it in the Places list. Client code: the
 * JSON is read directly and typed with a cast (its schema, PlaceIconsConfigSchema, runs in
 * src/lib/data/data.test.ts, which gates every build), so no classic zod ships with it.
 */
import placeIconsJson from '@data/places/icons.json'
import type { PlaceIconGroup, PlaceIconsConfig } from '@/lib/data/schemas/content'

const config = placeIconsJson as PlaceIconsConfig

/** A venue type or a landmark category. */
export type PlaceCategory = keyof PlaceIconsConfig['categories']

/** The icon group of a venue type or landmark category. */
export function placeIconGroup(category: PlaceCategory): PlaceIconGroup {
  return config.categories[category]
}

/** A group's icon (an emoji: decorative, always `aria-hidden` in the DOM). */
export function placeIcon(group: PlaceIconGroup): string {
  return config.groups[group].icon
}

/** A group's label copy key (in the `categories` namespace, src/lib/world/placeIconCopy.ts). */
export function placeIconLabelKey(group: PlaceIconGroup): string {
  return config.groups[group].labelKey
}

/** Every icon group, in data/places/icons.json order (the store directory's sections). */
export function placeIconGroups(): readonly PlaceIconGroup[] {
  return Object.keys(config.groups) as PlaceIconGroup[]
}
