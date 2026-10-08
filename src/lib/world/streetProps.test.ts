import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { perf, props } from '@/lib/data/config'
import { modelManifest } from '@/lib/data/models'
import { StreetsFileSchema } from '@/lib/data/schemas/world'
import { STREET_PROP_MODELS } from '@/lib/data/schemas/config'
import { encodePath } from '@/lib/geo/codec'
import { pointInPolygon } from '@/lib/geo/polygon'
import { project } from '@/lib/geo/projection'
import { districtMasses, massesFor } from '@/scene/buildings/buildDistrict'
import { BlocksMiniSchema, DistrictBuildingsMiniSchema } from '@/scene/buildings/schema'
import * as engineRng from '@/engine/rng'
import {
  STREET_FLAGS,
  createRng,
  mixSeed,
  applyQuotas,
  bucket,
  fillBlockLookup,
  outsideFillBlocks,
  chainAt,
  decodeStreets,
  placeChain,
  placeJunctions,
  placeWaterTowers,
  selectChunks,
  type Chunk,
  type Placement,
  type PlacementContext,
  type PropsTier,
  type StreetsColumns,
} from './streetProps'

const ROOT = join(import.meta.dirname, '../../..')
const read = (path: string): unknown => JSON.parse(readFileSync(join(ROOT, path), 'utf8'))

/** Two streets crossing at (0, 0), plus a far one; half-widths 6 m and 10 m. */
function crossing(): StreetsColumns {
  const east = [
    { x: -300, y: 0 },
    { x: 0, y: 0 },
    { x: 300, y: 0 },
  ]
  const north = [
    { x: 0, y: -300 },
    { x: 0, y: 0 },
    { x: 0, y: 300 },
  ]
  const far = [
    { x: 5000, y: 5000 },
    { x: 5400, y: 5000 },
  ]
  return {
    zones: [{ id: 'midtown', x: 0, y: 0, r: 1000 }],
    clear: [],
    chains: {
      n: [3, 3, 2],
      p: [...encodePath([...east, ...north, ...far])],
      w: [6, 10, 5],
      // Vertex 1 (east's middle) and 4 (north's middle): the shared junction.
      j: [1, 3],
      e: [STREET_FLAGS.parkLeft, STREET_FLAGS.wide, 0],
    },
  }
}

const ctxFor = (tier: PropsTier, overrides: Partial<PlacementContext> = {}): PlacementContext => ({
  tier,
  config: props,
  pins: [],
  clear: [],
  ...overrides,
})

describe('placement generator', () => {
  it('draws exactly what src/engine/rng.ts draws for the same seed', () => {
    for (const [a, b] of [
      [4211, 1],
      [0, 0],
      [123456789, 987654321],
    ] as const) {
      expect(mixSeed(a, b)).toBe(engineRng.mixSeed(a, b))
      const ours = createRng(mixSeed(a, b))
      const engine = engineRng.createRng(engineRng.mixSeed(a, b))
      for (let i = 0; i < 20; i++) expect(ours.next()).toBe(engine.next())
    }
  })
})

describe('decodeStreets', () => {
  it('splits the columns into chains with lengths, junctions, flags and a seed each', () => {
    const data = decodeStreets(crossing(), props.seed)
    expect(data.chains.map((c) => c.points.length)).toEqual([3, 3, 2])
    expect(data.chains.map((c) => c.length)).toEqual([600, 600, 400])
    expect(data.chains.map((c) => c.junctions)).toEqual([[1], [1], []])
    expect(data.chains.map((c) => c.halfWidthM)).toEqual([6, 10, 5])
    expect(new Set(data.chains.map((c) => c.seed)).size).toBe(3)
    expect(chainAt(data.chains[0]!, 450).p).toEqual({ x: 150, y: 0 })
  })
})

describe('placeChain', () => {
  const data = decodeStreets(crossing(), props.seed)
  const east = data.chains[0]!

  it('is deterministic', () => {
    expect(placeChain(east, ctxFor('mid'))).toEqual(placeChain(east, ctxFor('mid')))
  })

  it('puts streetlights on the sidewalk, alternating sides, clear of the junction', () => {
    const lights = placeChain(east, ctxFor('mid')).filter((p) => p.model === 'streetlight')
    expect(lights.length).toBeGreaterThan(5)
    const curb = east.halfWidthM + props.sidewalkOffsetM
    for (const light of lights) {
      expect(Math.abs(light.y)).toBeCloseTo(curb, 6)
      expect(Math.abs(light.x)).toBeGreaterThanOrEqual(east.halfWidthM + props.junctionClearM)
    }
    expect(lights.some((l) => l.y > 0)).toBe(true)
    expect(lights.some((l) => l.y < 0)).toBe(true)
  })

  it('parks cars in the parking lane, along the street', () => {
    const many = {
      ...props,
      rules: { ...props.rules, parked: { ...props.rules.parked, chance: { mid: 1, high: 1 } } },
    }
    const cars = placeChain(east, ctxFor('mid', { config: many })).filter(
      (p) => p.rule === 'parked',
    )
    expect(cars.length).toBeGreaterThan(10)
    for (const car of cars) {
      expect(Math.abs(car.y)).toBeCloseTo(east.halfWidthM - props.parkingOffsetM, 6)
      expect(props.rules.parked.models.mid).toContain(car.model)
      // A car's length (model +z) runs east-west: a quarter turn either way.
      expect(Math.abs(Math.cos(car.rotation))).toBeLessThan(1e-9)
    }
  })

  it('puts benches on a park edge, on the park side', () => {
    const benches = placeChain(east, ctxFor('mid')).filter((p) => p.model === 'bench')
    expect(benches.length).toBeGreaterThan(0)
    // parkLeft on an eastward street: north.
    for (const bench of benches) expect(bench.y).toBeGreaterThan(0)
  })

  it('keeps every prop off the pins and out of the clear circles', () => {
    const pins = [{ x: 100, y: 8 }]
    const clear = [{ x: -150, y: 0, r: 60 }]
    for (const p of placeChain(east, ctxFor('high', { pins, clear }))) {
      expect(Math.hypot(p.x - 100, p.y - 8)).toBeGreaterThanOrEqual(props.pinClearM)
      expect(Math.hypot(p.x + 150, p.y)).toBeGreaterThanOrEqual(60)
    }
  })

  it("never moves one street's props when another street changes", () => {
    const before = placeChain(east, ctxFor('mid'))
    const base = crossing()
    // Move the far street: the east street's own seed and props stay.
    const changed = {
      ...base,
      chains: { ...base.chains, p: [...base.chains.p.slice(0, -2), 500, 20] },
    }
    const after = decodeStreets(changed, props.seed)
    expect(placeChain(after.chains[0]!, ctxFor('mid'))).toEqual(before)
  })
})

describe('placeJunctions', () => {
  it('gives each junction at most one hydrant and one traffic light, on a corner', () => {
    const always = {
      ...props,
      rules: {
        ...props.rules,
        hydrant: { ...props.rules.hydrant, chance: 1 },
        trafficLight: { ...props.rules.trafficLight, chance: 1 },
      },
    }
    const data = decodeStreets(crossing(), props.seed)
    const placed = placeJunctions(data, ctxFor('mid', { config: always }))
    expect(placed.map((p) => p.model).sort()).toEqual(['hydrant', 'traffic-light'])
    for (const p of placed) {
      // Beyond both streets' curbs: outside the crossing roadways.
      expect(Math.abs(p.x)).toBeGreaterThan(10)
      expect(Math.abs(p.y)).toBeGreaterThan(6)
    }
  })

  it('wideOnly keeps traffic lights to junctions with a wide street', () => {
    const wideOnly = {
      ...props,
      rules: {
        ...props.rules,
        trafficLight: { wideOnly: true, chance: 1, perChunk: props.rules.trafficLight.perChunk },
      },
    }
    const base = crossing()
    const narrow = { ...base, chains: { ...base.chains, e: [0, 0, 0] } }
    const placed = placeJunctions(
      decodeStreets(narrow, props.seed),
      ctxFor('mid', { config: wideOnly }),
    )
    expect(placed.some((p) => p.model === 'traffic-light')).toBe(false)
  })
})

describe('placeWaterTowers', () => {
  const square = (cx: number, cy: number, h: number) => ({
    h,
    rings: [
      [
        { x: cx - 10, y: cy - 10 },
        { x: cx + 10, y: cy - 10 },
        { x: cx + 10, y: cy + 10 },
        { x: cx - 10, y: cy + 10 },
      ],
    ],
  })
  const always = {
    ...props,
    rules: { ...props.rules, waterTower: { ...props.rules.waterTower, chance: 1 } },
  }

  it('stands on the roof of masses of the right height, clear of pins', () => {
    const towers = placeWaterTowers(
      [square(0, 0, 30), square(100, 0, 5), square(200, 0, 90), square(300, 0, 30)],
      ctxFor('mid', { config: always, pins: [{ x: 310, y: 0 }] }),
    )
    expect(towers).toHaveLength(1)
    expect(towers[0]).toMatchObject({
      model: 'water-tower',
      x: 0,
      y: 0,
      lift: 30,
      rule: 'waterTower',
    })
  })
})

describe('chunks', () => {
  const place = (rule: Placement['rule'], model: string, x: number, y: number): Placement => ({
    rule,
    model,
    x,
    y,
    rotation: 0,
    lift: 0,
  })

  it('applyQuotas keeps at most perChunk props of a rule per chunk, the same ones every time', () => {
    const chunks = new Map<string, Chunk>()
    const lights = Array.from({ length: 30 }, (_, i) =>
      place('streetlight', 'streetlight', 10 + i, 10),
    )
    bucket(chunks, lights, props.chunkM)
    const again = new Map<string, Chunk>()
    bucket(again, [...lights].reverse(), props.chunkM)
    applyQuotas(chunks, props, 'mid')
    applyQuotas(again, props, 'mid')
    const kept = [...chunks.values()][0]?.placements ?? []
    expect(kept).toHaveLength(props.rules.streetlight.perChunk.mid)
    expect(new Set(kept)).toEqual(new Set([...again.values()][0]?.placements ?? []))
  })

  it('selectChunks takes the nearest chunks first, within the radius and every cap', () => {
    const chunks = new Map<string, Chunk>()
    for (let i = 0; i < 10; i++) {
      bucket(chunks, [place('tree', 'tree-round', i * props.chunkM + 5, 5)], props.chunkM)
    }
    bucket(chunks, [place('parked', 'taxi', props.chunkM + 10, 10)], props.chunkM)
    const caps = { instancesMax: { 'tree-round': 4, taxi: 0 }, trianglesMax: 1000, drawCallsMax: 3 }
    const picked = selectChunks(chunks.values(), { x: 0, y: 0 }, 5000, caps, () => 100)
    // The second chunk holds a taxi capped at 0: skipped, the next ones taken in order.
    expect(picked.chunks.map((c) => c.key)).toEqual(['0,0', '2,0', '3,0'])
    expect(picked.instances).toEqual({ 'tree-round': 3 })
    expect(picked.triangles).toBe(300)
    const near = selectChunks(chunks.values(), { x: 0, y: 0 }, 150, caps, () => 100)
    expect(near.chunks.map((c) => c.key)).toEqual(['0,0'])
  })
})

describe('fill blocks', () => {
  const place = (rule: Placement['rule'], x: number, y: number): Placement => ({
    rule,
    model: rule === 'waterTower' ? 'water-tower' : 'streetlight',
    x,
    y,
    rotation: 0,
    lift: 0,
  })
  // One 20 m block at (100, 100) turned 45°, one axis-aligned at (300, 100).
  const blocks = {
    sizeM: 20,
    groups: [
      { angleDeg: 45, p: [...encodePath([{ x: 100, y: 100 }])] },
      { angleDeg: 0, p: [...encodePath([{ x: 300, y: 100 }])] },
    ],
  }

  it('finds points inside a turned footprint grown by the margin, and nowhere else', () => {
    const inside = fillBlockLookup(blocks, 1)
    expect(inside({ x: 100, y: 100 })).toBe(true)
    // Along the turned block's axis: 10.9 m out is inside half (10) + margin (1).
    expect(inside({ x: 100 + 10.9 / Math.SQRT2, y: 100 + 10.9 / Math.SQRT2 })).toBe(true)
    expect(inside({ x: 100 + 12 / Math.SQRT2, y: 100 + 12 / Math.SQRT2 })).toBe(false)
    // The corner of an unturned square lies outside the turned one.
    expect(inside({ x: 109, y: 109 })).toBe(false)
    expect(inside({ x: 310.9, y: 110.9 })).toBe(true)
    expect(inside({ x: 312, y: 100 })).toBe(false)
  })

  it('drops street props inside a block, keeps roof water towers and everything outside', () => {
    const kept = outsideFillBlocks(
      [place('streetlight', 100, 100), place('waterTower', 300, 100), place('tree', 0, 0)],
      fillBlockLookup(blocks, props.blockClearM),
    )
    expect(kept.map((p) => p.rule)).toEqual(['waterTower', 'tree'])
    expect(outsideFillBlocks([place('streetlight', 100, 100)], null)).toHaveLength(1)
  })
})

describe('the committed streets and data/config/props.json', () => {
  const file = StreetsFileSchema.parse(read('data/geo/streets.derived.json'))
  const landmarks = (
    read('data/landmarks/landmarks.json') as {
      landmarks: { category: string; location: { lat: number; lng: number } }[]
    }
  ).landmarks
  const venues = (
    read('data/venues/venues.json') as {
      venues: { location: { lat: number; lng: number } }[]
    }
  ).venues
  const homes = Object.values(
    (
      read('data/homes/homes.json') as {
        homes: Record<string, { location: { lat: number; lng: number } }>
      }
    ).homes,
  )
  const pins = [...venues, ...landmarks].map((p) => project(p.location))
  const memorials = landmarks
    .filter((l) => l.category === 'memorial')
    .map((l) => project(l.location))
  const triangles = new Map(
    modelManifest.models.map((m) => [
      m.id,
      { mid: m.tiers.mid.triangles, high: m.tiers.high.triangles },
    ]),
  )
  const geo = read('data/config/geo.json') as { districts: { id: string }[] }

  const built = new Map<PropsTier, ReturnType<typeof buildCity>>()
  const cityChunks = (tier: PropsTier) => {
    const cached = built.get(tier) ?? buildCity(tier)
    built.set(tier, cached)
    return cached
  }

  function buildCity(tier: PropsTier) {
    const data = decodeStreets(file, props.seed)
    const ctx = ctxFor(tier, { pins, clear: data.clear })
    const blocks = BlocksMiniSchema.parse(read(`data/geo/blocks.${tier}.derived.json`))
    const insideBlock = fillBlockLookup(blocks, props.blockClearM)
    const chunks = new Map<string, Chunk>()
    for (const chain of data.chains) {
      bucket(chunks, outsideFillBlocks(placeChain(chain, ctx), insideBlock), props.chunkM)
    }
    bucket(chunks, outsideFillBlocks(placeJunctions(data, ctx), insideBlock), props.chunkM)
    const masses = geo.districts.flatMap((district) => {
      const parsed = DistrictBuildingsMiniSchema.parse(
        read(`data/geo/districts/${district.id}.${tier}.derived.json`),
      )
      const all = districtMasses(parsed)
      return all.slice(0, massesFor(perf.buildingDensity[tier], all.length))
    })
    bucket(chunks, placeWaterTowers(masses, ctx), props.chunkM)
    applyQuotas(chunks, props, tier)
    return { chunks, masses, insideBlock }
  }

  it.each(['mid', 'high'] as const)(
    '%s: no prop within the memorial clearance or a pin, none inside a building',
    (tier) => {
      const { chunks, masses, insideBlock } = cityChunks(tier)
      const all = [...chunks.values()].flatMap((c) => c.placements)
      // None inside a fill block either (roof water towers stand on district masses).
      expect(all.filter((p) => p.rule !== 'waterTower' && insideBlock(p))).toEqual([])
      expect(all.length).toBeGreaterThan(1000)
      for (const p of all) {
        for (const m of memorials) {
          expect(Math.hypot(p.x - m.x, p.y - m.y)).toBeGreaterThanOrEqual(150)
        }
        for (const pin of pins) {
          expect(Math.hypot(p.x - pin.x, p.y - pin.y)).toBeGreaterThanOrEqual(props.pinClearM)
        }
      }
      // Street props stand on sidewalks and in parking lanes, not in buildings (towers stand on
      // roofs on purpose): fewer than 1% fall inside a drawn district footprint.
      // Each mass under every 50 m cell its bounding box touches.
      const grid = new Map<string, typeof masses>()
      for (const mass of masses) {
        const outer = mass.rings[0] ?? []
        const xs = outer.map((q) => q.x)
        const ys = outer.map((q) => q.y)
        for (
          let cx = Math.floor(Math.min(...xs) / 50);
          cx <= Math.floor(Math.max(...xs) / 50);
          cx++
        ) {
          for (
            let cy = Math.floor(Math.min(...ys) / 50);
            cy <= Math.floor(Math.max(...ys) / 50);
            cy++
          ) {
            const key = `${cx},${cy}`
            const list = grid.get(key)
            if (list === undefined) grid.set(key, [mass])
            else list.push(mass)
          }
        }
      }
      const street = all.filter((p) => p.rule !== 'waterTower')
      const inside = street.filter((p) =>
        (grid.get(`${Math.floor(p.x / 50)},${Math.floor(p.y / 50)}`) ?? []).some((mass) =>
          pointInPolygon(p, mass.rings),
        ),
      ).length
      expect(inside / street.length).toBeLessThan(0.01)
    },
    60_000,
  )

  it.each(['mid', 'high'] as const)(
    '%s: around every home and venue, chunks draw within the perf.json streetProps caps',
    (tier) => {
      const { chunks } = cityChunks(tier)
      const budget = perf.streetProps
      const caps = {
        instancesMax: Object.fromEntries(
          STREET_PROP_MODELS.map((m) => [m, budget.instancesMax[m][tier]]),
        ),
        trianglesMax: budget.trianglesMax[tier],
        drawCallsMax: budget.drawCallsMax[tier],
      }
      for (const place of [...homes, ...venues]) {
        const target = project(place.location)
        const picked = selectChunks(
          chunks.values(),
          target,
          props.focusRadiusM[tier],
          caps,
          (model) => triangles.get(model)?.[tier] ?? 0,
        )
        expect(picked.chunks.length).toBeGreaterThan(0)
        expect(picked.chunks.length).toBeLessThanOrEqual(caps.drawCallsMax)
        expect(picked.triangles).toBeLessThanOrEqual(caps.trianglesMax)
        for (const [model, n] of Object.entries(picked.instances)) {
          expect(n).toBeLessThanOrEqual(caps.instancesMax[model] ?? 0)
        }
      }
    },
    60_000,
  )

  it('every cap together stays within the triangle cap, and low draws nothing', () => {
    for (const tier of ['mid', 'high'] as const) {
      const worst = STREET_PROP_MODELS.reduce(
        (sum, m) => sum + perf.streetProps.instancesMax[m][tier] * (triangles.get(m)?.[tier] ?? 0),
        0,
      )
      expect(worst).toBeLessThanOrEqual(perf.streetProps.trianglesMax[tier])
    }
    expect(perf.streetProps.drawCallsMax.low).toBe(0)
  })
})
