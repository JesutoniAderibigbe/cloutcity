/**
 * Street dressing placement (S04i): where every street prop stands, as a pure function of the
 * LION street chains (data/geo/streets.derived.json), the pins and data/config/props.json. No three,
 * no React, no clock: the props layer (src/scene/props/layer.ts) builds meshes from the result.
 *
 * Every chain draws from its own generator, seeded by `props.seed` and the chain's first point,
 * so editing one street never moves a prop on another. Props stand on the sidewalk (the chain's
 * half-width plus `sidewalkOffsetM` from its centreline) or in the parking lane, never within
 * `pinClearM` of a pin, inside a `clear` circle (memorials) or across a junction.
 *
 * Coordinates are local metres (x east, y north); `rotation` is the scene's rotation about +y.
 */
import type { StreetPropsConfig } from '@/lib/data/schemas/scene'
import { decodePath } from '@/lib/geo/codec'
import { interiorPoint, pointInPolygon, polygonCentroid, type Polygon } from '@/lib/geo/polygon'
import type { LocalPoint } from '@/lib/geo/projection'

export type PropsConfig = StreetPropsConfig
export type PropsTier = 'mid' | 'high'

/** Chain flags (scripts/geo/streets.ts STREET_FLAGS). */
export const STREET_FLAGS = { parkLeft: 1, parkRight: 2, wide: 4 } as const

export interface StreetsColumns {
  readonly zones: readonly {
    readonly id: string
    readonly x: number
    readonly y: number
    readonly r: number
  }[]
  readonly clear: readonly { readonly x: number; readonly y: number; readonly r: number }[]
  readonly chains: {
    readonly n: readonly number[]
    readonly p: readonly number[]
    readonly w: readonly number[]
    readonly j: readonly number[]
    readonly e: readonly number[]
  }
}

export interface StreetChain {
  readonly points: readonly LocalPoint[]
  /** Cumulative length at each vertex. */
  readonly along: readonly number[]
  readonly length: number
  readonly halfWidthM: number
  readonly flags: number
  /** Indices into `points` of its junctions. */
  readonly junctions: readonly number[]
  readonly seed: number
}

export interface Circle {
  readonly x: number
  readonly y: number
  readonly r: number
}

export interface StreetsData {
  readonly chains: readonly StreetChain[]
  readonly clear: readonly Circle[]
}

export type PropRule = keyof PropsConfig['rules']

export interface Placement {
  /** The props.json `rules` entry that placed it (its per-chunk quota). */
  readonly rule: PropRule
  readonly model: string
  readonly x: number
  readonly y: number
  readonly rotation: number
  /** Height above the land top (a water tower's roof). */
  readonly lift: number
}

/**
 * A seeded generator for placement only: the same murmur3 finaliser and mulberry32 steps as
 * src/engine/rng.ts (`mixSeed`, `createRng`; streetProps.test.ts holds them equal). It is
 * repeated here because this module ships only in the lazy street props chunk: importing the
 * engine's tiny module from there makes the bundler copy it into every chunk that uses it,
 * the map's start-up islands included.
 */
export function mixSeed(a: number, b: number): number {
  let h = (a ^ Math.imul(b >>> 0, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

export interface Rng {
  /** A number in [0, 1). */
  next(): number
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0
  return {
    next() {
      state = (state + 0x6d2b79f5) >>> 0
      let t = state
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
    },
  }
}

const pointHash = (p: LocalPoint) => mixSeed(Math.round(p.x) | 0, Math.round(p.y) | 0)

/** Decodes the file's columns into chains, each with its own seed. */
export function decodeStreets(file: StreetsColumns, seed: number): StreetsData {
  const all = file.chains.p.length === 0 ? [] : decodePath(file.chains.p)
  const junctions = new Set<number>()
  let at = 0
  for (const delta of file.chains.j) {
    at += delta
    junctions.add(at)
  }
  const chains: StreetChain[] = []
  let start = 0
  file.chains.n.forEach((count, i) => {
    const points = all.slice(start, start + count)
    const along = [0]
    for (let k = 1; k < points.length; k++) {
      const a = points[k - 1]
      const b = points[k]
      along.push((along[k - 1] ?? 0) + (a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0))
    }
    const own: number[] = []
    for (let k = 0; k < count; k++) if (junctions.has(start + k)) own.push(k)
    const first = points[0] ?? { x: 0, y: 0 }
    chains.push({
      points,
      along,
      length: along[along.length - 1] ?? 0,
      halfWidthM: file.chains.w[i] ?? 0,
      flags: file.chains.e[i] ?? 0,
      junctions: own,
      seed: mixSeed(seed, pointHash(first)),
    })
    start += count
  })
  return { chains, clear: file.clear }
}

/** The point and unit direction `s` metres down a chain. */
export function chainAt(chain: StreetChain, s: number): { p: LocalPoint; d: LocalPoint } {
  const { points, along } = chain
  let k = 1
  while (k < points.length - 1 && (along[k] ?? 0) < s) k++
  const a = points[k - 1] ?? { x: 0, y: 0 }
  const b = points[k] ?? a
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const t = Math.min(1, Math.max(0, (s - (along[k - 1] ?? 0)) / length))
  return {
    p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
    d: { x: (b.x - a.x) / length, y: (b.y - a.y) / length },
  }
}

/** Rotation about +y that turns the model's +x axis to (dx, dy). */
const facingX = (d: LocalPoint) => Math.atan2(d.y, d.x)
/** Rotation about +y that turns the model's +z axis (a car's length) to (dx, dy). */
const facingZ = (d: LocalPoint) => Math.atan2(d.x, -d.y)

export interface PlacementContext {
  readonly tier: PropsTier
  readonly config: PropsConfig
  /** Pin ground points (local metres). */
  readonly pins: readonly LocalPoint[]
  readonly clear: readonly Circle[]
}

function blocked(ctx: PlacementContext, p: LocalPoint, pinClearM = ctx.config.pinClearM): boolean {
  for (const pin of ctx.pins) if (Math.hypot(p.x - pin.x, p.y - pin.y) < pinClearM) return true
  for (const c of ctx.clear) if (Math.hypot(p.x - c.x, p.y - c.y) < c.r) return true
  return false
}

/** True when `s` lies within the clearance of one of the chain's junctions. */
function nearJunction(chain: StreetChain, s: number, clearM: number): boolean {
  for (const k of chain.junctions) if (Math.abs((chain.along[k] ?? 0) - s) < clearM) return true
  // Chain ends are corners too (a street that stops at a cross street).
  return s < clearM || chain.length - s < clearM
}

const pickOf = (rng: Rng, items: readonly string[]) =>
  items[Math.min(items.length - 1, Math.floor(rng.next() * items.length))] ?? ''

/**
 * Streetlights, trees, benches and parked cars along one chain. The generator draws the same
 * numbers whatever is skipped, so a pin added near one end never shifts props at the other.
 */
export function placeChain(chain: StreetChain, ctx: PlacementContext): Placement[] {
  const { config, tier } = ctx
  const rules = config.rules
  const out: Placement[] = []
  const curb = chain.halfWidthM + config.sidewalkOffsetM
  const clearM = chain.halfWidthM + config.junctionClearM
  const add = (
    rule: PropRule,
    model: string,
    p: LocalPoint,
    rotation: number,
    s: number,
    clear = clearM,
  ) => {
    if (nearJunction(chain, s, clear) || blocked(ctx, p)) return
    out.push({ rule, model, x: p.x, y: p.y, rotation, lift: 0 })
  }
  const side = (p: LocalPoint, d: LocalPoint, sign: number, offset: number): LocalPoint => ({
    // Left of the direction of travel is (-dy, dx).
    x: p.x - d.y * offset * sign,
    y: p.y + d.x * offset * sign,
  })

  // Streetlights: evenly spaced, alternating sides, arms reaching over the street.
  const lights = createRng(mixSeed(chain.seed, 1))
  const lightSpacing = rules.streetlight.spacingM[tier]
  const lightPhase = lights.next() * lightSpacing
  for (let k = 0, s = lightPhase; s < chain.length; k++, s += lightSpacing) {
    const sign = rules.streetlight.alternate && k % 2 === 1 ? -1 : 1
    const { p, d } = chainAt(chain, s)
    // The arm (model +x) points from the sidewalk back over the street.
    add(
      'streetlight',
      'streetlight',
      side(p, d, sign, curb),
      facingX({ x: d.y * sign, y: -d.x * sign }),
      s,
    )
  }

  // Trees: both sides, half a spacing off the lights' rhythm, each by chance.
  const trees = createRng(mixSeed(chain.seed, 2))
  const treeSpacing = rules.tree.spacingM[tier]
  const treePhase = trees.next() * treeSpacing
  for (let s = treePhase; s < chain.length; s += treeSpacing) {
    for (const sign of [1, -1]) {
      const roll = trees.next()
      const model = pickOf(trees, rules.tree.models)
      const turn = trees.next() * Math.PI * 2
      if (roll >= rules.tree.chance) continue
      const { p, d } = chainAt(chain, s)
      add('tree', model, side(p, d, sign, curb), turn, s)
    }
  }

  // Benches: on park edges, and near places (on the side facing the place).
  const benches = createRng(mixSeed(chain.seed, 3))
  const benchSpacing = rules.bench.spacingM
  const benchPhase = benches.next() * benchSpacing
  for (let s = benchPhase; s < chain.length; s += benchSpacing) {
    const { p, d } = chainAt(chain, s)
    const signs: number[] = []
    if (rules.bench.parkEdges) {
      if (chain.flags & STREET_FLAGS.parkLeft) signs.push(1)
      if (chain.flags & STREET_FLAGS.parkRight) signs.push(-1)
    }
    if (signs.length === 0) {
      const pin = ctx.pins.find((q) => Math.hypot(q.x - p.x, q.y - p.y) <= rules.bench.nearPlacesM)
      if (pin !== undefined) {
        const leftward = -d.y * (pin.x - p.x) + d.x * (pin.y - p.y)
        signs.push(leftward >= 0 ? 1 : -1)
      }
    }
    for (const sign of signs) {
      const along = sign === 1 ? d : { x: -d.x, y: -d.y }
      add('bench', 'bench', side(p, d, sign, curb), facingX(along), s)
    }
  }

  // Parked cars: parking-lane slots on both sides, each taken by chance, facing the traffic
  // flow of its side (right-hand traffic).
  const cars = createRng(mixSeed(chain.seed, 4))
  const lane = Math.max(0, chain.halfWidthM - config.parkingOffsetM)
  const parkedModels = rules.parked.models[tier]
  const others = parkedModels.filter((model) => model !== 'taxi')
  const carClear = clearM + rules.parked.slotM
  for (let s = rules.parked.slotM / 2; s < chain.length; s += rules.parked.slotM) {
    for (const sign of [1, -1]) {
      const roll = cars.next()
      const taxi = cars.next() < rules.parked.taxiShare && parkedModels.includes('taxi')
      const model = taxi || others.length === 0 ? 'taxi' : pickOf(cars, others)
      if (roll >= rules.parked.chance[tier] || lane === 0) continue
      const { p, d } = chainAt(chain, s)
      const flow = sign === -1 ? d : { x: -d.x, y: -d.y }
      add('parked', model, side(p, d, sign, lane), facingZ(flow), s, carClear)
    }
  }
  return out
}

/**
 * Hydrants and traffic lights at junctions, once per junction: the junction's first two chains
 * (in file order) give the corner, beyond each street's half-width and onto the sidewalk.
 */
export function placeJunctions(data: StreetsData, ctx: PlacementContext): Placement[] {
  const { config } = ctx
  const rules = config.rules
  const meet = new Map<string, { chain: StreetChain; k: number }[]>()
  for (const chain of data.chains) {
    for (const k of chain.junctions) {
      const p = chain.points[k]
      if (p === undefined) continue
      const key = `${p.x},${p.y}`
      const list = meet.get(key)
      if (list === undefined) meet.set(key, [{ chain, k }])
      else list.push({ chain, k })
    }
  }
  const out: Placement[] = []
  for (const list of meet.values()) {
    const first = list[0]
    if (first === undefined) continue
    const second = list.find((entry) => entry.chain !== first.chain) ?? first
    const at = first.chain.points[first.k] ?? { x: 0, y: 0 }
    const rng = createRng(mixSeed(config.seed, pointHash(at)))
    const d1 = chainAt(first.chain, first.chain.along[first.k] ?? 0).d
    const d2raw = chainAt(second.chain, second.chain.along[second.k] ?? 0).d
    // The cross street's direction; a lone chain end uses its own normal.
    const d2 = second === first ? { x: -d1.y, y: d1.x } : d2raw
    const corner = (s1: number, s2: number): LocalPoint => {
      const a = (second.chain.halfWidthM + config.sidewalkOffsetM) * s1
      const b = (first.chain.halfWidthM + config.sidewalkOffsetM) * s2
      return { x: at.x + d1.x * a + d2.x * b, y: at.y + d1.y * a + d2.y * b }
    }
    const sign = () => (rng.next() < 0.5 ? -1 : 1)
    const hydrantRoll = rng.next()
    const hydrantCorner = corner(sign(), sign())
    const hydrantTurn = rng.next() * Math.PI * 2
    const lightRoll = rng.next()
    const lightS1 = sign()
    const lightS2 = sign()
    if (hydrantRoll < rules.hydrant.chance && !blocked(ctx, hydrantCorner)) {
      out.push({
        rule: 'hydrant',
        model: 'hydrant',
        x: hydrantCorner.x,
        y: hydrantCorner.y,
        rotation: hydrantTurn,
        lift: 0,
      })
    }
    const wide = list.some((entry) => entry.chain.flags & STREET_FLAGS.wide)
    if (lightRoll < rules.trafficLight.chance && (!rules.trafficLight.wideOnly || wide)) {
      const p = corner(lightS1, lightS2)
      if (!blocked(ctx, p)) {
        // Its heads (model +x) face into the junction.
        out.push({
          rule: 'trafficLight',
          model: 'traffic-light',
          x: p.x,
          y: p.y,
          rotation: facingX({ x: at.x - p.x, y: at.y - p.y }),
          lift: 0,
        })
      }
    }
  }
  return out
}

/** A district mass that may carry a water tower: its height and footprint rings. */
export interface TowerCandidate {
  readonly h: number
  readonly rings: Polygon
}

/** Roof water towers on drawn district masses of the right height, by chance per mass. */
export function placeWaterTowers(
  candidates: readonly TowerCandidate[],
  ctx: PlacementContext,
): Placement[] {
  const rule = ctx.config.rules.waterTower
  const out: Placement[] = []
  for (const mass of candidates) {
    if (mass.h < rule.minHeightM || mass.h > rule.maxHeightM) continue
    const outer = mass.rings[0]
    if (outer === undefined || outer.length < 3) continue
    const centroid = polygonCentroid(mass.rings)
    const roof = pointInPolygon(centroid, mass.rings) ? centroid : interiorPoint(mass.rings)
    const rng = createRng(mixSeed(ctx.config.seed, pointHash(roof) ^ mass.h))
    const roll = rng.next()
    const turn = rng.next() * Math.PI * 2
    if (roll >= rule.chance || blocked(ctx, roof, rule.pinClearM)) continue
    out.push({
      rule: 'waterTower',
      model: 'water-tower',
      x: roof.x,
      y: roof.y,
      rotation: turn,
      lift: mass.h,
    })
  }
  return out
}

/** The procedural blocks of a tier, as data/geo/blocks.<tier>.derived.json holds them. */
export interface FillBlocks {
  /** Side of every block's square footprint (its plate and lots stay inside it), metres. */
  readonly sizeM: number
  readonly groups: readonly {
    /** Degrees counter-clockwise from east. */
    readonly angleDeg: number
    /** Block centres, one delta-encoded path. */
    readonly p: readonly number[]
  }[]
}

const BLOCK_CELL_M = 100

/**
 * A lookup of whether a point stands inside a fill block's footprint grown by `marginM`: each
 * block sits under every grid cell its bounding circle touches, and a point is tested only
 * against the blocks of its own cell. Pure: the same blocks always answer the same.
 */
export function fillBlockLookup(
  blocks: FillBlocks,
  marginM: number,
): (point: LocalPoint) => boolean {
  const half = blocks.sizeM / 2 + marginM
  const reach = half * Math.SQRT2
  const grid = new Map<string, { x: number; y: number; cos: number; sin: number }[]>()
  for (const group of blocks.groups) {
    const angle = (group.angleDeg * Math.PI) / 180
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    for (const centre of decodePath(group.p)) {
      const block = { x: centre.x, y: centre.y, cos, sin }
      const minX = Math.floor((centre.x - reach) / BLOCK_CELL_M)
      const maxX = Math.floor((centre.x + reach) / BLOCK_CELL_M)
      const minY = Math.floor((centre.y - reach) / BLOCK_CELL_M)
      const maxY = Math.floor((centre.y + reach) / BLOCK_CELL_M)
      for (let cx = minX; cx <= maxX; cx++) {
        for (let cy = minY; cy <= maxY; cy++) {
          const key = `${cx},${cy}`
          const list = grid.get(key)
          if (list === undefined) grid.set(key, [block])
          else list.push(block)
        }
      }
    }
  }
  return (point) => {
    const key = `${Math.floor(point.x / BLOCK_CELL_M)},${Math.floor(point.y / BLOCK_CELL_M)}`
    for (const b of grid.get(key) ?? []) {
      const dx = point.x - b.x
      const dy = point.y - b.y
      const u = dx * b.cos + dy * b.sin
      const v = -dx * b.sin + dy * b.cos
      if (Math.abs(u) <= half && Math.abs(v) <= half) return true
    }
    return false
  }
}

/** Placements outside every fill block; roof water towers stand on buildings and are kept. */
export function outsideFillBlocks(
  placements: readonly Placement[],
  insideBlock: ((point: LocalPoint) => boolean) | null,
): Placement[] {
  if (insideBlock === null) return [...placements]
  return placements.filter((p) => p.rule === 'waterTower' || !insideBlock(p))
}

export interface Chunk {
  readonly key: string
  /** Chunk centre, local metres. */
  readonly x: number
  readonly y: number
  readonly placements: Placement[]
}

export const chunkKey = (x: number, y: number, chunkM: number) =>
  `${Math.floor(x / chunkM)},${Math.floor(y / chunkM)}`

/** Adds placements to their `chunkM` squares. */
export function bucket(
  chunks: Map<string, Chunk>,
  placements: readonly Placement[],
  chunkM: number,
) {
  for (const placement of placements) {
    const cx = Math.floor(placement.x / chunkM)
    const cy = Math.floor(placement.y / chunkM)
    const key = `${cx},${cy}`
    let chunk = chunks.get(key)
    if (chunk === undefined) {
      chunk = { key, x: (cx + 0.5) * chunkM, y: (cy + 0.5) * chunkM, placements: [] }
      chunks.set(key, chunk)
    }
    chunk.placements.push(placement)
  }
}

/**
 * Trims every chunk to each rule's `perChunk` quota, keeping the props ranked first by a hash
 * of their position: which props survive never depends on the order they were placed in.
 */
export function applyQuotas(chunks: Map<string, Chunk>, config: PropsConfig, tier: PropsTier) {
  for (const chunk of chunks.values()) {
    const byRule = new Map<PropRule, { placement: Placement; rank: number }[]>()
    for (const placement of chunk.placements) {
      const list = byRule.get(placement.rule) ?? []
      list.push({ placement, rank: pointHash({ x: placement.x * 10, y: placement.y * 10 }) })
      byRule.set(placement.rule, list)
    }
    const kept: Placement[] = []
    for (const [rule, list] of byRule) {
      list.sort(
        (a, b) => a.rank - b.rank || a.placement.x - b.placement.x || a.placement.y - b.placement.y,
      )
      const quota = config.rules[rule].perChunk[tier]
      for (const entry of list.slice(0, quota)) kept.push(entry.placement)
    }
    chunk.placements.length = 0
    chunk.placements.push(...kept)
  }
}

export interface ChunkCaps {
  /** Instances per model id. A model without a cap is never drawn. */
  readonly instancesMax: Readonly<Record<string, number>>
  readonly trianglesMax: number
  readonly drawCallsMax: number
}

export interface Selection {
  /** Nearest the target first. */
  readonly chunks: readonly Chunk[]
  readonly instances: Readonly<Record<string, number>>
  readonly triangles: number
}

/** Instances per model in a chunk. */
export function chunkCounts(chunk: Chunk): Map<string, number> {
  const counts = new Map<string, number>()
  for (const { model } of chunk.placements) counts.set(model, (counts.get(model) ?? 0) + 1)
  return counts
}

/**
 * The chunks to draw: nearest the camera target first, within `radiusM`, each taken only while
 * every model's instance cap, the triangle cap and the draw-call cap (one per chunk) still hold.
 */
export function selectChunks(
  chunks: Iterable<Chunk>,
  target: LocalPoint,
  radiusM: number,
  caps: ChunkCaps,
  trianglesOf: (model: string) => number,
): Selection {
  const candidates = [...chunks]
    .map((chunk) => ({ chunk, distance: Math.hypot(chunk.x - target.x, chunk.y - target.y) }))
    .filter((entry) => entry.distance <= radiusM)
    .sort((a, b) => a.distance - b.distance || (a.chunk.key < b.chunk.key ? -1 : 1))
  const instances: Record<string, number> = {}
  const picked: Chunk[] = []
  let triangles = 0
  for (const { chunk } of candidates) {
    if (picked.length >= caps.drawCallsMax) break
    const counts = chunkCounts(chunk)
    let extra = 0
    let fits = true
    for (const [model, n] of counts) {
      if ((instances[model] ?? 0) + n > (caps.instancesMax[model] ?? 0)) fits = false
      extra += n * trianglesOf(model)
    }
    if (!fits || triangles + extra > caps.trianglesMax) continue
    for (const [model, n] of counts) instances[model] = (instances[model] ?? 0) + n
    triangles += extra
    picked.push(chunk)
  }
  return { chunks: picked, instances, triangles }
}
