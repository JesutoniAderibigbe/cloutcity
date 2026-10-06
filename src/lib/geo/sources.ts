/**
 * Ids of the upstream geo sources (scripts/geo/sources.lock.json). Every derived file in
 * /data/geo and /data/zones names the sources it was built from.
 *
 * No imports, so Node can load it from scripts/ with its built-in type stripping.
 */
export const GEO_SOURCE_IDS = ['dcp-borough-boundaries', 'dcp-nta-2020', 'mta-gtfs-subway'] as const
export type GeoSourceId = (typeof GEO_SOURCE_IDS)[number]
