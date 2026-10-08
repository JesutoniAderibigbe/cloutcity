/**
 * The street chains street props stand on (S04i): `geo/streets.derived.json`, one file for every
 * tier that draws props (never fetched on low). Built from the paged LION downloads of each prop
 * zone (the building districts plus geo.json `streets.zones`):
 *
 * 1. Segments are de-duplicated by `SegmentID` (zones overlap) and kept when their midpoint lies
 *    in a prop zone circle.
 * 2. Street parts near a memorial (`lookOnlyClearM`) or on a landmark's ground (its exclusion
 *    rectangle grown by `exclusionMarginM`) are cut away, each clearance grown by the street's
 *    half-width plus `reachM`, so no prop placed beside the street can reach into it.
 * 3. Segments are joined into chains by street name, width and continuity, through every node
 *    where only that street continues; junctions (nodes where three or more segment ends meet)
 *    are kept as vertices, and the rest is simplified with Douglas-Peucker.
 *
 * Pure: inputs in, file text out, no clock or randomness. The props themselves are placed on the
 * client from these chains (src/lib/world/streetProps.ts), seeded per chain.
 */
import { z } from 'zod'
import type { QualityTier, StreetsGeoConfig } from '../../src/lib/data/schemas/config.ts'
import { decodePath, encodePath } from '../../src/lib/geo/codec.ts'
import { areaAt, prepareAreas, type EncodedArea } from '../../src/lib/geo/lookup.ts'
import {
  ORIGIN,
  PROJECTION_ID,
  distanceM,
  project,
  type LocalPoint,
} from '../../src/lib/geo/projection.ts'
import { douglasPeucker } from '../../src/lib/geo/simplify.ts'
import { streetSourceId, type StreetSourceId } from '../../src/lib/geo/streetSources.ts'
import { BLOCK_TRIANGLES, type BlockGroup, type TierBlocks } from './blocks.ts'
import { insideExclusion, type LandmarkExclusion } from './landmark-exclusions.ts'
import type { StreetZoneCircle } from './lock.ts'

export const STREETS_NOTICE =
  'Street chains derived from NYC Department of City Planning LION street centerlines; not the original data.'

export const STREETS_FORMAT = 'cc-streets-v1'

/** Chain flags (`chains.e`). */
export const STREET_FLAGS = { parkLeft: 1, parkRight: 2, wide: 4 } as const

const FEET = 0.3048
/** Cut resolution: a street is tested against the clearances every this many metres. */
const CUT_STEP_M = 4
/** Chains shorter than this after cutting carry no props and are dropped. */
const MIN_CHAIN_M = 12

// ---- raw input --------------------------------------------------------------------------

const Position = z.array(z.number()).min(2)
const StreetFeatureSchema = z.object({
  type: z.literal('Feature'),
  geometry: z.discriminatedUnion('type', [
    z.object({ type: z.literal('LineString'), coordinates: z.array(Position).min(2) }),
    z.object({
      type: z.literal('MultiLineString'),
      coordinates: z.array(z.array(Position).min(2)).min(1),
    }),
  ]),
  properties: z.object({
    SegmentID: z.string().regex(/^\d{7}$/),
    Street: z.string().min(1),
    StreetWidth_Min: z.number().nonnegative().nullable(),
  }),
})
const StreetPageSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(StreetFeatureSchema),
})

export interface StreetSegment {
  readonly segmentId: string
  readonly street: string
  /** Curb-to-curb width in feet, or null when LION has none. */
  readonly widthFt: number | null
  /** Local metres, unrounded. */
  readonly points: readonly LocalPoint[]
}

/** One zone's pages as segments; the pages must hold exactly `expectedCount` features. */
export function readStreetSegments(
  sourceId: string,
  pages: readonly unknown[],
  expectedCount: number,
): StreetSegment[] {
  const segments: StreetSegment[] = []
  let features = 0
  for (const [index, page] of pages.entries()) {
    const result = StreetPageSchema.safeParse(page)
    if (!result.success) {
      throw new Error(`Invalid ${sourceId} page ${index}:\n${z.prettifyError(result.error)}`)
    }
    for (const feature of result.data.features) {
      features++
      const lines =
        feature.geometry.type === 'LineString'
          ? [feature.geometry.coordinates]
          : feature.geometry.coordinates
      for (const line of lines) {
        segments.push({
          segmentId: feature.properties.SegmentID,
          street: feature.properties.Street.trim(),
          widthFt: feature.properties.StreetWidth_Min,
          points: line.map(([lng = 0, lat = 0]) => project({ lat, lng })),
        })
      }
    }
  }
  if (features !== expectedCount) {
    throw new Error(
      `${sourceId}: pages hold ${features} features, the lock counts ${expectedCount}`,
    )
  }
  return segments
}

// ---- geometry helpers --------------------------------------------------------------------

const nodeKey = (point: LocalPoint) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`

function pathLength(points: readonly LocalPoint[]): number {
  let length = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (a !== undefined && b !== undefined) length += distanceM(a, b)
  }
  return length
}

/** The point and unit direction at `along` metres down a path. */
export function pointAlong(
  points: readonly LocalPoint[],
  along: number,
): { point: LocalPoint; dir: LocalPoint } {
  let left = along
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (a === undefined || b === undefined) continue
    const length = distanceM(a, b)
    if (length === 0) continue
    if (left <= length || i === points.length - 1) {
      const t = Math.min(1, Math.max(0, left / length))
      return {
        point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        dir: { x: (b.x - a.x) / length, y: (b.y - a.y) / length },
      }
    }
    left -= length
  }
  const only = points[0] ?? { x: 0, y: 0 }
  return { point: only, dir: { x: 1, y: 0 } }
}

/**
 * The parts of a path outside every clearance: the path is walked in steps of at most
 * CUT_STEP_M and split wherever a step lands inside one. Original vertices are kept.
 */
export function cutPath(
  points: readonly LocalPoint[],
  blocked: (point: LocalPoint) => boolean,
): LocalPoint[][] {
  const pieces: LocalPoint[][] = []
  let current: LocalPoint[] = []
  const visit = (point: LocalPoint) => {
    if (blocked(point)) {
      if (current.length >= 2) pieces.push(current)
      current = []
    } else {
      current.push(point)
    }
  }
  const first = points[0]
  if (first === undefined) return []
  visit(first)
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (a === undefined || b === undefined) continue
    const steps = Math.max(1, Math.ceil(distanceM(a, b) / CUT_STEP_M))
    for (let s = 1; s <= steps; s++) {
      const t = s / steps
      visit(s === steps ? b : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    }
  }
  if (current.length >= 2) pieces.push(current)
  return pieces
}

// ---- the build ---------------------------------------------------------------------------

export interface StreetsInputs {
  /** Every prop zone, districts first (lock.ts streetZoneCircles). */
  readonly zones: readonly StreetZoneCircle[]
  /** Segments per zone, in zone order. */
  readonly segments: ReadonlyMap<StreetSourceId, readonly StreetSegment[]>
  /** Landmark grounds (frames.derived.json `landmarks[].exclusion`). */
  readonly exclusions: readonly LandmarkExclusion[]
  /** Memorial locations (landmarks.json category `memorial`), local metres. */
  readonly memorials: readonly LocalPoint[]
  /** Parks and cemeteries (geo/parks.derived.json), for the park-edge flags. */
  readonly parks: readonly EncodedArea[]
}

export interface StreetChain {
  readonly street: string
  /** Integer local metres. */
  readonly points: readonly LocalPoint[]
  /** Indices into `points` of junction vertices. */
  readonly junctions: readonly number[]
  /** Half the curb-to-curb width, metres, to 0.5 m. */
  readonly halfWidthM: number
  readonly flags: number
}

export interface StreetsResult {
  readonly zones: readonly { id: string; x: number; y: number; r: number }[]
  readonly clear: readonly { x: number; y: number; r: number }[]
  readonly chains: readonly StreetChain[]
  readonly sources: readonly StreetSourceId[]
  readonly stats: {
    readonly segments: number
    readonly duplicates: number
    readonly outsideZones: number
    /** Segments that lost at least part of their length to a clearance. */
    readonly cut: number
    readonly chains: number
    readonly vertices: number
  }
}

interface Piece {
  readonly street: string
  readonly halfWidthM: number
  readonly widthFt: number
  readonly points: LocalPoint[]
  readonly order: number
}

/** Half the curb-to-curb width, to 0.5 m. */
const halfWidth = (widthFt: number) => Math.round(widthFt * FEET) / 2

/** Joins pieces of one street into chains through nodes where only that street continues. */
function joinPieces(pieces: readonly Piece[]): LocalPoint[][] {
  const ends = new Map<string, number[]>()
  const add = (key: string, index: number) => {
    const list = ends.get(key)
    if (list === undefined) ends.set(key, [index])
    else list.push(index)
  }
  pieces.forEach((piece, index) => {
    const first = piece.points[0]
    const last = piece.points[piece.points.length - 1]
    if (first === undefined || last === undefined) return
    add(nodeKey(first), index)
    add(nodeKey(last), index)
  })
  const used = new Set<number>()
  // The one unused piece continuing the street at `at`, if exactly two ends meet there (a fork,
  // a dead end or a loop ends the chain).
  const continuation = (at: LocalPoint): number | undefined => {
    const list = ends.get(nodeKey(at)) ?? []
    const free = list.filter((i) => !used.has(i))
    return list.length === 2 && free.length === 1 ? free[0] : undefined
  }
  const from = (index: number, start: LocalPoint): LocalPoint[] => {
    const points = pieces[index]?.points ?? []
    const first = points[0]
    return first !== undefined && nodeKey(first) === nodeKey(start)
      ? [...points]
      : [...points].reverse()
  }
  const chains: LocalPoint[][] = []
  for (const [index, piece] of pieces.entries()) {
    if (used.has(index)) continue
    used.add(index)
    let chain = [...piece.points]
    for (let tail = chain[chain.length - 1]; tail !== undefined; tail = chain[chain.length - 1]) {
      const step = continuation(tail)
      if (step === undefined) break
      used.add(step)
      chain = [...chain, ...from(step, tail).slice(1)]
    }
    for (let head = chain[0]; head !== undefined; head = chain[0]) {
      const step = continuation(head)
      if (step === undefined) break
      used.add(step)
      chain = [...from(step, head).reverse().slice(0, -1), ...chain]
    }
    chains.push(chain)
  }
  return chains
}

/**
 * Simplifies a chain with Douglas-Peucker between its junctions (which always stay), then
 * rounds it to whole metres, dropping vertices that rounding repeats. `isJunction` is asked
 * about the unrounded LION nodes only.
 */
export function simplifyChain(
  points: readonly LocalPoint[],
  isJunction: (point: LocalPoint) => boolean,
  toleranceM: number,
): { points: LocalPoint[]; junctions: number[] } {
  const breaks = [0]
  for (let i = 1; i < points.length - 1; i++) {
    const point = points[i]
    if (point !== undefined && isJunction(point)) breaks.push(i)
  }
  breaks.push(points.length - 1)
  const kept: { point: LocalPoint; junction: boolean }[] = []
  for (let b = 1; b < breaks.length; b++) {
    const run = douglasPeucker(points.slice(breaks[b - 1] ?? 0, (breaks[b] ?? 0) + 1), toleranceM)
    for (const [k, point] of run.entries()) {
      if (b > 1 && k === 0) continue
      const end = k === run.length - 1 || k === 0
      kept.push({ point, junction: end && isJunction(point) })
    }
  }
  const out: LocalPoint[] = []
  const junctions = new Set<number>()
  for (const { point, junction } of kept) {
    const rounded = { x: Math.round(point.x), y: Math.round(point.y) }
    const last = out[out.length - 1]
    if (last === undefined || last.x !== rounded.x || last.y !== rounded.y) out.push(rounded)
    if (junction) junctions.add(out.length - 1)
  }
  return { points: out, junctions: [...junctions].sort((a, b) => a - b) }
}

function parkFlags(
  points: readonly LocalPoint[],
  halfWidthM: number,
  probeM: number,
  parks: ReturnType<typeof prepareAreas>,
): number {
  const { point, dir } = pointAlong(points, pathLength(points) / 2)
  const reach = halfWidthM + probeM
  // Left of the direction of travel is (-dy, dx) with y north.
  const left = { x: point.x - dir.y * reach, y: point.y + dir.x * reach }
  const right = { x: point.x + dir.y * reach, y: point.y - dir.x * reach }
  return (
    (areaAt(left, parks) === undefined ? 0 : STREET_FLAGS.parkLeft) |
    (areaAt(right, parks) === undefined ? 0 : STREET_FLAGS.parkRight)
  )
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export function buildStreets(inputs: StreetsInputs, config: StreetsGeoConfig): StreetsResult {
  const zones = inputs.zones.map((zone) => {
    const centre = project(zone.center)
    return { id: zone.id, x: Math.round(centre.x), y: Math.round(centre.y), r: zone.radiusM }
  })
  const inZone = (point: LocalPoint) =>
    zones.some((zone) => Math.hypot(point.x - zone.x, point.y - zone.y) <= zone.r)
  const sources = inputs.zones.map((zone) => streetSourceId(zone.id))

  // 1. Every segment once, inside the zones.
  const seen = new Set<string>()
  const kept: StreetSegment[] = []
  let total = 0
  let duplicates = 0
  let outsideZones = 0
  for (const source of sources) {
    for (const segment of inputs.segments.get(source) ?? []) {
      total++
      if (seen.has(segment.segmentId)) {
        duplicates++
        continue
      }
      seen.add(segment.segmentId)
      if (!inZone(pointAlong(segment.points, pathLength(segment.points) / 2).point)) {
        outsideZones++
        continue
      }
      kept.push(segment)
    }
  }
  kept.sort((a, b) => byString(a.segmentId, b.segmentId))

  // Junctions: nodes where three or more segment ends meet, whatever their street.
  const degree = new Map<string, number>()
  for (const segment of kept) {
    for (const end of [segment.points[0], segment.points[segment.points.length - 1]]) {
      if (end === undefined) continue
      const key = nodeKey(end)
      degree.set(key, (degree.get(key) ?? 0) + 1)
    }
  }
  const isJunction = (point: LocalPoint) => (degree.get(nodeKey(point)) ?? 0) >= 3

  // 2. Clearances, grown by each street's half-width plus the props' reach.
  let cut = 0
  const pieces: Piece[] = []
  for (const [order, segment] of kept.entries()) {
    const widthFt =
      segment.widthFt === null || segment.widthFt === 0 ? config.defaultWidthFt : segment.widthFt
    const halfWidthM = halfWidth(widthFt)
    const grow = halfWidthM + config.reachM
    const memorialR = config.lookOnlyClearM + grow
    const rects = inputs.exclusions.map((rect) => ({
      ...rect,
      halfLengthM: rect.halfLengthM + config.exclusionMarginM + grow,
      halfWidthM: rect.halfWidthM + config.exclusionMarginM + grow,
    }))
    let lost = false
    const blocked = (point: LocalPoint) => {
      const inside =
        inputs.memorials.some((m) => distanceM(point, m) <= memorialR) ||
        rects.some((rect) => insideExclusion(point, rect))
      if (inside) lost = true
      return inside
    }
    const parts = cutPath(segment.points, blocked)
    if (lost) cut++
    for (const points of parts) {
      pieces.push({ street: segment.street, halfWidthM, widthFt, points, order })
    }
  }

  // 3. Chains per street and width.
  const groups = new Map<string, Piece[]>()
  for (const piece of pieces) {
    const key = `${piece.street}|${piece.halfWidthM}|${piece.widthFt >= config.wideMinFt}`
    const list = groups.get(key)
    if (list === undefined) groups.set(key, [piece])
    else list.push(piece)
  }
  const parks = prepareAreas(inputs.parks)
  const chains: StreetChain[] = []
  for (const key of [...groups.keys()].sort(byString)) {
    const group = groups.get(key) ?? []
    const first = group[0]
    if (first === undefined) continue
    for (const raw of joinPieces(group)) {
      // Junctions are tested on the unrounded LION nodes, before simplification moves anything.
      const simplified = simplifyChain(raw, isJunction, config.simplifyM)
      if (simplified.points.length < 2 || pathLength(simplified.points) < MIN_CHAIN_M) continue
      chains.push({
        street: first.street,
        points: simplified.points,
        junctions: simplified.junctions,
        halfWidthM: first.halfWidthM,
        flags:
          parkFlags(simplified.points, first.halfWidthM, config.parkProbeM, parks) |
          (first.widthFt >= config.wideMinFt ? STREET_FLAGS.wide : 0),
      })
    }
  }
  chains.sort(
    (a, b) =>
      byString(a.street, b.street) ||
      (a.points[0]?.x ?? 0) - (b.points[0]?.x ?? 0) ||
      (a.points[0]?.y ?? 0) - (b.points[0]?.y ?? 0),
  )

  return {
    zones,
    clear: inputs.memorials.map((m) => ({
      x: Math.round(m.x),
      y: Math.round(m.y),
      r: config.lookOnlyClearM,
    })),
    chains,
    sources,
    stats: {
      segments: total,
      duplicates,
      outsideZones,
      cut,
      chains: chains.length,
      vertices: chains.reduce((sum, chain) => sum + chain.points.length, 0),
    },
  }
}

/** Delta-encodes ascending integers: [first, gap, gap, ...]. */
export function encodeIndices(values: readonly number[]): number[] {
  return values.map((value, i) => value - (i === 0 ? 0 : (values[i - 1] ?? 0)))
}

export function decodeIndices(deltas: readonly number[]): number[] {
  const out: number[] = []
  let at = 0
  for (const delta of deltas) {
    at += delta
    out.push(at)
  }
  return out
}

/** The text of `geo/streets.derived.json`. */
export function streetsFileText(result: StreetsResult): string {
  const all: LocalPoint[] = []
  const junctions: number[] = []
  for (const chain of result.chains) {
    for (const index of chain.junctions) junctions.push(all.length + index)
    all.push(...chain.points)
  }
  return `${JSON.stringify({
    format: STREETS_FORMAT,
    derived: true,
    notice: STREETS_NOTICE,
    sources: result.sources,
    projection: { id: PROJECTION_ID, originLat: ORIGIN.lat, originLng: ORIGIN.lng },
    zones: result.zones,
    clear: result.clear,
    chains: {
      n: result.chains.map((chain) => chain.points.length),
      p: all.length === 0 ? [] : encodePath(all),
      w: result.chains.map((chain) => chain.halfWidthM),
      j: encodeIndices(junctions),
      e: result.chains.map((chain) => chain.flags),
    },
  })}\n`
}

/** Chains back from the file's columns (tests and the carving step). */
export function decodeChains(chains: {
  readonly n: readonly number[]
  readonly p: readonly number[]
  readonly w: readonly number[]
}): { points: LocalPoint[]; halfWidthM: number }[] {
  const all = chains.p.length === 0 ? [] : decodePath(chains.p)
  let at = 0
  return chains.n.map((count, i) => {
    const points = all.slice(at, at + count)
    at += count
    return { points, halfWidthM: chains.w[i] ?? 0 }
  })
}

// ---- carving the fill blocks (D9) ----------------------------------------------------------

/**
 * Distance between segment ab and an axis-aligned square of half side `half` centred on the
 * origin (0 when they touch).
 */
export function segmentSquareDistance(a: LocalPoint, b: LocalPoint, half: number): number {
  // Liang-Barsky: does the segment enter the square at all?
  let t0 = 0
  let t1 = 1
  const dx = b.x - a.x
  const dy = b.y - a.y
  const clips: [number, number][] = [
    [-dx, a.x + half],
    [dx, half - a.x],
    [-dy, a.y + half],
    [dy, half - a.y],
  ]
  let hits = true
  for (const [p, q] of clips) {
    if (p === 0) {
      if (q < 0) hits = false
      continue
    }
    const t = q / p
    if (p < 0) t0 = Math.max(t0, t)
    else t1 = Math.min(t1, t)
  }
  if (hits && t0 <= t1) return 0
  const toBox = (p: LocalPoint) =>
    Math.hypot(Math.max(0, Math.abs(p.x) - half), Math.max(0, Math.abs(p.y) - half))
  const corners = [
    { x: -half, y: -half },
    { x: half, y: -half },
    { x: half, y: half },
    { x: -half, y: half },
  ]
  const toSegment = (p: LocalPoint) => {
    const lengthSq = dx * dx + dy * dy
    const t =
      lengthSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq))
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
  }
  return Math.min(toBox(a), toBox(b), ...corners.map(toSegment))
}

const CELL_M = 200

/**
 * Drops every block of a tier that stands in an extra prop zone (outside the districts, which
 * have no blocks) and comes within its street's half-width plus `carveMarginM` of a chain.
 */
export function carveBlocks(
  blocks: TierBlocks,
  streets: StreetsResult,
  extraZones: readonly { x: number; y: number; r: number }[],
  config: Pick<StreetsGeoConfig, 'carveMarginM'>,
): { blocks: TierBlocks; carved: number } {
  const grid = new Map<string, { a: LocalPoint; b: LocalPoint; reach: number }[]>()
  let maxReach = 0
  for (const chain of streets.chains) {
    const reach = chain.halfWidthM + config.carveMarginM
    maxReach = Math.max(maxReach, reach)
    for (let i = 1; i < chain.points.length; i++) {
      const a = chain.points[i - 1]
      const b = chain.points[i]
      if (a === undefined || b === undefined) continue
      const minX = Math.floor(Math.min(a.x, b.x) / CELL_M)
      const maxX = Math.floor(Math.max(a.x, b.x) / CELL_M)
      const minY = Math.floor(Math.min(a.y, b.y) / CELL_M)
      const maxY = Math.floor(Math.max(a.y, b.y) / CELL_M)
      for (let cx = minX; cx <= maxX; cx++) {
        for (let cy = minY; cy <= maxY; cy++) {
          const key = `${cx},${cy}`
          const list = grid.get(key)
          const entry = { a, b, reach }
          if (list === undefined) grid.set(key, [entry])
          else list.push(entry)
        }
      }
    }
  }
  const half = blocks.sizeM / 2
  const span = half * Math.SQRT2 + maxReach
  let carved = 0
  const groups: BlockGroup[] = []
  for (const group of blocks.groups) {
    const angle = (group.angleDeg * Math.PI) / 180
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const local = (p: LocalPoint, c: LocalPoint) => {
      const dx = p.x - c.x
      const dy = p.y - c.y
      return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos }
    }
    const points: LocalPoint[] = []
    const heights: number[] = []
    decodePath(group.p).forEach((centre, index) => {
      const zoned = extraZones.some(
        (zone) => Math.hypot(centre.x - zone.x, centre.y - zone.y) <= zone.r + span,
      )
      let crosses = false
      if (zoned) {
        const minX = Math.floor((centre.x - span) / CELL_M)
        const maxX = Math.floor((centre.x + span) / CELL_M)
        const minY = Math.floor((centre.y - span) / CELL_M)
        const maxY = Math.floor((centre.y + span) / CELL_M)
        outer: for (let cx = minX; cx <= maxX; cx++) {
          for (let cy = minY; cy <= maxY; cy++) {
            for (const { a, b, reach } of grid.get(`${cx},${cy}`) ?? []) {
              if (segmentSquareDistance(local(a, centre), local(b, centre), half) <= reach) {
                crosses = true
                break outer
              }
            }
          }
        }
      }
      if (crosses) {
        carved++
        return
      }
      points.push(centre)
      heights.push(group.h[index] ?? 1)
    })
    if (points.length > 0) groups.push({ ...group, p: encodePath(points), h: heights })
  }
  const instances = groups.reduce((sum, group) => sum + group.h.length, 0)
  return {
    blocks: { ...blocks, groups, instances, triangles: instances * BLOCK_TRIANGLES },
    carved,
  }
}

/** Whether a tier's blocks are carved (geo.json `streets.carveTiers`). */
export const carvesTier = (config: Pick<StreetsGeoConfig, 'carveTiers'>, tier: QualityTier) =>
  config.carveTiers.includes(tier)
