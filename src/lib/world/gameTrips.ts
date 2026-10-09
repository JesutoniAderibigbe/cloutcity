/**
 * The game map's trip tables (S04s, user decision "match the map"): what the places layer plans
 * for the game map (compact venues, S04n; the famous-places ring, S07d) as the two small files
 * travel reads.
 *
 * - data/places/game-points.derived.json: every moved place's game-map point. Trips on BOTH map
 *   styles plan to it (src/lib/world/tripEnds.ts), so travel time, fares, walking energy and
 *   the route's mode options match what the game map draws. The style is only a view: one
 *   canonical trip per pair of places means switching style can never buy a cheaper or quicker
 *   trip.
 * - data/places/game-gates.derived.json: a ring landmark stands in the ring home's borough, so
 *   that borough gates it (src/engine/boroughs.ts `placeGateBorough`).
 *
 * Pure; the derived-file test (gameTrips-derived.test.ts) keeps both files equal to this.
 */
import type { Borough } from '@/lib/data/schemas/content'
import type { GameGatesFile, GamePointsFile } from '@/lib/data/schemas/world'

interface TripPin {
  readonly id: string
  readonly borough: Borough
  readonly gx?: number
  readonly gy?: number
  /** Set on a ring landmark (placesLayer.ts `PlacePin.game`). */
  readonly game?: object
}

export function deriveGameTrips(
  pins: readonly TripPin[],
  ringBorough: Borough | null,
): { readonly points: GamePointsFile; readonly gates: GameGatesFile } {
  const points: Record<string, { x: number; y: number }> = {}
  const gates: Record<string, Borough> = {}
  for (const pin of pins) {
    if (pin.gx === undefined || pin.gy === undefined) continue
    points[pin.id] = { x: pin.gx, y: pin.gy }
    if (pin.game !== undefined && ringBorough !== null && pin.borough !== ringBorough) {
      gates[pin.id] = ringBorough
    }
  }
  return { points: { points }, gates: { gates } }
}
