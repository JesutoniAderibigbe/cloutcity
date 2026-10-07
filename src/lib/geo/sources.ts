/**
 * Ids of the upstream geo sources (scripts/geo/sources.lock.json). Every derived file in
 * /data/geo and /data/zones names the sources it was built from.
 *
 * No imports, so Node can load it from scripts/ with its built-in type stripping.
 */

/** Single-file downloads, in lock order. */
export const GEO_SOURCE_IDS = [
  'dcp-borough-boundaries',
  'dcp-nta-2020',
  'mta-gtfs-subway',
  'dcp-mappluto-density',
] as const
export type GeoSourceId = (typeof GEO_SOURCE_IDS)[number]

/** Districts that get real building masses (S04d); data/config/geo.json `districts` lists them. */
export const BUILDING_DISTRICT_IDS = [
  'midtown',
  'lower-manhattan',
  'downtown-brooklyn-dumbo',
  'williamsburg',
  'long-island-city',
  'astoria',
  'flushing',
  'jamaica',
] as const
export type BuildingDistrictId = (typeof BUILDING_DISTRICT_IDS)[number]

/**
 * Paged building-footprint downloads, one per district (`oti-buildings-<district id>`), in
 * BUILDING_DISTRICT_IDS order.
 */
export const BUILDING_SOURCE_IDS = [
  'oti-buildings-midtown',
  'oti-buildings-lower-manhattan',
  'oti-buildings-downtown-brooklyn-dumbo',
  'oti-buildings-williamsburg',
  'oti-buildings-long-island-city',
  'oti-buildings-astoria',
  'oti-buildings-flushing',
  'oti-buildings-jamaica',
] as const
export type BuildingSourceId = (typeof BUILDING_SOURCE_IDS)[number]

export const buildingSourceId = (district: BuildingDistrictId): BuildingSourceId =>
  `oti-buildings-${district}`

/** Every id a derived file may name in its `sources`. */
export const DERIVED_SOURCE_IDS = [...GEO_SOURCE_IDS, ...BUILDING_SOURCE_IDS] as const
export type DerivedSourceId = (typeof DERIVED_SOURCE_IDS)[number]
