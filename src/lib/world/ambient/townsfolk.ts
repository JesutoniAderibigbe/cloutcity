/**
 * The townsfolk (S04o): Sims-like locals who hang out at the places and walk between them, drawn
 * at the player's size so the map reads as a lived-in city at its default view (the ambient
 * pedestrians stay real-sized on the sidewalks). NPCs, never players (UX-3): no ring, no chip,
 * never counted, and their card says "Local".
 *
 * Every local belongs to a place (`perVenue` of them) and lives in staggered cycles of `epochS`.
 * Each cycle it is at one place (home, or one of its home's `neighbours` nearest places within a
 * walk of `maxWalkShare` of a cycle), standing on a ring in front of that place in one pose for
 * the whole stay (idle, talking to the ring's centre, or waving at the camera; the scene plays
 * the pose's clip), and at the end of the cycle it walks to the next cycle's place (S04q): it
 * turns on the spot, eases into a constant walking pace along the sidewalks of the street graph
 * the cars use (or a smoothed straight line where no street route is short enough), swings round
 * corners, eases to a stop on its next spot and turns to the pose it holds there. The walk ends
 * exactly where and as the next stay begins, so a local never jumps between the two.
 * Everything is a pure function of (seed, place, slot, city time): a reload, or another device,
 * shows the same local at the same spot.
 *
 * Distances are planned for locals `heightM` tall (the map style's tallest person, which they are
 * at every zoom but the closest): ring spacing, the sidewalk they keep to and their pace (in
 * heights a second, so their stride matches their size and the feet the scene animates do not
 * slide).
 */
import { createRng } from '../streetProps'
import { cellKey } from './graph'
import {
  hash01,
  hashInt,
  headingAt,
  makePath,
  offsetPolyline,
  sampleAt,
  type Path,
  type XY,
} from './path'
import type { AmbientTier, StreetGraph, TownsfolkConfig, TownsfolkPose } from './types'

/** A place locals hang out at, in local metres (x east, y north). */
export interface TownsfolkVenue {
  readonly id: string
  readonly x: number
  readonly y: number
}

/** The two body variants, in kit order (src/scene/ambient/kitIds.ts TOWNSFOLK_VARIANTS). */
export const TOWNSFOLK_BODIES = ['woman', 'man'] as const
export type TownsfolkBody = (typeof TOWNSFOLK_BODIES)[number]

/** Who a local is: what their card shows. */
export interface TownsfolkProfile {
  /** `<place id>#<slot>`: stable across reloads and devices. */
  readonly id: string
  readonly name: string
  readonly body: TownsfolkBody
  /** Copy key suffix: `townsfolk.vibe.<vibe>`. */
  readonly vibe: string
  /** The place they call home. */
  readonly homeId: string
}

export interface Resident {
  readonly profile: TownsfolkProfile
  readonly home: number
  readonly slot: number
  readonly hash: number
  readonly body: number
  readonly skin: number
  readonly top: number
  readonly bottom: number
  readonly hair: number
}

/** Where one local stands now. Mutable and reused (no allocation per tick). */
export interface TownsfolkSample {
  /** Index into `residents`. */
  resident: number
  x: number
  y: number
  yaw: number
  pose: TownsfolkPose
  /** Metres a second along the walk (0 while standing or turning). */
  speed: number
}

export interface TownsfolkPalette {
  readonly skin: number
  readonly tops: number
  readonly bottoms: number
}

export interface TownsfolkSimOptions {
  readonly venues: readonly TownsfolkVenue[]
  readonly seed: number
  readonly config: TownsfolkConfig
  readonly tier: AmbientTier
  /** How many colours each recoloured bucket has (ambient.json `pedestrians.palette`). */
  readonly palette: TownsfolkPalette
  /** The height distances are planned for, metres (see the module note). */
  readonly heightM: number
  /** The streets the cars drive (src/lib/world/ambient/graph.ts); null walks straight. */
  readonly graph: StreetGraph | null
}

export interface TownsfolkSim {
  readonly residents: readonly Resident[]
  readonly samples: readonly TownsfolkSample[]
  /**
   * Writes every active local whose home is within `radiusM` of (x, y) (plus a walk) at city
   * time `tS` into `samples`, and returns how many.
   */
  collect(x: number, y: number, radiusM: number, tS: number, share: number): number
  /** The place index a local is at (or leaving) in the cycle that holds `tS` (tests). */
  venueAt(resident: number, tS: number): number
  /** The walk a local takes at the end of the cycle holding `tS`, or null when it stays (tests). */
  walkOf(resident: number, tS: number): TownsfolkWalk | null
}

/** One walk between two stays. */
export interface TownsfolkWalk {
  readonly path: Path
  /** Seconds from leaving the first spot to standing turned on the next. */
  readonly durationS: number
  /** Its cruising pace. */
  readonly speedMps: number
  /** Whether it follows the streets (false: a smoothed straight line). */
  readonly streets: boolean
}

/** A 32-bit FNV-1a hash of a string (place ids are strings). */
export function hashString(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0
  }
  return hash
}

const pick = <T>(list: readonly T[], roll: number, fallback: T): T =>
  list[Math.min(list.length - 1, Math.floor(roll * list.length))] ?? fallback

/** The deterministic profile of slot `slot` of a place. */
export function townsfolkProfile(
  seed: number,
  venueId: string,
  slot: number,
  config: Pick<TownsfolkConfig, 'names' | 'vibes'>,
): { readonly profile: TownsfolkProfile; readonly hash: number; readonly rng: () => number } {
  const hash = hashInt(seed, hashString(venueId), slot, 0x70)
  const rng = createRng(hash)
  const next = () => rng.next()
  // Body first, so the card's name matches the model drawn.
  const body: TownsfolkBody = next() < 0.5 ? 'woman' : 'man'
  const first = pick(config.names[body], next(), '')
  const initial = pick([...config.names.initials], next(), '')
  const vibe = pick(config.vibes, next(), '')
  return {
    profile: {
      id: `${venueId}#${slot}`,
      name: initial === '' ? first : `${first} ${initial}.`,
      body,
      vibe,
      homeId: venueId,
    },
    hash,
    rng: next,
  }
}

/** Places sorted by distance from `from`, nearest first, within `maxM`, at most `count`. */
function nearest(
  venues: readonly TownsfolkVenue[],
  from: number,
  count: number,
  maxM: number,
): number[] {
  const a = venues[from]
  if (a === undefined || count === 0) return []
  return venues
    .map((b, i) => ({ i, d: Math.hypot(b.x - a.x, b.y - a.y) }))
    .filter((entry) => entry.i !== from && entry.d <= maxM)
    .sort((p, q) => p.d - q.d || p.i - q.i)
    .slice(0, count)
    .map((entry) => entry.i)
}

/** Corner-cutting smoothing (Chaikin), ends kept: walkers swing round corners. */
export function smoothPolyline(points: readonly XY[], passes: number): XY[] {
  let out: XY[] = [...points]
  for (let pass = 0; pass < passes && out.length > 2; pass++) {
    const next: XY[] = [out[0] ?? { x: 0, y: 0 }]
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i] ?? { x: 0, y: 0 }
      const b = out[i + 1] ?? a
      if (i > 0) next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 })
      if (i < out.length - 2) next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 })
    }
    next.push(out[out.length - 1] ?? { x: 0, y: 0 })
    out = next
  }
  return out
}

/**
 * Arc length after `t` seconds of a walk of `length` metres at `speed` that eases in and out
 * over `easeS` (constant acceleration, then cruise, then constant braking), and its speed.
 * The walk lasts `length / speed + easeS` seconds.
 */
export function easedArc(
  t: number,
  length: number,
  speed: number,
  easeS: number,
): { s: number; v: number } {
  if (length <= 0 || speed <= 0) return { s: 0, v: 0 }
  // A walk too short to reach cruising pace eases half-way in and half-way out.
  const ease = Math.min(easeS, length / speed)
  const total = length / speed + ease
  const u = Math.max(0, Math.min(total, t))
  if (ease <= 0) return { s: Math.min(length, u * speed), v: speed }
  if (u < ease) return { s: (speed * u * u) / (2 * ease), v: (speed * u) / ease }
  if (u > total - ease) {
    const left = total - u
    return { s: length - (speed * left * left) / (2 * ease), v: (speed * left) / ease }
  }
  return { s: speed * (u - ease / 2), v: speed }
}

/** Shortest-angle blend from `a` to `b` (radians). */
const turnTowards = (a: number, b: number, u: number) => {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  const k = Math.max(0, Math.min(1, u))
  return a + d * k * k * (3 - 2 * k)
}

/** A binary min-heap of node indices keyed by a cost array. */
function dijkstra(graph: StreetGraph, from: number, to: number, limitM: number): number[] | null {
  const n = graph.nodes.length
  const cost = new Float64Array(n).fill(Infinity)
  const via = new Int32Array(n).fill(-1)
  const heap: number[] = []
  const push = (node: number) => {
    heap.push(node)
    let i = heap.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if ((cost[heap[parent] ?? 0] ?? 0) <= (cost[node] ?? 0)) break
      heap[i] = heap[parent] ?? 0
      i = parent
    }
    heap[i] = node
  }
  const pop = (): number => {
    const top = heap[0] ?? -1
    const last = heap.pop() ?? -1
    if (heap.length > 0) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        const key = (k: number) => (k === i ? (cost[last] ?? 0) : (cost[heap[k] ?? 0] ?? 0))
        if (l < heap.length && key(l) < key(m)) m = l
        if (r < heap.length && key(r) < key(m)) m = r
        if (m === i) break
        heap[i] = heap[m] ?? 0
        i = m
      }
      heap[i] = last
    }
    return top
  }
  cost[from] = 0
  push(from)
  while (heap.length > 0) {
    const node = pop()
    const here = cost[node] ?? Infinity
    if (node === to) break
    if (here > limitM) return null
    for (const end of graph.nodes[node]?.ends ?? []) {
      const edge = graph.edges[end.edge]
      if (edge === undefined || edge.nearMemorial) continue
      const other = end.atStart ? edge.to : edge.from
      const next = here + edge.lengthM
      if (next < (cost[other] ?? Infinity)) {
        cost[other] = next
        via[other] = end.edge
        push(other)
      }
    }
  }
  if (!Number.isFinite(cost[to] ?? Infinity)) return null
  const edges: number[] = []
  for (let node = to; node !== from;) {
    const e = via[node] ?? -1
    const edge = graph.edges[e]
    if (edge === undefined) return null
    edges.push(e)
    node = edge.to === node ? edge.from : edge.to
  }
  return edges.reverse()
}

export function createTownsfolkSim(options: TownsfolkSimOptions): TownsfolkSim {
  const { venues, seed, config, tier, palette, graph } = options
  const h = options.heightM
  const perVenue = config.perVenue[tier]
  const poses = config.poses[tier]
  const has = (pose: TownsfolkPose) => poses.includes(pose)
  const standing: TownsfolkPose = has('idle') ? 'idle' : (poses[0] ?? 'idle')
  const walking: TownsfolkPose = has('walk') ? 'walk' : standing
  const speed = config.walkHeightsPerS * h
  // The longest walk a cycle allows (turns and easing included).
  const maxWalkS = config.epochS * config.maxWalkShare
  const maxWalkM = Math.max(0, (maxWalkS - 2 * config.turnS - config.easeS) * speed)
  const ringSlots = perVenue * 2

  const residents: Resident[] = []
  venues.forEach((venue, v) => {
    for (let slot = 0; slot < perVenue; slot++) {
      const { profile, hash, rng } = townsfolkProfile(seed, venue.id, slot, config)
      residents.push({
        profile,
        home: v,
        slot,
        hash,
        body: TOWNSFOLK_BODIES.indexOf(profile.body),
        skin: Math.floor(rng() * palette.skin),
        top: Math.floor(rng() * palette.tops),
        bottom: Math.floor(rng() * palette.bottoms),
        hair: Math.floor(rng() * config.hair.length),
      })
    }
  })
  // A detour along the streets can only lengthen a walk: neighbours are those a straight walk
  // reaches; a street route too long for the cycle falls back to the straight one.
  const neighbours = venues.map((_, v) => nearest(venues, v, config.neighbours, maxWalkM * 0.8))
  // Each place's ring turns by its own hash, so neighbouring rings do not look stamped.
  const ringTurn = venues.map((venue) => hash01(seed, hashString(venue.id), 0x71) * Math.PI * 2)

  const offsetOf = (r: Resident) => hash01(seed, r.hash, 0x72) * config.epochS
  const epochOf = (r: Resident, tS: number) => Math.floor((tS + offsetOf(r)) / config.epochS)

  const venueIn = (r: Resident, epoch: number): number => {
    const near = neighbours[r.home] ?? []
    if (near.length === 0 || hash01(seed, r.hash, epoch, 0x73) < config.homeShare) return r.home
    return near[hashInt(seed, r.hash, epoch, 0x74) % near.length] ?? r.home
  }

  /** The ring slot a local takes at a place: home slots are even, visitors take the odd gaps. */
  const slotAt = (r: Resident, venue: number) =>
    venue === r.home ? 2 * r.slot : 2 * (r.hash % perVenue) + 1

  const ringRadius =
    Math.max(config.minRingOfHeight, (config.spacingOfHeight * ringSlots) / (2 * Math.PI)) * h

  const centreX = (venue: number) => venues[venue]?.x ?? 0
  const centreY = (venue: number) => (venues[venue]?.y ?? 0) - config.frontM

  const spotOf = (r: Resident, venue: number): XY => {
    const angle = ringTurn[venue] ?? 0
    const theta = angle + (slotAt(r, venue) / ringSlots) * Math.PI * 2
    return {
      x: centreX(venue) + Math.sin(theta) * ringRadius,
      y: centreY(venue) + Math.cos(theta) * ringRadius,
    }
  }

  const standingPose = (r: Resident, epoch: number): TownsfolkPose => {
    const roll = hash01(seed, r.hash, epoch, 0x75)
    if (has('talk') && roll < config.poseShare.talk) return 'talk'
    if (has('wave') && roll < config.poseShare.talk + config.poseShare.wave) return 'wave'
    return standing
  }

  /** Where a local faces through a stay: the ring's centre to talk, else the camera (south). */
  const standingYaw = (r: Resident, epoch: number, venue: number, pose: TownsfolkPose) => {
    if (pose === 'talk') {
      const at = spotOf(r, venue)
      // yaw = atan2(dx, -dy) turns the model's +z that way.
      return Math.atan2(centreX(venue) - at.x, -(centreY(venue) - at.y))
    }
    return (hash01(seed, r.hash, epoch, 0x76) * 2 - 1) * config.faceJitterRad
  }

  // ---- street routes between places ---------------------------------------------------------
  /**
   * Where a place's walkers come and go: just in front of its ring (the plot's open side), so a
   * walk never cuts through the building behind it.
   */
  const gateOf = (venue: number): XY => ({
    x: centreX(venue),
    y: centreY(venue) - ringRadius - config.sidewalkOfHeight * h,
  })

  /** The street node a place's walkers step onto: the nearest in front of its ring. */
  const accessNode = new Map<number, number>()
  const accessOf = (venue: number): number => {
    const known = accessNode.get(venue)
    if (known !== undefined) return known
    let best = -1
    if (graph !== null) {
      const gate = gateOf(venue)
      const span = Math.ceil(config.accessM / graph.cellM) + 1
      const cx = Math.floor(gate.x / graph.cellM)
      const cy = Math.floor(gate.y / graph.cellM)
      let bestCost = Infinity
      for (let dx = -span; dx <= span; dx++) {
        for (let dy = -span; dy <= span; dy++) {
          for (const e of graph.cells.get(cellKey(cx + dx, cy + dy)) ?? []) {
            const edge = graph.edges[e]
            if (edge === undefined || edge.nearMemorial) continue
            for (const node of [edge.from, edge.to]) {
              const p = graph.nodes[node]
              // A node beside or behind the ring would walk them across the plot.
              if (p === undefined || p.y > gate.y) continue
              const d = Math.hypot(p.x - gate.x, p.y - gate.y)
              if (d > config.accessM) continue
              if (d < bestCost || (d === bestCost && node < best)) {
                bestCost = d
                best = node
              }
            }
          }
        }
      }
    }
    accessNode.set(venue, best)
    return best
  }

  /** The sidewalk polyline from one place's street node to another's, or null. */
  const routes = new Map<number, XY[] | null>()
  const routeOf = (from: number, to: number): XY[] | null => {
    const key = from * venues.length + to
    if (routes.has(key)) return routes.get(key) ?? null
    let route: XY[] | null = null
    const a = accessOf(from)
    const b = accessOf(to)
    if (graph !== null && a >= 0 && b >= 0 && a !== b) {
      const edges = dijkstra(graph, a, b, maxWalkM)
      if (edges !== null && edges.length > 0) {
        const points: XY[] = []
        const offsets: number[] = []
        let node = a
        for (const e of edges) {
          const edge = graph.edges[e]
          if (edge === undefined) continue
          const forward = edge.from === node
          const pts = forward ? edge.points : [...edge.points].reverse()
          const sidewalk = edge.halfWidthM + config.sidewalkOfHeight * h
          for (let k = points.length === 0 ? 0 : 1; k < pts.length; k++) {
            const p = pts[k]
            if (p !== undefined) points.push(p)
          }
          for (let k = 1; k < pts.length; k++) offsets.push(sidewalk)
          node = forward ? edge.to : edge.from
        }
        route = offsetPolyline(points, offsets).points
      }
    }
    routes.set(key, route)
    return route
  }

  const lengthOf = (points: readonly XY[]) => {
    let total = 0
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1] ?? { x: 0, y: 0 }
      const q = points[i] ?? p
      total += Math.hypot(q.x - p.x, q.y - p.y)
    }
    return total
  }

  /** The walk that ends a resident's stay in `epoch`, cached for the cycle in progress. */
  const walks = new Map<number, { epoch: number; walk: TownsfolkWalk | null }>()
  const walkFor = (index: number, r: Resident, epoch: number): TownsfolkWalk | null => {
    const cached = walks.get(index)
    if (cached !== undefined && cached.epoch === epoch) return cached.walk
    const from = venueIn(r, epoch)
    const to = venueIn(r, epoch + 1)
    let walk: TownsfolkWalk | null = null
    if (from !== to) {
      const a = spotOf(r, from)
      const b = spotOf(r, to)
      const straight = Math.hypot(b.x - a.x, b.y - a.y)
      const route = routeOf(from, to)
      let points: XY[] = [a, b]
      let streets = false
      if (route !== null) {
        const along = [a, gateOf(from), ...route, gateOf(to), b]
        const length = lengthOf(along)
        if (length <= maxWalkM && length <= straight * config.maxDetour) {
          points = along
          streets = true
        }
      }
      if (!streets) {
        // Off the streets: out through the front of the plot, a gentle S, in through the front.
        const ga = gateOf(from)
        const gb = gateOf(to)
        const my = Math.min(ga.y, gb.y)
        points = [a, ga, { x: ga.x, y: my }, { x: gb.x, y: my }, gb, b]
      }
      const path = makePath(smoothPolyline(points, 3))
      // A long way round (the straight fallback's S) walks a little faster to fit the cycle.
      const pace = Math.max(
        speed,
        path.length / Math.max(1, maxWalkS - 2 * config.turnS - config.easeS),
      )
      const ease = Math.min(config.easeS, path.length / pace)
      walk = {
        path,
        speedMps: pace,
        durationS: path.length / pace + ease + 2 * config.turnS,
        streets,
      }
    }
    walks.set(index, { epoch, walk })
    return walk
  }

  const samples: TownsfolkSample[] = []
  const at = { x: 0, y: 0, dx: 0, dy: 1 }

  const write = (out: TownsfolkSample, index: number, r: Resident, tS: number): void => {
    const shifted = tS + offsetOf(r)
    const epoch = Math.floor(shifted / config.epochS)
    const tau = shifted - epoch * config.epochS
    const from = venueIn(r, epoch)
    const walk = walkFor(index, r, epoch)
    const leaveS = config.epochS - (walk?.durationS ?? 0)
    out.resident = index
    out.speed = 0
    const pose = standingPose(r, epoch)
    const yaw = standingYaw(r, epoch, from, pose)
    if (walk === null || tau < leaveS) {
      const spot = spotOf(r, from)
      out.x = spot.x
      out.y = spot.y
      out.pose = pose
      out.yaw = yaw
      return
    }
    const path = walk.path
    const lookM = config.turnLookOfHeight * h
    const t = tau - leaveS
    const moveS = walk.durationS - 2 * config.turnS
    out.pose = walking
    if (t < config.turnS) {
      // Turning on the spot towards the way out, already stepping.
      sampleAt(path, 0, at)
      out.x = at.x
      out.y = at.y
      out.yaw = turnTowards(yaw, headingAt(path, lookM, lookM), t / config.turnS)
      return
    }
    if (t < config.turnS + moveS) {
      const { s, v } = easedArc(t - config.turnS, path.length, walk.speedMps, config.easeS)
      sampleAt(path, s, at)
      out.x = at.x
      out.y = at.y
      out.yaw = headingAt(path, s, lookM)
      out.speed = v
      return
    }
    // Arrived: turning to the pose held on the next spot (where the next stay starts).
    const nextPose = standingPose(r, epoch + 1)
    const to = venueIn(r, epoch + 1)
    sampleAt(path, path.length, at)
    out.x = at.x
    out.y = at.y
    out.yaw = turnTowards(
      headingAt(path, path.length - lookM, lookM),
      standingYaw(r, epoch + 1, to, nextPose),
      (t - config.turnS - moveS) / config.turnS,
    )
  }

  return {
    residents,
    samples,
    collect(x, y, radiusM, tS, share) {
      let n = 0
      const reach = radiusM + maxWalkM
      for (let i = 0; i < residents.length; i++) {
        const r = residents[i]
        const home = r === undefined ? undefined : venues[r.home]
        if (r === undefined || home === undefined) continue
        const dx = home.x - x
        const dy = home.y - y
        if (dx * dx + dy * dy > reach * reach) continue
        if (hash01(seed, r.hash, 0x78) >= share) continue
        let sample = samples[n]
        if (sample === undefined) {
          sample = { resident: 0, x: 0, y: 0, yaw: 0, pose: standing, speed: 0 }
          samples.push(sample)
        }
        write(sample, i, r, tS)
        n++
      }
      return n
    },
    venueAt(resident, tS) {
      const r = residents[resident]
      return r === undefined ? -1 : venueIn(r, epochOf(r, tS))
    },
    walkOf(resident, tS) {
      const r = residents[resident]
      return r === undefined ? null : walkFor(resident, r, epochOf(r, tS))
    },
  }
}
