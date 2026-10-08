/**
 * Where a place is from the player (S58: the Jobs app and the store directory): the straight-line
 * distance between the two trip ends travel itself uses (src/lib/world/tripEnds.ts), and the
 * borough's name. The real trip time comes from the travel planner, never from this distance.
 */
import type { HomeId } from '@/engine/config'
import type { PlayerLocation } from '@/engine/game'
import { copy, isCopyKey } from '@/lib/copy'
import type { Borough } from '@/lib/data/schemas/content'
import { distanceM } from '@/lib/geo/projection'
import { boroughs } from '@/lib/world/places'
import { tripEnd } from '@/lib/world/tripEnds'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/phone'

/** Metres in a straight line from where the player stands to the place, or null if unknown. */
export function straightDistanceM(
  player: { readonly location: PlayerLocation; readonly home: HomeId },
  placeId: string,
): number | null {
  const from = tripEnd(player.location, player.home)
  const to = tripEnd({ kind: 'place', placeId }, player.home)
  if (from === undefined || to === undefined) return null
  return distanceM(from.stop.point, to.stop.point)
}

const METRES_PER_TENTH_MILE = 160.9344

/**
 * A distance in miles to one decimal: `2414` → "1.5 mi", never "0 mi". Kept out of
 * src/lib/format.ts on purpose: that module sits in every boot chunk, and the bundler does not
 * drop an unused export from it, so a distance formatter there grows the path to playable.
 * Plain arithmetic, no locale API: one decimal needs no grouping.
 */
export function formatMiles(metres: number): string {
  if (!Number.isFinite(metres)) throw new RangeError(`Distance must be finite: ${metres}`)
  const tenths = Math.max(1, Math.round(metres / METRES_PER_TENTH_MILE))
  return copy('phone.shop.miles', { miles: String(tenths / 10) })
}

/** "Queens". */
export function boroughName(id: Borough): string {
  const key = boroughs.find((entry) => entry.id === id)?.nameKey
  if (key === undefined || !isCopyKey(key)) throw new Error(`No name copy for borough ${id}`)
  return copy(key)
}
