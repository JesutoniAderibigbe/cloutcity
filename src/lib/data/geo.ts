/**
 * Validated geo layers from /data/geo and /data/zones (written by `npm run geo:build`), for the
 * engine and tests. Uses classic zod and pulls in about 430 KB of JSON: never import it into
 * shell or client components (S04a/S04e decide how the scene receives the layers, preferably
 * as fetched static assets). Zone metadata is in content.ts.
 */
import landJson from '@data/geo/land.derived.json'
import manifestJson from '@data/geo/manifest.derived.json'
import parksJson from '@data/geo/parks.derived.json'
import subwayJson from '@data/geo/subway.derived.json'
import waterJson from '@data/geo/water.derived.json'
import zoneShapesJson from '@data/zones/zone-shapes.derived.json'
import { parseDataFile } from './parse'
import {
  GeoManifestSchema,
  LandFileSchema,
  ParksFileSchema,
  SubwayFileSchema,
  WaterFileSchema,
  ZoneShapesFileSchema,
} from './schemas/world'

export const land = parseDataFile('geo/land.derived.json', LandFileSchema, landJson)
export const water = parseDataFile('geo/water.derived.json', WaterFileSchema, waterJson)
export const parks = parseDataFile('geo/parks.derived.json', ParksFileSchema, parksJson)
export const subway = parseDataFile('geo/subway.derived.json', SubwayFileSchema, subwayJson)
export const zoneShapes = parseDataFile(
  'zones/zone-shapes.derived.json',
  ZoneShapesFileSchema,
  zoneShapesJson,
)
export const geoManifest = parseDataFile(
  'geo/manifest.derived.json',
  GeoManifestSchema,
  manifestJson,
)
