/**
 * LION street fixtures for the S04i tests, laid out in local metres and served as lng/lat with
 * 6 decimals, like the LION query (geometryPrecision=6): a cross of two streets through the
 * fixture district's centre (four segments meeting at one junction), and one street in the
 * extra prop zone. The zone's page repeats one district segment, as overlapping envelopes do.
 */
import type { GeoStreetZone } from '../../../src/lib/data/schemas/config.ts'
import { project, unproject } from '../../../src/lib/geo/projection.ts'
import { FIXTURE_DISTRICT } from './buildings.ts'

export const FIXTURE_STREET_ZONE: GeoStreetZone = {
  id: 'sunnyside',
  label: 'Fixture Sunnyside',
  center: { lat: 40.7085, lng: -73.982 },
  radiusM: 150,
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6

export function streetFeature(
  segmentId: string,
  street: string,
  widthFt: number | null,
  points: readonly (readonly [number, number])[],
) {
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: points.map(([x, y]) => {
        const { lat, lng } = unproject({ x, y })
        return [round6(lng), round6(lat)]
      }),
    },
    properties: { SegmentID: segmentId, Street: street, StreetWidth_Min: widthFt },
  }
}

const centre = project(FIXTURE_DISTRICT.center)
const zone = project(FIXTURE_STREET_ZONE.center)
const at = (dx: number, dy: number, from = centre) => [from.x + dx, from.y + dy] as const

const district = [
  streetFeature('0000001', 'TEST STREET', 40, [at(-200, 0), at(-100, 0), at(0, 0)]),
  streetFeature('0000002', 'TEST STREET', 40, [at(0, 0), at(200, 0)]),
  streetFeature('0000003', 'TEST AVENUE', 80, [at(0, -200), at(0, 0)]),
  streetFeature('0000004', 'TEST AVENUE', 80, [at(0, 0), at(0, 200)]),
]
const extra = [
  district[1],
  streetFeature('0000010', 'ZONE ROAD', null, [at(-100, 0, zone), at(100, 0, zone)]),
]

const page = (features: readonly unknown[]) => ({ type: 'FeatureCollection', features })

export const FIXTURE_STREET_PAGES = {
  district: [page(district)],
  extra: [page(extra)],
} as const
export const FIXTURE_STREET_COUNTS = { district: district.length, extra: extra.length } as const
