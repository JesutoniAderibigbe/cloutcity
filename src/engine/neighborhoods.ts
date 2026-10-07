/**
 * Start neighborhoods (S16a, data/homes/neighborhoods.json). The creator's roll picks one per
 * save (src/engine/creator.ts `commitRoll`); once the player moves in, the start home stands at
 * the neighborhood's point instead of its default one (data/homes/homes.json).
 */
import type { EngineConfig, HomeId, NeighborhoodDef } from './config'

/** A WGS84 point. */
export interface HomePointLatLng {
  readonly lat: number
  readonly lng: number
}

export function findNeighborhood(id: string, config: EngineConfig): NeighborhoodDef | undefined {
  return config.neighborhoods.find((entry) => entry.id === id)
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
  config: EngineConfig,
): HomePointLatLng {
  const entry = neighborhood === null ? undefined : findNeighborhood(neighborhood, config)
  return entry !== undefined && entry.homes.includes(home) ? entry.home : defaults[home].location
}
