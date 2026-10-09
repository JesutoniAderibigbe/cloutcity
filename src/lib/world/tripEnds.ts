/**
 * The two ends of a trip (S08 part 2) as travel needs them: the point routes start and end at,
 * the borough that gates it, and where the avatar stands at rest (a place's pin, or the home).
 * A landmark with an `approach` (a bridge, an island) routes to the approach and rests at its
 * pin; everywhere else the two are the same point.
 *
 * Trips match the game map (S04s, user decision "match the map"): a place the game map moves
 * (a compact venue, S04n; a famous-places ring landmark, S07d) routes to and rests at its
 * game-map point (data/places/game-points.derived.json) on BOTH map styles. Travel time, fares,
 * walking energy and the modes on offer are the same whatever the style, so the style is only
 * a view and switching it can never buy a cheaper or quicker trip. `real` keeps the real points,
 * where the Real NYC style draws the trip (src/state/tripDriver.ts).
 *
 * Client code: like places.ts it reads data/homes/homes.json and the derived points directly
 * (bundled at build time and validated by HomesFileSchema and GamePointsFileSchema in
 * src/lib/data/data.test.ts).
 */
import homesJson from '@data/homes/homes.json'
import gamePointsJson from '@data/places/game-points.derived.json'
import type { HomeId } from '@/engine/config'
import type { PlayerLocation } from '@/engine/game'
import type { TripStop } from '@/engine/transit/trip'
import type { Borough } from '@/lib/data/schemas/content'
import { project, type LocalPoint } from '@/lib/geo/projection'
import { mapPlaces } from './places'

export interface TripEnd {
  /** The end travel plans to: the game-map point of a place the game map moves. */
  readonly stop: TripStop
  /** Where the avatar stands at this end on the game map. */
  readonly rest: LocalPoint
  /** The real route point and resting point, where the Real NYC style draws the trip. */
  readonly real: { readonly point: LocalPoint; readonly rest: LocalPoint }
}

const homes = homesJson.homes as Readonly<
  Record<HomeId, { readonly borough: Borough; readonly location: { lat: number; lng: number } }>
>

const gamePoints = gamePointsJson.points as Readonly<Record<string, LocalPoint | undefined>>

/** The trip end for a location, or undefined for a place id the data does not have. */
export function tripEnd(location: PlayerLocation, home: HomeId): TripEnd | undefined {
  if (location.kind === 'home') {
    const entry = homes[home]
    const point = project(entry.location)
    return {
      stop: { location, point, borough: entry.borough },
      rest: point,
      real: { point, rest: point },
    }
  }
  const place = mapPlaces().find((candidate) => candidate.id === location.placeId)
  if (place === undefined) return undefined
  const real = { point: { x: place.routeX, y: place.routeY }, rest: { x: place.x, y: place.y } }
  const game = gamePoints[place.id]
  return {
    stop: { location, point: game ?? real.point, borough: place.borough },
    rest: game ?? real.rest,
    real,
  }
}
