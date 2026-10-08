/**
 * Ambient traffic (S04l): cars, taxis and buses driving the street graph on the right-hand lane,
 * turning at junctions and stopping at red lights.
 *
 * Every `cellM` square owns `vehicles.perCell` slots. A slot lives in epochs of `epochS`, its
 * epochs staggered by one of `cohorts` cohorts; at each epoch start it draws a route from its
 * seeded generator (seed, cell, slot, epoch): a spawn point on one of the cell's streets, a
 * speed, a model and a paint, then a walk through the graph that picks a seeded next street at
 * every node and turns back only at a dead end. The route compiles into a timetable
 * (timetable.ts) with the waits at red lights folded in; the slots of one cell and cohort compile
 * together, so a car arriving at a red light behind another of them queues behind it.
 *
 * Where a car is depends only on the seed and the city clock: never on which cells were looked
 * at before, never on per-frame randomness. Only the cells near the camera target are compiled,
 * and compiled epochs are cached until they end.
 */
import { createRng, type Rng } from '../streetProps'
import { cellKey } from './graph'
import { approachAxis, isGreen, nextGreen, type SignalAxis } from './lights'
import {
  createSample,
  hash01,
  hashInt,
  headingAt,
  makePath,
  offsetPolyline,
  sampleAt,
  type Path,
  type XY,
} from './path'
import { SEGMENT, TimetableBuilder, evaluate, type Timetable } from './timetable'
import type {
  AmbientConfig,
  AmbientPose,
  AmbientTier,
  NodeEnd,
  StreetGraph,
  VehicleKind,
} from './types'
import { createPose } from './types'

/** Chain flag of a wide street (STREET_FLAGS.wide): the only streets buses use. */
const WIDE = 4
/** Most edges one route walks (an epoch is a few hundred metres to a couple of km). */
const MAX_EDGES = 96
/** Half the chord the heading is measured over (metres). */
const LOOK_M = 3
/** A red is split into this many arrival bins, each one queue place further back. */
const QUEUE_BINS = 3

export interface VehicleModel {
  readonly kind: VehicleKind
  /** Real length (metres): the queue spacing behind it. */
  readonly lengthM: number
}

export interface VehicleSimOptions {
  readonly graph: StreetGraph
  readonly config: Pick<AmbientConfig, 'seed' | 'vehicles' | 'lights'>
  readonly tier: AmbientTier
  /** The tier's models in `vehicles.models[tier]` order (from the loaded kits). */
  readonly models: readonly VehicleModel[]
}

/** One slot's compiled epoch. */
export interface VehicleRun {
  /** Absolute city time (s) the epoch starts. */
  readonly startS: number
  /** Seconds into the epoch it is visible (its route may end before the epoch does). */
  readonly visibleS: number
  readonly model: number
  readonly paint: number
  readonly kind: VehicleKind
  readonly path: Path
  readonly table: Timetable
  /** Its red-light stops (absolute times while it waits), for tests and the queue. */
  readonly stops: readonly VehicleStop[]
}

export interface VehicleStop {
  readonly node: number
  /** The signal axis its approach rides (lights.ts). */
  readonly axis: SignalAxis
  /** Arc of its stop line (the queue position it took). */
  readonly arc: number
  /** Absolute times it stands there. */
  readonly fromS: number
  readonly untilS: number
}

/** One drawn-or-not vehicle a `collect` returns. Reused between calls. */
export interface VehicleSample {
  readonly pose: AmbientPose
  /** Stable identity of its slot (cell and slot). */
  id: number
  model: number
  paint: number
  kind: VehicleKind
}

export interface VehicleSim {
  /**
   * Writes every active vehicle of the cells within `radiusM` of (x, y) at city time `tS` into
   * `samples` (from index 0) and returns how many. `share` is the active slot share (density.ts).
   */
  collect(x: number, y: number, radiusM: number, tS: number, share: number): number
  readonly samples: readonly VehicleSample[]
  /** The run a slot follows at `tS` (tests). */
  runOf(cx: number, cy: number, slot: number, tS: number): VehicleRun | null
}

interface RouteNode {
  readonly node: number
  /** Index of the node's vertex in the centre polyline. */
  readonly vertex: number
  /** Unit direction arriving at the node. */
  readonly inX: number
  readonly inY: number
  /** Kerb half-width of the widest cross street (the stop line stands beyond it). */
  readonly crossHalfM: number
  readonly incoming: number
  /** The edge it leaves by (the same one after a dead-end U-turn). */
  outgoing: number
}

interface Route {
  readonly path: Path
  /** Arc of each route node on the lane path. */
  readonly nodes: readonly (RouteNode & { readonly arc: number })[]
}

const laneOffset = (halfWidthM: number, v: AmbientConfig['vehicles']) =>
  Math.max(v.minLaneOffsetM, halfWidthM * v.laneOffsetRatio)

/**
 * Walks the graph from `startEdge` (forwards when `forward`), `startM` metres in, for at least
 * `needM` metres; buses stay on wide streets. Pure in its generator.
 */
function walkRoute(
  graph: StreetGraph,
  vehicles: AmbientConfig['vehicles'],
  rng: Rng,
  startEdge: number,
  forward: boolean,
  startM: number,
  needM: number,
  wideOnly: boolean,
): Route {
  const centre: XY[] = []
  const offsets: number[] = []
  const routeNodes: RouteNode[] = []
  let edgeIndex = startEdge
  let fwd = forward
  let total = 0
  let first = true
  for (let step = 0; step < MAX_EDGES; step++) {
    const edge = graph.edges[edgeIndex]
    if (edge === undefined) break
    const pts = fwd ? edge.points : [...edge.points].reverse()
    const lane = laneOffset(edge.halfWidthM, vehicles)
    if (first) {
      // Start `startM` in: the interpolated point, then the rest of the edge.
      let along = 0
      let k = 1
      for (; k < pts.length; k++) {
        const a = pts[k - 1]
        const b = pts[k]
        if (a === undefined || b === undefined) break
        const l = Math.hypot(b.x - a.x, b.y - a.y)
        if (along + l > startM) {
          const t = l === 0 ? 0 : (startM - along) / l
          centre.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
          break
        }
        along += l
      }
      if (centre.length === 0) centre.push(pts[pts.length - 2] ?? pts[0] ?? { x: 0, y: 0 })
      for (; k < pts.length; k++) {
        const p = pts[k]
        if (p === undefined) continue
        const prev = centre[centre.length - 1] ?? p
        total += Math.hypot(p.x - prev.x, p.y - prev.y)
        centre.push(p)
        offsets.push(lane)
      }
      first = false
    } else {
      for (let k = 1; k < pts.length; k++) {
        const p = pts[k]
        if (p === undefined) continue
        const prev = centre[centre.length - 1] ?? p
        total += Math.hypot(p.x - prev.x, p.y - prev.y)
        centre.push(p)
        offsets.push(lane)
      }
    }
    if (total >= needM) break

    const nodeIndex = fwd ? edge.to : edge.from
    const node = graph.nodes[nodeIndex]
    if (node === undefined) break
    const arrivedAtStart = !fwd
    const isArrival = (end: NodeEnd) => end.edge === edgeIndex && end.atStart === arrivedAtStart
    let options = node.ends.filter((end) => !isArrival(end))
    if (wideOnly)
      options = options.filter((end) => ((graph.edges[end.edge]?.flags ?? 0) & WIDE) !== 0)
    const a = centre[centre.length - 2] ?? centre[0] ?? { x: 0, y: 0 }
    const b = centre[centre.length - 1] ?? a
    const inLength = Math.hypot(b.x - a.x, b.y - a.y) || 1
    let crossHalfM = 0
    for (const end of node.ends) {
      if (end.edge === edgeIndex) continue
      crossHalfM = Math.max(crossHalfM, graph.edges[end.edge]?.halfWidthM ?? 0)
    }
    routeNodes.push({
      node: nodeIndex,
      vertex: centre.length - 1,
      inX: (b.x - a.x) / inLength,
      inY: (b.y - a.y) / inLength,
      crossHalfM: crossHalfM === 0 ? edge.halfWidthM : crossHalfM,
      incoming: edgeIndex,
      outgoing: edgeIndex,
    })
    // Every draw happens whether or not it is used, so one junction's options never shift the
    // generator for the rest of the route.
    const roll = rng.next()
    const next = options[Math.min(options.length - 1, Math.floor(roll * options.length))]
    if (next === undefined) {
      // A dead end: turn back along the same street.
      fwd = !fwd
    } else {
      edgeIndex = next.edge
      fwd = next.atStart
    }
    const last = routeNodes[routeNodes.length - 1]
    if (last !== undefined) last.outgoing = edgeIndex
  }
  const offset = offsetPolyline(centre, offsets)
  const path = makePath(offset.points)
  // A node's arc on the lane: where the node stands alongside the incoming lane segment. (The
  // mitre vertex itself sits before the node on a right turn and beyond it on a left one.)
  const nodeArc = (n: RouteNode) => {
    const j = offset.index[n.vertex] ?? 0
    if (j === 0) return 0
    const ax = path.xs[j - 1] ?? 0
    const ay = path.ys[j - 1] ?? 0
    const p = centre[n.vertex] ?? { x: ax, y: ay }
    return (path.arc[j - 1] ?? 0) + (p.x - ax) * n.inX + (p.y - ay) * n.inY
  }
  return { path, nodes: routeNodes.map((n) => ({ ...n, arc: nodeArc(n) })) }
}

export function createVehicleSim(options: VehicleSimOptions): VehicleSim {
  const { graph, tier, models } = options
  const { seed, vehicles, lights } = options.config
  const perCell = vehicles.perCell[tier]
  const cohorts = Math.max(1, vehicles.cohorts)
  const epochS = vehicles.epochS
  const kindIndex = (kind: VehicleKind) =>
    models.map((m, i) => (m.kind === kind ? i : -1)).filter((i) => i >= 0)
  const cars = kindIndex('car')
  const taxis = kindIndex('taxi')
  const buses = kindIndex('bus')

  interface SlotCache {
    epoch: number
    run: VehicleRun | null
    used: number
  }
  const cache = new Map<number, SlotCache>()
  let tick = 0

  const slotId = (key: number, slot: number) => key * 8 + slot
  const cohortOf = (key: number, slot: number) => hashInt(seed, key, slot, 0xc0) % cohorts
  const epochOf = (cohort: number, tS: number) =>
    Math.floor((tS - (cohort * epochS) / cohorts) / epochS)
  const epochStart = (cohort: number, epoch: number) => epoch * epochS + (cohort * epochS) / cohorts

  /** Compiles every slot of one cell and cohort for one epoch, queueing at shared lights. */
  function compileGroup(key: number, cohort: number, epoch: number) {
    const edges = graph.cells.get(key) ?? []
    const startS = epochStart(cohort, epoch)
    const queues = new Map<string, number>()
    for (let slot = 0; slot < perCell; slot++) {
      if (cohortOf(key, slot) !== cohort) continue
      const id = slotId(key, slot)
      const rng = createRng(hashInt(seed, key, slot, epoch))
      const run = edges.length === 0 ? null : compileRun(rng, edges, startS, queues)
      cache.set(id, { epoch, run, used: tick })
    }
  }

  function compileRun(
    rng: Rng,
    cellEdges: readonly number[],
    startS: number,
    queues: Map<string, number>,
  ): VehicleRun | null {
    const edgeRoll = rng.next()
    const dirRoll = rng.next()
    const fracRoll = rng.next()
    const kindRoll = rng.next()
    const modelRoll = rng.next()
    const paintRoll = rng.next()
    const wideEdges = cellEdges.filter((e) => ((graph.edges[e]?.flags ?? 0) & WIDE) !== 0)
    const bus =
      buses.length > 0 &&
      kindRoll < vehicles.busShare &&
      (!vehicles.busWideOnly || wideEdges.length > 0)
    const pool = bus && vehicles.busWideOnly ? wideEdges : cellEdges
    const edgeIndex = pool[Math.min(pool.length - 1, Math.floor(edgeRoll * pool.length))]
    const edge = edgeIndex === undefined ? undefined : graph.edges[edgeIndex]
    if (edge === undefined || edgeIndex === undefined) return null
    let kind: VehicleKind
    let modelList: number[]
    if (bus) {
      kind = 'bus'
      modelList = buses
    } else if (taxis.length > 0 && (cars.length === 0 || kindRoll < vehicles.taxiShare)) {
      kind = 'taxi'
      modelList = taxis
    } else if (cars.length > 0) {
      kind = 'car'
      modelList = cars
    } else {
      return null
    }
    const model =
      modelList[Math.min(modelList.length - 1, Math.floor(modelRoll * modelList.length))] ?? 0
    const lengthM = models[model]?.lengthM ?? vehicles.lengthM
    // Speed belongs to the street, not the car: every car on a stretch drives at the same speed,
    // so none drives through another on the same lane.
    const speedOf = (e: number) =>
      ((graph.edges[e]?.flags ?? 0) & WIDE) !== 0 ? vehicles.speedMps.max : vehicles.speedMps.min
    const needM = vehicles.speedMps.max * epochS + 80
    const route = walkRoute(
      graph,
      vehicles,
      rng,
      edgeIndex,
      dirRoll < 0.5,
      fracRoll * edge.lengthM * 0.8 + edge.lengthM * 0.1,
      needM,
      kind === 'bus' && vehicles.busWideOnly,
    )
    const { path } = route
    // Speed zones: from each route node on, the speed of the street it leaves by.
    const zoneArc: number[] = [0]
    const zoneSpeed: number[] = [speedOf(edgeIndex)]
    for (const node of route.nodes) {
      zoneArc.push(node.arc)
      zoneSpeed.push(speedOf(node.outgoing))
    }
    const speedAt = (arc: number) => {
      let i = 0
      while (i + 1 < zoneArc.length && (zoneArc[i + 1] ?? Infinity) <= arc) i++
      return zoneSpeed[i] ?? vehicles.speedMps.min
    }
    const table = new TimetableBuilder(0, 0)
    /** Cruises from the table's end to `arc`, one segment per speed zone crossed. */
    const cruiseTo = (arc: number) => {
      while (table.arc < arc - 1e-9) {
        let i = 0
        while (i + 1 < zoneArc.length && (zoneArc[i + 1] ?? Infinity) <= table.arc) i++
        const zoneEnd = Math.min(arc, zoneArc[i + 1] ?? Infinity)
        const v = zoneSpeed[i] ?? vehicles.speedMps.min
        const dt = (zoneEnd - table.arc) / v
        if (!(dt > 1e-9)) break
        table.push(SEGMENT.cruise, table.t + dt, zoneEnd)
      }
    }
    const firstBrakeM = (speedAt(0) * vehicles.brakeS) / 2
    table.push(SEGMENT.pullAway, vehicles.brakeS, Math.min(firstBrakeM, path.length))
    const stops: VehicleStop[] = []
    // Nose to tail behind a car of the nominal length (the queue's metres are per car).
    const spacing = lengthM + lights.queueGapM
    for (const node of route.nodes) {
      const signal = graph.nodes[node.node]?.signal
      if (signal === null || signal === undefined) continue
      const line = node.arc - node.crossHalfM - lights.stopGapM - lengthM / 2
      const speed = speedAt(line)
      const brakeM = (speed * vehicles.brakeS) / 2
      if (line - table.arc < brakeM || line > path.length) continue
      const tPass = table.t + (line - table.arc) / speed
      const axis = approachAxis(signal, node.inX, node.inY, lights)
      if (isGreen(signal, axis, startS + tPass, lights)) continue
      const tArrive = tPass + vehicles.brakeS / 2
      // The end of the red it meets (red at tPass, so this is a green's start: one key per red).
      const green = nextGreen(signal, axis, startS + tPass, lights)
      // Queue place: cars of this group that stopped here before it in the same red, plus how
      // late into the red it arrives (later arrivals stop further back, so a car never drives
      // through one stopped ahead of it; risk: two other groups' cars arriving close together).
      const redS = lights.cycleS * (1 - lights.greenShare)
      const lateBins = Math.max(
        0,
        Math.min(
          QUEUE_BINS - 1,
          Math.floor(((startS + tArrive - (green - redS)) / redS) * QUEUE_BINS),
        ),
      )
      const queueKey = `${node.node}:${node.incoming}:${Math.round(green)}`
      // Metres of queue (behind the stop line, to the last car's tail) the group's earlier cars
      // already fill; the car's centre stands half its length behind its place.
      const used = queues.get(queueKey) ?? 0
      const front = line + lengthM / 2
      const wanted = front - Math.max(used, lateBins * spacing) - lengthM / 2
      const at = Math.max(table.arc + brakeM, wanted)
      // A car that spawned inside its group's queue would sit on the car ahead: this slot
      // stays empty for the epoch instead.
      if (used > 0 && front - at - lengthM / 2 < used - 1e-6) return null
      queues.set(queueKey, front - at + lengthM / 2 + lights.queueGapM)
      cruiseTo(at - brakeM)
      table.push(SEGMENT.brake, table.t + vehicles.brakeS, at)
      const stoppedAt = table.t
      // It goes the moment its light is green (which may already be, after a long brake).
      const go = nextGreen(signal, axis, startS + stoppedAt, lights) - startS
      table.push(SEGMENT.dwell, go, at)
      stops.push({ node: node.node, axis, arc: at, fromS: startS + stoppedAt, untilS: startS + go })
      table.push(SEGMENT.pullAway, table.t + vehicles.brakeS, Math.min(path.length, at + brakeM))
      if (table.t >= epochS) break
    }
    cruiseTo(path.length)
    const built = table.build()
    const end = built.t[built.t.length - 1] ?? 0
    return {
      startS,
      visibleS: Math.min(epochS, end),
      model,
      paint: Math.floor(paintRoll * Math.max(1, vehicles.paint.length)),
      kind,
      path,
      table: built,
      stops,
    }
  }

  function runAt(key: number, slot: number, tS: number): VehicleRun | null {
    const cohort = cohortOf(key, slot)
    const epoch = epochOf(cohort, tS)
    const id = slotId(key, slot)
    let entry = cache.get(id)
    if (entry === undefined || entry.epoch !== epoch) {
      compileGroup(key, cohort, epoch)
      entry = cache.get(id)
    }
    if (entry === undefined) return null
    entry.used = tick
    return entry.run
  }

  const samples: VehicleSample[] = []

  return {
    samples,
    collect(x, y, radiusM, tS, share) {
      tick++
      const cell = graph.cellM
      const reach = radiusM + cell * Math.SQRT1_2
      const x0 = Math.floor((x - radiusM) / cell)
      const x1 = Math.floor((x + radiusM) / cell)
      const y0 = Math.floor((y - radiusM) / cell)
      const y1 = Math.floor((y + radiusM) / cell)
      let n = 0
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const ccx = (cx + 0.5) * cell - x
          const ccy = (cy + 0.5) * cell - y
          if (ccx * ccx + ccy * ccy > reach * reach) continue
          const key = cellKey(cx, cy)
          if (!graph.cells.has(key)) continue
          for (let slot = 0; slot < perCell; slot++) {
            if (hash01(seed, key, slot, 0xde) >= share) continue
            const run = runAt(key, slot, tS)
            if (run === null) continue
            let sample = samples[n]
            if (sample === undefined) {
              sample = { pose: createPose(), id: 0, model: 0, paint: 0, kind: 'car' }
              samples.push(sample)
            }
            if (!vehicleAt(run, tS, vehicles.fadeS, sample.pose)) continue
            sample.id = slotId(key, slot)
            sample.model = run.model
            sample.paint = run.paint
            sample.kind = run.kind
            n++
          }
        }
      }
      // Forget epochs nobody has looked at for a while (the camera moved away).
      if (tick % 256 === 0) {
        for (const [id, entry] of cache) if (tick - entry.used > 512) cache.delete(id)
      }
      return n
    },
    runOf(cx, cy, slot, tS) {
      return runAt(cellKey(cx, cy), slot, tS)
    },
  }
}

const tableOut = { arc: 0, speed: 0 }
const at = createSample()

/** Writes a run's pose at city time `tS`; false (alpha 0) when it is off the street then. */
export function vehicleAt(run: VehicleRun, tS: number, fadeS: number, out: AmbientPose): boolean {
  const tau = tS - run.startS
  if (tau < 0 || tau >= run.visibleS) {
    out.alpha = 0
    out.scale = 0
    out.speed = 0
    return false
  }
  evaluate(run.table, tau, tableOut)
  sampleAt(run.path, tableOut.arc, at)
  const fade = Math.max(0, Math.min(1, tau / fadeS, (run.visibleS - tau) / fadeS))
  out.x = at.x
  out.y = at.y
  out.yaw = headingAt(run.path, tableOut.arc, LOOK_M)
  out.scale = fade * fade * (3 - 2 * fade)
  out.alpha = out.scale > 0 ? 1 : 0
  out.lift = 0
  out.speed = tableOut.speed
  return out.alpha > 0
}
