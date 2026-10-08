/**
 * Ids of the street props' LION downloads (S04i): the prop zones and one paged source per zone.
 * Kept apart from sources.ts, which ships with the map, so these lists load only with the code
 * that uses them (the geo build, the server and the lazy street props chunk).
 *
 * No imports (it would tie the lazy chunk to sources.ts in the map's chunk), so the district ids
 * are repeated here; streetSources.test.ts holds them equal to sources.ts BUILDING_DISTRICT_IDS.
 * Node loads it from scripts/ with its built-in type stripping.
 */

/**
 * Prop zones outside the districts (S04i): circles around homes, venues and landmarks that
 * get street props on real LION streets. data/config/geo.json `streets.zones` places them.
 */
export const STREET_EXTRA_ZONE_IDS = [
  'ditmars-steinway',
  'sunnyside',
  'crown-heights',
  'bushwick',
  'gowanus',
  'fort-greene',
  'lower-east-side',
  'union-square',
  'chelsea',
] as const
export type StreetExtraZoneId = (typeof STREET_EXTRA_ZONE_IDS)[number]

/** Every prop zone: the building districts (sources.ts BUILDING_DISTRICT_IDS), then the extras. */
export const STREET_ZONE_IDS = [
  'midtown',
  'lower-manhattan',
  'downtown-brooklyn-dumbo',
  'williamsburg',
  'long-island-city',
  'astoria',
  'flushing',
  'jamaica',
  ...STREET_EXTRA_ZONE_IDS,
] as const
export type StreetZoneId = (typeof STREET_ZONE_IDS)[number]

/**
 * Paged LION street downloads, one per prop zone (`dcp-lion-props-<zone id>`), in
 * STREET_ZONE_IDS order.
 */
export const STREET_SOURCE_IDS = [
  'dcp-lion-props-midtown',
  'dcp-lion-props-lower-manhattan',
  'dcp-lion-props-downtown-brooklyn-dumbo',
  'dcp-lion-props-williamsburg',
  'dcp-lion-props-long-island-city',
  'dcp-lion-props-astoria',
  'dcp-lion-props-flushing',
  'dcp-lion-props-jamaica',
  'dcp-lion-props-ditmars-steinway',
  'dcp-lion-props-sunnyside',
  'dcp-lion-props-crown-heights',
  'dcp-lion-props-bushwick',
  'dcp-lion-props-gowanus',
  'dcp-lion-props-fort-greene',
  'dcp-lion-props-lower-east-side',
  'dcp-lion-props-union-square',
  'dcp-lion-props-chelsea',
] as const
export type StreetSourceId = (typeof STREET_SOURCE_IDS)[number]

export const streetSourceId = (zone: StreetZoneId): StreetSourceId => `dcp-lion-props-${zone}`
