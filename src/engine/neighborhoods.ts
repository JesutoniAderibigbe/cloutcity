/**
 * Start neighborhoods (S16a, data/homes/neighborhoods.json). The creator's roll picks one per
 * save (src/engine/creatorFlow.ts `commitRoll`); once the player moves in, the start home stands
 * at the neighborhood's point instead of its default one (data/homes/homes.json). It reads the
 * neighborhoods' points, so only the creator and the map's lazy code call it.
 */
import type { HomeId } from './config'
import type { NeighborhoodDef } from './creatorConfig'

/** A WGS84 point. */
export interface HomePointLatLng {
  readonly lat: number
  readonly lng: number
}

/**
 * Where `home` stands for a player in `neighborhood`: the neighborhood's point when the home is
 * one of its startable homes, else the home's default point (`defaults`, data/homes/homes.json,
 * passed in so the engine needs no map data).
 */
export function homePoint(
  home: HomeId,
  neighborhood: string | null,
  defaults: Readonly<Record<HomeId, { readonly location: HomePointLatLng }>>,
  neighborhoods: readonly NeighborhoodDef[],
): HomePointLatLng {
  const entry = neighborhoods.find((candidate) => candidate.id === neighborhood)
  return entry !== undefined && entry.homes.includes(home) ? entry.home : defaults[home].location
}
