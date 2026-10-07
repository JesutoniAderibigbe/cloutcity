import { describe, expect, it } from 'vitest'
import { geoManifest, geoVersion, geoVersionOf } from '@/lib/data/geo'
import { boroughs, mapPlaces } from '@/lib/world/places'
import { placesLayer } from '@/lib/world/placesLayer'
import { parseGeoBase } from '@/scene/geo/schema'
import { GET, dynamic } from './route'

describe('GET /geo/base', () => {
  it('is prerendered at build time', () => {
    expect(dynamic).toBe('force-static')
  })

  it('serves every base layer and the places layer in the format the scene validates', async () => {
    const response = GET()
    expect(response.headers.get('content-type')).toMatch(/application\/json/)
    const body = parseGeoBase(await response.json())
    expect(body.version).toBe(geoVersion)
    expect(body.land.boroughs.length).toBeGreaterThan(0)
    expect(body.subway.stations.length).toBeGreaterThan(0)
    expect(body.places.pins.map((pin) => pin.id)).toEqual(mapPlaces().map((place) => place.id))
    // data/boroughs/boroughs.json order (the Places panel groups in the same order).
    expect(body.places.boroughs.map((borough) => borough.id)).toEqual(
      boroughs.map((borough) => borough.id),
    )
  })
})

describe('geoVersion', () => {
  it('is a 12-hex hash of the base files and the places layer', () => {
    expect(geoVersion).toMatch(/^[0-9a-f]{12}$/)
    expect(geoVersionOf(geoManifest.files, placesLayer)).toBe(geoVersion)
  })

  it('changes when a base file hash changes', () => {
    const changed = geoManifest.files.map((file, i) =>
      i === 1 ? { ...file, sha256: '0'.repeat(64) } : file,
    )
    expect(geoVersionOf(changed, placesLayer)).not.toBe(geoVersion)
  })

  it('changes when a pin moves or changes style', () => {
    const [first, ...rest] = placesLayer.pins
    if (first === undefined) throw new Error('no pins')
    const moved = { ...placesLayer, pins: [{ ...first, x: first.x + 1 }, ...rest] }
    expect(geoVersionOf(geoManifest.files, moved)).not.toBe(geoVersion)
    const restyled = { ...placesLayer, pins: [{ ...first, style: 'teaser' }, ...rest] }
    expect(geoVersionOf(geoManifest.files, restyled)).not.toBe(geoVersion)
  })

  it('ignores non-base files', () => {
    const extra = [...geoManifest.files, { path: 'x', group: 'other', sha256: '1'.repeat(64) }]
    expect(geoVersionOf(extra, placesLayer)).toBe(geoVersion)
  })
})
