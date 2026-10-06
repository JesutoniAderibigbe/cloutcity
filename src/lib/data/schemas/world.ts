/** Schemas for /data/geo, /data/zones and /data/audio. */
import { z } from 'zod'
import { ORIGIN, PROJECTION_ID } from '../../geo/projection'
import { GEO_SOURCE_IDS } from '../../geo/sources'
import { BOROUGHS, BoroughSchema, IdSchema, listOf } from './content'

/** The NYC extent in WGS84 degrees: camera bounds and a sanity check for every coordinate. */
export const GeoBoundsSchema = z
  .strictObject({
    west: z.number().min(-180).max(180),
    south: z.number().min(-90).max(90),
    east: z.number().min(-180).max(180),
    north: z.number().min(-90).max(90),
  })
  .refine((b) => b.west < b.east && b.south < b.north, { error: 'empty or inverted bounds' })
export type GeoBounds = z.infer<typeof GeoBoundsSchema>

/** Every derived layer records the projection its metres are in (src/lib/geo/projection.ts). */
export const ProjectionRefSchema = z.strictObject({
  id: z.literal(PROJECTION_ID),
  originLat: z.literal(ORIGIN.lat),
  originLng: z.literal(ORIGIN.lng),
})

/**
 * Header shared by every `*.derived.json` file written by `npm run geo:build`: it is simplified
 * artwork derived from the named sources, not the original data (MTA and NYC terms).
 */
const derivedHeader = {
  format: z.literal('cc-geo-v1'),
  derived: z.literal(true),
  notice: z.string().min(1),
  sources: z.array(z.enum(GEO_SOURCE_IDS)).min(1),
  projection: ProjectionRefSchema,
}
export const DerivedHeaderSchema = z.strictObject(derivedHeader)

const metre = z.int()

/** Open ring of integer metres, delta-encoded (see src/lib/geo/codec.ts): at least 3 vertices. */
export const DeltaRingSchema = z
  .array(metre)
  .min(6)
  .refine((ring) => ring.length % 2 === 0, { error: 'odd coordinate count' })
/** [outer, ...holes]. */
export const PolygonSchema = z.array(DeltaRingSchema).min(1)
/** Open polyline of integer metres, delta-encoded: at least 2 vertices. */
export const DeltaPathSchema = z
  .array(metre)
  .min(4)
  .refine((path) => path.length % 2 === 0, { error: 'odd coordinate count' })

const polygons = z.array(PolygonSchema).min(1)

export const LandFileSchema = z.strictObject({
  ...derivedHeader,
  boroughs: listOf(
    z.strictObject({ id: BoroughSchema, boroCode: z.int().min(1).max(5), polygons }),
  ).length(BOROUGHS.length),
})

export const WaterFileSchema = z.strictObject({ ...derivedHeader, sea: PolygonSchema })

const NtaCodeSchema = z.string().regex(/^[A-Z]{2}\d{4}$/, 'NTA 2020 code, e.g. QN0101')

export const ParksFileSchema = z.strictObject({
  ...derivedHeader,
  parks: listOf(
    z.strictObject({
      id: IdSchema,
      ntaCode: NtaCodeSchema,
      kind: z.enum(['park', 'cemetery']),
      borough: BoroughSchema,
      polygons,
    }),
  ),
})

export const SubwayLineSchema = z.strictObject({
  id: IdSchema,
  gtfsRouteId: z.string().min(1),
  /** route_short_name, drawn as plain text in our own style (never MTA bullets). */
  label: z.string().min(1),
  paths: z.array(DeltaPathSchema).min(1),
})
export const SubwayStationSchema = z.strictObject({
  id: IdSchema,
  gtfsStopId: z.string().min(1),
  /** GTFS stop_name (STN-1: branded names get generic display labels through copy later). */
  name: z.string().min(1),
  x: metre,
  y: metre,
  borough: BoroughSchema,
  zoneId: IdSchema,
  lines: z.array(IdSchema).min(1),
})
export const SubwayFileSchema = z.strictObject({
  ...derivedHeader,
  lines: listOf(SubwayLineSchema).min(1),
  stations: listOf(SubwayStationSchema).min(1),
  /** Paths extended to a station their GTFS shapes stop short of (listed in SOURCES.md). */
  terminalExtensions: z.array(
    z.strictObject({ lineId: IdSchema, stationId: IdSchema, gapM: z.int().nonnegative() }),
  ),
})
export type SubwayLine = z.infer<typeof SubwayLineSchema>
export type SubwayStation = z.infer<typeof SubwayStationSchema>

/**
 * Play zones: one per 2020 Community District Tabulation Area (59 community districts plus 12
 * joint interest areas such as parks and airports), each a group of NYC Neighborhood
 * Tabulation Areas. `name` is the CDTA name from the source data (a place name, not our copy).
 */
export const ZoneSchema = z.strictObject({
  id: IdSchema,
  cdtaCode: z.string().regex(/^(?:BK|BX|MN|QN|SI)\d{2}$/, 'CDTA 2020 code, e.g. QN01'),
  kind: z.enum(['district', 'joint-interest-area']),
  name: z.string().min(1),
  borough: BoroughSchema,
  ntaCodes: z.array(NtaCodeSchema).min(1),
  /** An interior label point in local metres. */
  centroid: z.strictObject({ x: metre, y: metre }),
})
export const ZonesFileSchema = z.strictObject({ ...derivedHeader, zones: listOf(ZoneSchema) })
export type Zone = z.infer<typeof ZoneSchema>

export const ZoneShapesFileSchema = z.strictObject({
  ...derivedHeader,
  zones: listOf(z.strictObject({ id: IdSchema, polygons })),
})

/** data/geo/manifest.derived.json: size and hash of every file the geo build writes. */
export const GeoManifestSchema = z.strictObject({
  format: z.literal('cc-geo-manifest-v1'),
  files: z
    .array(
      z.strictObject({
        /** Relative to data/. */
        path: z.string().regex(/^(?:geo|zones)\/(?:[a-z0-9-]+\.derived\.json|SOURCES\.md)$/),
        /** `base` ships with the map (perf.json baseGeoGzKB); `docs` does not. */
        group: z.enum(['base', 'docs']),
        bytes: z.int().positive(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
      }),
    )
    .min(1),
})
export type GeoManifest = z.infer<typeof GeoManifestSchema>

export const AUDIO_CHANNELS = ['music', 'sfx', 'ambience', 'voice'] as const

/** Music is CC0 only (no radio); every track records where it came from. */
export const AudioTrackSchema = z.strictObject({
  id: IdSchema,
  channel: z.enum(AUDIO_CHANNELS),
  /** Path under public/, e.g. `/audio/music/loop-1.ogg`. */
  file: z.string().regex(/^\/audio\/[a-z0-9/_-]+\.(?:ogg|mp3|m4a|webm)$/),
  license: z.literal('CC0-1.0'),
  sourceUrl: z.url({ protocol: /^https$/ }),
})
export const AudioManifestSchema = z.strictObject({
  channels: z.array(z.enum(AUDIO_CHANNELS)).length(AUDIO_CHANNELS.length),
  tracks: z.array(AudioTrackSchema),
})
export type AudioTrack = z.infer<typeof AudioTrackSchema>
