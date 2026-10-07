/**
 * Validated geo layers from /data/geo and /data/zones (written by `npm run geo:build`), for the
 * engine and tests. Uses classic zod and pulls in about 430 KB of JSON: never import it into
 * shell or client components: the scene fetches the base layers from the static route
 * /geo/base (src/app/geo/base/route.ts) instead. Zone metadata is in content.ts.
 */
import { createHash } from 'node:crypto'
import landJson from '@data/geo/land.derived.json'
import manifestJson from '@data/geo/manifest.derived.json'
import parksJson from '@data/geo/parks.derived.json'
import subwayJson from '@data/geo/subway.derived.json'
import waterJson from '@data/geo/water.derived.json'
import zoneShapesJson from '@data/zones/zone-shapes.derived.json'
import { placesLayer } from '@/lib/world/placesLayer'
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

/**
 * Short content hash of everything /geo/base serves: the base layers' manifest sha256s and the
 * places layer (S04c, built from the venue, landmark and borough data). The scene fetches
 * /geo/base?v=<geoVersion> (and /geo/fallback), so a geo rebuild or a moved place changes the
 * URL and no stale copy is reused.
 */
export function geoVersionOf(
  files: readonly { readonly path: string; readonly group: string; readonly sha256: string }[],
  places: unknown,
): string {
  const placesHash = createHash('sha256').update(JSON.stringify(places)).digest('hex')
  return createHash('sha256')
    .update(
      [
        ...files
          .filter((file) => file.group === 'base')
          .map((file) => `${file.path}:${file.sha256}`),
        `places:${placesHash}`,
      ].join('\n'),
    )
    .digest('hex')
    .slice(0, 12)
}

export const geoVersion = geoVersionOf(geoManifest.files, placesLayer)
