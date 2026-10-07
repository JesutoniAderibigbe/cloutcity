/**
 * GET /geo/base: the validated base geo layers (land, water, parks, subway) as one JSON body for
 * the 3D scene, so the ~290 KB of geo JSON never ships in a JS chunk. Prerendered at build time
 * (force-static); the scene requests it as /geo/base?v=<geoVersion>, so a geo rebuild changes
 * the URL. Long-lived caching headers and service-worker precaching arrive with S04e.
 */
import { geoVersion, land, parks, subway, water } from '@/lib/data/geo'
import { GEO_BASE_FORMAT } from '@/scene/geo/schema'

export const dynamic = 'force-static'

export function GET(): Response {
  return Response.json({ format: GEO_BASE_FORMAT, version: geoVersion, land, water, parks, subway })
}
