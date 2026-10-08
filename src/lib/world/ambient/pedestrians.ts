/**
 * Ambient pedestrians (S04l): people walking the sidewalks around place pins, homes and
 * landmarks. They are scenery, never players (UX-3): the runtime draws them small, without a
 * ring, a chip or a handle, never pickable and never counted.
 *
 * Each anchor owns `pedestrians.perAnchor` slots living in staggered epochs of `epochS`. At an
 * epoch start a slot draws (seed, anchor, slot, epoch) a street near its anchor, a side, a speed,
 * a jitter and an outfit, and walks: along the sidewalk (the street's half-width plus
 * `sidewalkOffsetM`), and at every corner round onto the cross street on the same block, so it
 * never crosses a street. A corner beyond `anchorRadiusM` of the anchor, or a street reaching
 * into a memorial clearance, turns it back along the same sidewalk. It steps out of a door (a
 * scale fade) at the start of the epoch and into one at the end.
 *
 * No memorial is ever an anchor, and no anchor stands within its clearance plus
 * `lookOnlyMarginM` (the caller passes those circles grown already).
 */
import { createRng, type Rng } from '../streetProps'
import { cellKey } from './graph'
import {
  createSample,
  hash01,
  hashInt,
  headingAt,
  makePath,
  offsetPolyline,
  sampleAt,
  segmentDistance,
  type Path,
  type XY,
} from './path'
import type {
  AmbientConfig,
  AmbientPose,
  AmbientTier,
  Circle,
  PedestrianAnchor,
  StreetGraph,
} from './types'
import { createPose } from './types'

const MAX_EDGES = 64
const LOOK_M = 1
/** A walk starts at least this far from a junction (beyond the widest cross street's kerb). */
const START_CLEAR_M = 16
/** Sway (radians) of the walking heading. */
const SWAY = 0.06

export interface PedestrianSimOptions {
  readonly graph: StreetGraph
  readonly config: Pick<AmbientConfig, 'seed' | 'pedestrians'>
  readonly tier: AmbientTier
  /** Candidate anchors; memorials and anchors in a clearance are dropped here. */
  readonly anchors: readonly PedestrianAnchor[]
  /** Memorial clearances already grown by `lookOnlyMarginM`. */
  readonly avoid: readonly Circle[]
  /** How many pedestrian kits the tier has (an outfit picks one). */
  readonly kits: number
}

export interface PedestrianRun {
  readonly startS: number
  readonly visibleS: number
  readonly path: Path
  readonly speed: number
  readonly kit: number
  readonly skin: number
  readonly top: number
  readonly bottom: number
  /** Bob phase (radians). */
  readonly phase: number
}

export interface PedestrianSample {
  readonly pose: AmbientPose
  id: number
  kit: number
  skin: number
  top: number
  bottom: number
}

export interface PedestrianSim {
  /** The anchors kept (in a street zone with streets nearby, clear of every memorial). */
  readonly anchors: readonly PedestrianAnchor[]
  /**
   * Writes every active pedestrian of the anchors within `radiusM` of (x, y) at city time `tS`
   * into `samples` and returns how many.
   */
  collect(x: number, y: number, radiusM: number, tS: number, share: number): number
  readonly samples: readonly PedestrianSample[]
  /** The run an anchor's slot follows at `tS` (tests). */
  runOf(anchor: number, slot: number, tS: number): PedestrianRun | null
}

const inside = (p: XY, circles: readonly Circle[]) =>
  circles.some((c) => Math.hypot(p.x - c.x, p.y - c.y) < c.r)

/** Edges with a point within `radiusM` of the anchor that pedestrians may use. */
function nearbyEdges(graph: StreetGraph, anchor: XY, radiusM: number): number[] {
  const out: number[] = []
  const cell = graph.cellM
  const span = Math.ceil(radiusM / cell) + 1
  const cx = Math.floor(anchor.x / cell)
  const cy = Math.floor(anchor.y / cell)
  // graph.cells holds edges by midpoint; `span` reaches one cell further for long edges.
  for (let dx = -span; dx <= span; dx++) {
    for (let dy = -span; dy <= span; dy++) {
      const key = cellKey(cx + dx, cy + dy)
      for (const e of graph.cells.get(key) ?? []) {
        const edge = graph.edges[e]
        if (edge === undefined || edge.nearMemorial) continue
        let near = false
        for (let k = 1; k < edge.points.length && !near; k++) {
          const a = edge.points[k - 1]
          const b = edge.points[k]
          if (a !== undefined && b !== undefined && segmentDistance(anchor, a, b) <= radiusM) {
            near = true
          }
        }
        if (near) out.push(e)
      }
    }
  }
  return out.sort((a, b) => a - b)
}

/**
 * The outgoing end at a node that keeps a walker on its block: the most clockwise turn for a
 * walker on the right-hand sidewalk (`side` 1), the most counter-clockwise for the left (-1).
 * Every other street at the node lies beyond it, so taking it never crosses one.
 */
function cornerTurn(
  graph: StreetGraph,
  nodeIndex: number,
  arrivedEdge: number,
  arrivedAtStart: boolean,
  inX: number,
  inY: number,
  side: number,
): { edge: number; atStart: boolean } | null {
  const node = graph.nodes[nodeIndex]
  if (node === undefined) return null
  let best: { edge: number; atStart: boolean } | null = null
  let bestAngle = Infinity
  for (const end of node.ends) {
    if (end.edge === arrivedEdge && end.atStart === arrivedAtStart) continue
    const edge = graph.edges[end.edge]
    if (edge === undefined || edge.nearMemorial) continue
    const a = end.atStart ? edge.points[0] : edge.points[edge.points.length - 1]
    const b = end.atStart ? edge.points[1] : edge.points[edge.points.length - 2]
    if (a === undefined || b === undefined) continue
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const ox = (b.x - a.x) / l
    const oy = (b.y - a.y) / l
    // Signed turn, counter-clockwise positive; a right-side walker wants the smallest.
    const turn = Math.atan2(inX * oy - inY * ox, inX * ox + inY * oy)
    // A turn back down the same street (±180°) is a crossing, not a corner.
    if (Math.abs(Math.abs(turn) - Math.PI) < 0.05) continue
    const score = turn * side
    if (score < bestAngle) {
      bestAngle = score
      best = end
    }
  }
  return best
}

export function createPedestrianSim(options: PedestrianSimOptions): PedestrianSim {
  const { graph, tier, avoid } = options
  const { seed, pedestrians } = options.config
  const perAnchor = pedestrians.perAnchor[tier]
  const epochS = pedestrians.epochS
  const cohorts = 4
  const allowed = new Set(pedestrians.anchors)

  const kept: PedestrianAnchor[] = []
  const anchorEdges: number[][] = []
  for (const anchor of options.anchors) {
    if (!allowed.has(anchor.kind) || inside(anchor, avoid)) continue
    const edges = nearbyEdges(graph, anchor, pedestrians.anchorRadiusM)
    if (edges.length === 0) continue
    kept.push(anchor)
    anchorEdges.push(edges)
  }
  const anchorHash = kept.map((a) => hashInt(seed, Math.round(a.x), Math.round(a.y), 0xa7))

  interface SlotCache {
    epoch: number
    run: PedestrianRun | null
    used: number
  }
  const cache = new Map<number, SlotCache>()
  let tick = 0

  const cohortOf = (anchor: number, slot: number) =>
    hashInt(seed, anchorHash[anchor] ?? 0, slot, 0xc1) % cohorts
  const epochOf = (cohort: number, tS: number) =>
    Math.floor((tS - (cohort * epochS) / cohorts) / epochS)

  function compile(anchorIndex: number, slot: number, epoch: number, cohort: number) {
    const anchor = kept[anchorIndex]
    const edges = anchorEdges[anchorIndex] ?? []
    if (anchor === undefined || edges.length === 0) return null
    const rng: Rng = createRng(hashInt(seed, anchorHash[anchorIndex] ?? 0, slot, epoch))
    const edgeRoll = rng.next()
    const fracRoll = rng.next()
    const dirRoll = rng.next()
    const sideRoll = rng.next()
    const speedRoll = rng.next()
    const jitterRoll = rng.next()
    const kit = Math.floor(rng.next() * Math.max(1, options.kits))
    const skin = Math.floor(rng.next() * Math.max(1, pedestrians.palette.skin.length))
    const top = Math.floor(rng.next() * Math.max(1, pedestrians.palette.tops.length))
    const bottom = Math.floor(rng.next() * Math.max(1, pedestrians.palette.bottoms.length))
    const phase = rng.next() * Math.PI * 2
    const speed =
      pedestrians.speedMps.min + speedRoll * (pedestrians.speedMps.max - pedestrians.speedMps.min)
    const jitter = (jitterRoll * 2 - 1) * pedestrians.sidewalkJitterM
    const needM = speed * epochS + 2

    let edgeIndex = edges[Math.min(edges.length - 1, Math.floor(edgeRoll * edges.length))] ?? 0
    let fwd = dirRoll < 0.5
    let side = sideRoll < 0.5 ? 1 : -1
    const centre: XY[] = []
    const signed: number[] = []
    let total = 0
    for (let step = 0; step < MAX_EDGES; step++) {
      const edge = graph.edges[edgeIndex]
      if (edge === undefined) break
      const pts = fwd ? edge.points : [...edge.points].reverse()
      const offset = (edge.halfWidthM + pedestrians.sidewalkOffsetM + jitter) * side
      let k = 1
      if (step === 0) {
        // Start clear of the junctions at either end (out of the cross streets).
        const margin = Math.min(edge.lengthM / 2, START_CLEAR_M)
        const s0 = margin + fracRoll * (edge.lengthM - 2 * margin)
        let along = 0
        for (; k < pts.length; k++) {
          const a = pts[k - 1]
          const b = pts[k]
          if (a === undefined || b === undefined) break
          const l = Math.hypot(b.x - a.x, b.y - a.y)
          if (along + l > s0) {
            const t = l === 0 ? 0 : (s0 - along) / l
            centre.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
            break
          }
          along += l
        }
        if (centre.length === 0) centre.push(pts[0] ?? { x: 0, y: 0 })
      }
      for (; k < pts.length; k++) {
        const p = pts[k]
        if (p === undefined) continue
        const prev = centre[centre.length - 1] ?? p
        total += Math.hypot(p.x - prev.x, p.y - prev.y)
        centre.push(p)
        signed.push(offset)
      }
      const nodeIndex = fwd ? edge.to : edge.from
      const node = graph.nodes[nodeIndex]
      const a = centre[centre.length - 2] ?? centre[0] ?? { x: 0, y: 0 }
      const b = centre[centre.length - 1] ?? a
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const tooFar =
        node === undefined ||
        Math.hypot(node.x - anchor.x, node.y - anchor.y) > pedestrians.anchorRadiusM ||
        inside(node, avoid)
      const done = total >= needM
      const turn =
        tooFar || done
          ? null
          : cornerTurn(graph, nodeIndex, edgeIndex, !fwd, (b.x - a.x) / l, (b.y - a.y) / l, side)
      if (turn === null) {
        // Turning back (or stopping) at a junction happens before the cross street's kerb,
        // never out in it.
        let crossHalfM = 0
        for (const end of node?.ends ?? []) {
          if (end.edge !== edgeIndex) {
            crossHalfM = Math.max(crossHalfM, graph.edges[end.edge]?.halfWidthM ?? 0)
          }
        }
        if (crossHalfM > 0) {
          const back = Math.min(l * 0.9, crossHalfM + pedestrians.sidewalkOffsetM + 1)
          centre[centre.length - 1] = {
            x: b.x - ((b.x - a.x) / l) * back,
            y: b.y - ((b.y - a.y) / l) * back,
          }
          total -= back
        }
        if (done) break
        // Back along the same sidewalk: the other direction, the street on the other hand.
        fwd = !fwd
        side = -side
      } else {
        edgeIndex = turn.edge
        fwd = turn.atStart
      }
    }
    if (centre.length < 2) return null
    const path = makePath(offsetPolyline(centre, signed).points)
    const startS = epoch * epochS + (cohort * epochS) / cohorts
    return {
      startS,
      visibleS: Math.min(epochS, path.length / speed),
      path,
      speed,
      kit,
      skin,
      top,
      bottom,
      phase,
    }
  }

  function runAt(anchor: number, slot: number, tS: number): PedestrianRun | null {
    const cohort = cohortOf(anchor, slot)
    const epoch = epochOf(cohort, tS)
    const id = anchor * 8 + slot
    let entry = cache.get(id)
    if (entry === undefined || entry.epoch !== epoch) {
      entry = { epoch, run: compile(anchor, slot, epoch, cohort), used: tick }
      cache.set(id, entry)
    }
    entry.used = tick
    return entry.run
  }

  const samples: PedestrianSample[] = []
  return {
    anchors: kept,
    samples,
    collect(x, y, radiusM, tS, share) {
      tick++
      let n = 0
      const reach = radiusM + pedestrians.anchorRadiusM
      for (let i = 0; i < kept.length; i++) {
        const anchor = kept[i]
        if (anchor === undefined) continue
        const dx = anchor.x - x
        const dy = anchor.y - y
        if (dx * dx + dy * dy > reach * reach) continue
        for (let slot = 0; slot < perAnchor; slot++) {
          if (hash01(seed, anchorHash[i] ?? 0, slot, 0xdf) >= share) continue
          const run = runAt(i, slot, tS)
          if (run === null) continue
          let sample = samples[n]
          if (sample === undefined) {
            sample = { pose: createPose(), id: 0, kit: 0, skin: 0, top: 0, bottom: 0 }
            samples.push(sample)
          }
          if (!pedestrianAt(run, tS, pedestrians, sample.pose)) continue
          sample.id = i * 8 + slot
          sample.kit = run.kit
          sample.skin = run.skin
          sample.top = run.top
          sample.bottom = run.bottom
          n++
        }
      }
      if (tick % 256 === 0) {
        for (const [id, entry] of cache) if (tick - entry.used > 512) cache.delete(id)
      }
      return n
    },
    runOf: runAt,
  }
}

const at = createSample()

/** Writes a run's pose at city time `tS`; false (alpha 0) when it is indoors then. */
export function pedestrianAt(
  run: PedestrianRun,
  tS: number,
  pedestrians: Pick<AmbientConfig['pedestrians'], 'fadeS' | 'bobM' | 'bobHz'>,
  out: AmbientPose,
): boolean {
  const tau = tS - run.startS
  if (tau < 0 || tau >= run.visibleS) {
    out.alpha = 0
    out.scale = 0
    out.speed = 0
    return false
  }
  const arc = tau * run.speed
  sampleAt(run.path, arc, at)
  const fade = Math.max(
    0,
    Math.min(1, tau / pedestrians.fadeS, (run.visibleS - tau) / pedestrians.fadeS),
  )
  const stride = 2 * Math.PI * pedestrians.bobHz * tau + run.phase
  out.x = at.x
  out.y = at.y
  out.yaw = headingAt(run.path, arc, LOOK_M) + SWAY * Math.sin(stride / 2)
  out.scale = fade * fade * (3 - 2 * fade)
  out.alpha = out.scale > 0 ? 1 : 0
  out.lift = pedestrians.bobM * (0.5 + 0.5 * Math.cos(stride))
  out.speed = run.speed
  return out.alpha > 0
}
