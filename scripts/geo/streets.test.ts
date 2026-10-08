import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GeoConfigSchema } from '../../src/lib/data/schemas/config'
import { StreetsFileSchema } from '../../src/lib/data/schemas/world'
import { encodePath } from '../../src/lib/geo/codec'
import { distanceToPolyline } from '../../src/lib/geo/polygon'
import { distanceM, project, type LocalPoint } from '../../src/lib/geo/projection'
import { streetSourceId } from '../../src/lib/geo/streetSources'
import { BLOCK_TRIANGLES, type TierBlocks } from './blocks'
import { FIXTURE_DISTRICT } from './fixtures/buildings'
import {
  FIXTURE_STREET_COUNTS,
  FIXTURE_STREET_PAGES,
  FIXTURE_STREET_ZONE,
} from './fixtures/streets'
import { FIXTURE_CONFIG } from './fixtures/synthetic'
import { LockSchema, streetZoneCircles } from './lock'
import {
  STREET_FLAGS,
  buildStreets,
  carveBlocks,
  cutPath,
  decodeChains,
  decodeIndices,
  encodeIndices,
  readStreetSegments,
  segmentSquareDistance,
  simplifyChain,
  streetsFileText,
  type StreetsInputs,
} from './streets'

const ROOT = join(import.meta.dirname, '../..')
const config = FIXTURE_CONFIG.streets
const centre = project(FIXTURE_DISTRICT.center)
const zones = streetZoneCircles(FIXTURE_CONFIG)

function fixtureInputs(overrides: Partial<StreetsInputs> = {}): StreetsInputs {
  return {
    zones,
    segments: new Map([
      [
        streetSourceId('midtown'),
        readStreetSegments('d', FIXTURE_STREET_PAGES.district, FIXTURE_STREET_COUNTS.district),
      ],
      [
        streetSourceId('sunnyside'),
        readStreetSegments('z', FIXTURE_STREET_PAGES.extra, FIXTURE_STREET_COUNTS.extra),
      ],
    ]),
    exclusions: [],
    memorials: [],
    parks: [],
    ...overrides,
  }
}

const near = (a: LocalPoint, b: LocalPoint) => distanceM(a, b) <= 1.5

describe('readStreetSegments', () => {
  it('reads every LINESTRING with its id, trimmed name and width', () => {
    const segments = readStreetSegments('d', FIXTURE_STREET_PAGES.district, 4)
    expect(segments.map((s) => [s.segmentId, s.street, s.widthFt])).toEqual([
      ['0000001', 'TEST STREET', 40],
      ['0000002', 'TEST STREET', 40],
      ['0000003', 'TEST AVENUE', 80],
      ['0000004', 'TEST AVENUE', 80],
    ])
  })

  it('fails when the pages do not hold the locked count, or a page is malformed', () => {
    expect(() => readStreetSegments('d', FIXTURE_STREET_PAGES.district, 5)).toThrow(
      /hold 4 features, the lock counts 5/,
    )
    expect(() =>
      readStreetSegments('d', [{ type: 'FeatureCollection', features: [{ type: 'Feature' }] }], 1),
    ).toThrow(/Invalid d page 0/)
  })
})

describe('buildStreets', () => {
  const result = buildStreets(fixtureInputs(), config)

  it('keeps each LION segment once and joins one chain per street through the junction', () => {
    expect(result.stats).toMatchObject({ segments: 6, duplicates: 1, outsideZones: 0, cut: 0 })
    expect(result.chains.map((c) => c.street)).toEqual(['TEST AVENUE', 'TEST STREET', 'ZONE ROAD'])
    const [avenue, street, road] = result.chains
    // Collinear vertices go, the junction where four segment ends meet stays.
    expect(street?.points).toHaveLength(3)
    expect(street?.junctions).toEqual([1])
    expect(near(street?.points[1] ?? { x: 0, y: 0 }, centre)).toBe(true)
    expect(avenue?.junctions).toEqual([1])
    expect(road?.junctions).toEqual([])
    expect(result.sources).toEqual(['dcp-lion-props-midtown', 'dcp-lion-props-sunnyside'])
  })

  it('turns the curb-to-curb width into a half-width to 0.5 m and flags wide streets', () => {
    const byName = new Map(result.chains.map((c) => [c.street, c]))
    // 80 ft = 24.4 m, 40 ft = 12.2 m, no width = 30 ft = 9.1 m (geo.json defaultWidthFt).
    expect(byName.get('TEST AVENUE')?.halfWidthM).toBe(12)
    expect(byName.get('TEST STREET')?.halfWidthM).toBe(6)
    expect(byName.get('ZONE ROAD')?.halfWidthM).toBe(4.5)
    expect((byName.get('TEST AVENUE')?.flags ?? 0) & STREET_FLAGS.wide).toBe(STREET_FLAGS.wide)
    expect((byName.get('TEST STREET')?.flags ?? 0) & STREET_FLAGS.wide).toBe(0)
  })

  it('flags the side of a chain that borders a park', () => {
    const park = {
      id: 'park-test',
      polygons: [
        [
          encodePath([
            { x: Math.round(centre.x - 150), y: Math.round(centre.y + 10) },
            { x: Math.round(centre.x + 150), y: Math.round(centre.y + 10) },
            { x: Math.round(centre.x + 150), y: Math.round(centre.y + 60) },
            { x: Math.round(centre.x - 150), y: Math.round(centre.y + 60) },
          ]),
        ],
      ],
    }
    const parked = buildStreets(fixtureInputs({ parks: [park] }), config)
    const street = parked.chains.find((c) => c.street === 'TEST STREET')
    // TEST STREET runs east: north of it is its left.
    expect(street?.flags).toBe(STREET_FLAGS.parkLeft)
  })

  it('cuts every street away from a memorial, by the clearance plus half-width plus reach', () => {
    const memorial = { x: centre.x + 150, y: centre.y }
    const cleared = buildStreets(fixtureInputs({ memorials: [memorial] }), config)
    expect(cleared.stats.cut).toBeGreaterThan(0)
    for (const chain of cleared.chains) {
      expect(distanceToPolyline(memorial, chain.points)).toBeGreaterThan(
        config.lookOnlyClearM + chain.halfWidthM + config.reachM - config.simplifyM - 1,
      )
    }
    expect(cleared.clear).toEqual([
      { x: Math.round(memorial.x), y: Math.round(memorial.y), r: config.lookOnlyClearM },
    ])
  })

  it("cuts streets off a landmark's grown exclusion rectangle", () => {
    const rect = { x: centre.x - 150, y: centre.y, halfLengthM: 20, halfWidthM: 20, angleDeg: 0 }
    const cleared = buildStreets(fixtureInputs({ exclusions: [rect] }), config)
    const street = cleared.chains.find((c) => c.street === 'TEST STREET')
    const reach = 20 + config.exclusionMarginM + (street?.halfWidthM ?? 0) + config.reachM
    for (const point of street?.points ?? []) {
      expect(Math.abs(point.x - rect.x) > reach - 1 || Math.abs(point.y - rect.y) > reach - 1).toBe(
        true,
      )
    }
  })

  it('drops segments whose midpoint lies outside every zone', () => {
    const tiny = streetZoneCircles({
      ...FIXTURE_CONFIG,
      districts: [{ ...FIXTURE_DISTRICT, radiusM: 50 }],
      streets: { ...config, zones: [FIXTURE_STREET_ZONE] },
    })
    const out = buildStreets(fixtureInputs({ zones: tiny }), config)
    // Each district segment's midpoint is 100 m out; the zone road stays.
    expect(out.stats.outsideZones).toBe(4)
    expect(out.chains.map((c) => c.street)).toEqual(['ZONE ROAD'])
  })

  it('writes a file its schema accepts, whose columns decode back to the chains', () => {
    const file = StreetsFileSchema.parse(JSON.parse(streetsFileText(result)))
    const decoded = decodeChains(file.chains)
    expect(decoded.map((c) => c.points)).toEqual(result.chains.map((c) => c.points))
    const all = decoded.flatMap((c) => c.points)
    for (const index of decodeIndices(file.chains.j)) {
      expect(near(all[index] ?? { x: 0, y: 0 }, centre)).toBe(true)
    }
    expect(file.chains.e).toEqual(result.chains.map((c) => c.flags))
  })

  it('is deterministic', () => {
    expect(streetsFileText(buildStreets(fixtureInputs(), config))).toBe(streetsFileText(result))
  })
})

describe('chain helpers', () => {
  it('cutPath splits a path wherever its steps enter a clearance', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]
    const pieces = cutPath(path, (p) => p.x > 40 && p.x < 60)
    expect(pieces).toHaveLength(2)
    expect(pieces[0]?.at(-1)?.x).toBeLessThanOrEqual(40)
    expect(pieces[1]?.[0]?.x).toBeGreaterThanOrEqual(60)
    expect(cutPath(path, () => true)).toEqual([])
  })

  it('simplifyChain keeps a collinear junction vertex and rounds to whole metres', () => {
    const junction = { x: 50.2, y: 0.1 }
    const out = simplifyChain(
      [{ x: 0, y: 0 }, { x: 25, y: 0 }, junction, { x: 100.4, y: 0 }],
      (p) => p === junction,
      1,
    )
    expect(out.points).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ])
    expect(out.junctions).toEqual([1])
  })

  it('encodes ascending indices as deltas and back', () => {
    expect(encodeIndices([0, 4, 9])).toEqual([0, 4, 5])
    expect(decodeIndices([0, 4, 5])).toEqual([0, 4, 9])
  })

  it('segmentSquareDistance: 0 when the segment touches the square, else the gap', () => {
    expect(segmentSquareDistance({ x: -20, y: 0 }, { x: 20, y: 0 }, 5)).toBe(0)
    expect(segmentSquareDistance({ x: -20, y: 8 }, { x: 20, y: 8 }, 5)).toBeCloseTo(3)
    expect(segmentSquareDistance({ x: 8, y: 8 }, { x: 20, y: 20 }, 5)).toBeCloseTo(Math.hypot(3, 3))
    expect(segmentSquareDistance({ x: 1, y: 1 }, { x: 2, y: 2 }, 5)).toBe(0)
  })
})

describe('carveBlocks', () => {
  const streets = buildStreets(fixtureInputs(), config)
  const zone = project(FIXTURE_STREET_ZONE.center)
  const at = (dx: number, dy: number, from: LocalPoint = zone) => ({
    x: Math.round(from.x + dx),
    y: Math.round(from.y + dy),
  })
  const blocks: TierBlocks = {
    sizeM: 20,
    instances: 3,
    triangles: 3 * BLOCK_TRIANGLES,
    groups: [
      {
        borough: 'queens',
        angleDeg: 0,
        // On ZONE ROAD; 40 m north of it (clear); on a district street (not an extra zone).
        p: encodePath([at(0, 0), at(0, 40), at(150, 0, centre)]),
        h: [10, 20, 30],
      },
    ],
  }
  const extra = streets.zones.filter((z) => z.id === 'sunnyside')

  it('drops only the extra-zone blocks a street crosses', () => {
    const { blocks: carved, carved: count } = carveBlocks(blocks, streets, extra, config)
    expect(count).toBe(1)
    expect(carved.instances).toBe(2)
    expect(carved.triangles).toBe(2 * BLOCK_TRIANGLES)
    expect(carved.groups[0]?.h).toEqual([20, 30])
  })

  it('a block whose edge comes within the half-width plus the margin goes too', () => {
    // ZONE ROAD: half-width 4.5 m + 2 m margin; a 20 m block centred 16 m off has a 6 m gap.
    const close = {
      ...blocks,
      groups: [{ ...blocks.groups[0]!, p: encodePath([at(0, 16)]), h: [9] }],
    }
    expect(carveBlocks(close, streets, extra, config).carved).toBe(1)
    const clear = {
      ...blocks,
      groups: [{ ...blocks.groups[0]!, p: encodePath([at(0, 17)]), h: [9] }],
    }
    expect(carveBlocks(clear, streets, extra, config).carved).toBe(0)
  })
})

describe('committed data/geo/streets.derived.json', () => {
  const file = StreetsFileSchema.parse(
    JSON.parse(readFileSync(join(ROOT, 'data/geo/streets.derived.json'), 'utf8')),
  )
  const geo = GeoConfigSchema.parse(
    JSON.parse(readFileSync(join(ROOT, 'data/config/geo.json'), 'utf8')),
  )
  const lock = LockSchema.parse(
    JSON.parse(readFileSync(join(ROOT, 'scripts/geo/sources.lock.json'), 'utf8')),
  )
  const chains = decodeChains(file.chains)

  it('comes from the locked LION query of every prop zone', () => {
    const zoneIds = streetZoneCircles(geo).map((zone) => zone.id)
    expect(file.zones.map((zone) => zone.id)).toEqual(zoneIds)
    expect(file.sources).toEqual(zoneIds.map(streetSourceId))
    const locked = new Set(lock.pagedSources.map((entry) => entry.id))
    for (const source of file.sources) expect(locked.has(source)).toBe(true)
  })

  it('keeps every street clear of the memorial by its clearance plus half-width', () => {
    const landmarks = JSON.parse(
      readFileSync(join(ROOT, 'data/landmarks/landmarks.json'), 'utf8'),
    ) as { landmarks: { category: string; location: { lat: number; lng: number } }[] }
    const memorials = landmarks.landmarks
      .filter((l) => l.category === 'memorial')
      .map((l) => project(l.location))
    expect(memorials.length).toBeGreaterThan(0)
    expect(file.clear).toHaveLength(memorials.length)
    for (const memorial of memorials) {
      for (const chain of chains) {
        expect(distanceToPolyline(memorial, chain.points)).toBeGreaterThan(
          geo.streets.lookOnlyClearM + chain.halfWidthM,
        )
      }
    }
  })

  it('puts every home and venue inside a prop zone (a district or a streets zone)', () => {
    const homes = JSON.parse(readFileSync(join(ROOT, 'data/homes/homes.json'), 'utf8')) as {
      homes: Record<string, { location: { lat: number; lng: number } }>
    }
    const venues = JSON.parse(readFileSync(join(ROOT, 'data/venues/venues.json'), 'utf8')) as {
      venues: { id: string; location: { lat: number; lng: number } }[]
    }
    const places = [
      ...Object.entries(homes.homes).map(([id, home]) => ({ id, location: home.location })),
      ...venues.venues,
    ]
    for (const place of places) {
      const point = project(place.location)
      const inside = file.zones.some(
        (zone) => Math.hypot(point.x - zone.x, point.y - zone.y) <= zone.r,
      )
      expect(inside, place.id).toBe(true)
    }
  })
})
