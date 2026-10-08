/**
 * The townsfolk (S04o): Sims-like locals who hang out at the places and walk between them, drawn
 * at the player's size so the map reads as a lived-in city at its default view (the ambient
 * pedestrians stay real-sized on the sidewalks). NPCs, never players (UX-3): no ring, no chip,
 * never counted, and their card says "Local".
 *
 * Every local belongs to a place (`perVenue` of them) and lives in staggered cycles of `epochS`.
 * Each cycle it is at one place (home, or one of its home's `neighbours` nearest places within a
 * walk of `maxWalkShare` of a cycle, weighted by the place's `pull` by day and by night: clubs
 * and lounges fill up at night, food spots and coffee by day), and at the end of the cycle it
 * walks to the next cycle's place (S04q): it turns on the spot, eases into a constant walking
 * pace along the sidewalks of the street graph the cars use (or a smoothed straight line where no
 * street route is short enough), swings round corners, eases to a stop on its next spot and turns
 * to the pose it holds there. The walk ends exactly where and as the next stay begins, so a local
 * never jumps between the two.
 *
 * S04r makes them social. A place's locals pair up into crews that share a clock: in a cycle a
 * crew meets up (`crew.meetShare`) its members walk to one place from wherever they were, wave
 * hello, huddle facing each other and talk, then wave goodbye and part, or walk off together side
 * by side. A stay on the ring is split into segments of idle and talk with a turn between, and
 * often a stroll round the plaza mid-stay; some stays are spent inside (walk to the door, shrink
 * in, come back out later); a local standing idle waves at a passer-by. A cycle's place is chosen
 * once, under the night blend of the moment it is first needed, so dusk never re-routes a walk.
 * Everything else is a pure function of (seed, place, slot, city time): a reload, or another
 * device, shows the same local at the same spot.
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
  /** The place's category (`club`, `coffee-shop`, ...): its day and night `pull`. */
  readonly kind?: string
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
  /** Size share, 1 drawn in full; below 1 while going in or coming out of a door (S04r). */
  fade: number
  /** The bench (index into `benches`) a sitting local sits on, else -1 (S04r2). */
  bench: number
  /** Where along that bench, in local heights from its middle (positive: the bench's +x). */
  seat: number
}

/** A bench at townsfolk scale in front of a place (S04r2), in local metres. */
export interface TownsfolkBench {
  readonly venue: number
  readonly x: number
  readonly y: number
  /** Turn about up; 0 faces the camera (south), like the locals. */
  readonly yaw: number
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
  /** Every place's benches (none on a tier without the `sit` pose). */
  readonly benches: readonly TownsfolkBench[]
  /**
   * Writes every active local whose home is within `radiusM` of (x, y) (plus a walk) at city
   * time `tS` into `samples`, and returns how many (locals inside a place are left out).
   * `night` (0 day to 1 night) weights the places new cycles are spent at.
   */
  collect(x: number, y: number, radiusM: number, tS: number, share: number, night?: number): number
  /** The place index a local is at (or leaving) in the cycle that holds `tS` (tests). */
  venueAt(resident: number, tS: number): number
  /** The walk a local takes at the end of the cycle holding `tS`, or null when it stays (tests). */
  walkOf(resident: number, tS: number): TownsfolkWalk | null
  /** The stay a local is on (or leaving) in the cycle that holds `tS` (tests). */
  stayAt(
    resident: number,
    tS: number,
  ): { venue: number; kind: TownsfolkStayKind; crew: number } | null
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

/** What a local spends a stay doing (S04r). */
export type TownsfolkStayKind = 'ring' | 'crew' | 'inside' | 'bench'

/** One stay, planned for a cycle. Mutable scratch (no allocation per tick). */
interface Stay {
  venue: number
  kind: TownsfolkStayKind
  /** Where the local stands (the door, for a stay inside). */
  x: number
  y: number
  /** What it turns to while talking: its ring's centre, or its crew's huddle. */
  fx: number
  fy: number
  /** The crew's leader (resident index) on a crew stay, else -1. */
  crew: number
  /** Sitting on a bench (a `bench` stay, or a crew sitting together): its index, else -1. */
  bench: number
  /** The seat along it, in local heights from its middle. */
  seat: number
  /** The way a sitter faces (the bench's way, turned a little to its crew). */
  sitYaw: number
}

const newStay = (): Stay => ({
  venue: 0,
  kind: 'ring',
  x: 0,
  y: 0,
  fx: 0,
  fy: 0,
  crew: -1,
  bench: -1,
  seat: 0,
  sitYaw: 0,
})

/** Facing (fx, fy) from (x, y): yaw = atan2(dx, -dy) turns the model's +z that way. */
const faceTo = (x: number, y: number, fx: number, fy: number) => Math.atan2(fx - x, -(fy - y))

/** Facing north (into a door) and south (out of it, towards the camera). */
const NORTH = Math.PI
const SOUTH = 0

export function createTownsfolkSim(options: TownsfolkSimOptions): TownsfolkSim {
  const { venues, seed, config, tier, palette, graph } = options
  const h = options.heightM
  const perVenue = config.perVenue[tier]
  const poses = config.poses[tier]
  const has = (pose: TownsfolkPose) => poses.includes(pose)
  const standing: TownsfolkPose = has('idle') ? 'idle' : (poses[0] ?? 'idle')
  const walking: TownsfolkPose = has('walk') ? 'walk' : standing
  const talking: TownsfolkPose = has('talk') ? 'talk' : standing
  const speed = config.walkHeightsPerS * h
  // The longest walk a cycle allows (turns and easing included).
  const maxWalkS = config.epochS * config.maxWalkShare
  const maxWalkM = Math.max(0, (maxWalkS - 2 * config.turnS - config.easeS) * speed)
  const ringSlots = perVenue * 2
  const { crew: crewConfig, passWave } = config

  // ---- residents and their crews ------------------------------------------------------------
  /**
   * Each place's locals pair up into crews (S04r): slots 0-1, 2-3, ...; an odd last slot makes
   * the last crew a trio. A crew shares its cycle's clock, so its members meet up, part and walk
   * off together on the same beat.
   */
  const crews = perVenue < 2 ? 1 : Math.floor(perVenue / 2)
  const crewOfSlot = (slot: number) =>
    perVenue < 2 ? 0 : Math.min(Math.floor(slot / 2), crews - 1)
  const crewSize = (crew: number) =>
    perVenue < 2 ? 1 : crew < crews - 1 ? 2 : perVenue - 2 * (crews - 1)

  const residents: Resident[] = []
  /** Per resident: its crew's leader (resident index), member index, crew size and hash. */
  const leaderOf: number[] = []
  const memberOf: number[] = []
  const sizeOf: number[] = []
  const crewHash: number[] = []
  venues.forEach((venue, v) => {
    for (let slot = 0; slot < perVenue; slot++) {
      const { profile, hash, rng } = townsfolkProfile(seed, venue.id, slot, config)
      const crew = crewOfSlot(slot)
      leaderOf.push(v * perVenue + 2 * crew)
      memberOf.push(slot - 2 * crew)
      sizeOf.push(crewSize(crew))
      crewHash.push(hashInt(seed, hashString(venue.id), crew, 0x81))
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
  /** How strongly a place draws visitors by day and by night (`pull`, by its kind). */
  const pullDay = venues.map((venue) => config.pull[venue.kind ?? '']?.[0] ?? 1)
  const pullNight = venues.map((venue) => config.pull[venue.kind ?? '']?.[1] ?? 1)

  // A crew's members share one clock: their cycles start and end together.
  const offsetOf = (i: number) => hash01(seed, crewHash[i] ?? 0, 0x72) * config.epochS
  const epochOf = (i: number, tS: number) => Math.floor((tS + offsetOf(i)) / config.epochS)

  /** The night blend the next new choice is made under (latched per cycle, so never a jump). */
  let night = 0
  const pullOf = (v: number) => (pullDay[v] ?? 1) * (1 - night) + (pullNight[v] ?? 1) * night

  /**
   * Where a home's local (or crew) goes in a cycle: home (`homeShare`), else a place among home
   * and its neighbours weighted by their pull at this time of day.
   */
  const choose = (home: number, key: number, epoch: number, salt: number): number => {
    const near = neighbours[home] ?? []
    if (near.length === 0 || hash01(seed, key, epoch, salt) < config.homeShare) return home
    let total = pullOf(home)
    for (const v of near) total += pullOf(v)
    let pick = hash01(seed, key, epoch, salt + 1) * total - pullOf(home)
    if (pick < 0) return home
    for (const v of near) {
      pick -= pullOf(v)
      if (pick < 0) return v
    }
    return near[near.length - 1] ?? home
  }

  /**
   * A cycle's place is chosen once, under the night blend of the moment it is first needed (the
   * cycle before, for the walk there), and kept: dusk never re-routes a walk under way.
   */
  // Four cycles a slot: the one before, this one and the next are read together.
  const memoEpoch = new Float64Array(residents.length * 4).fill(Number.NaN)
  const memoVenue = new Int32Array(residents.length * 4)
  const latched = (slot: number, epoch: number, pickIt: () => number): number => {
    const k = slot * 4 + (epoch & 3)
    if (memoEpoch[k] === epoch) return memoVenue[k] ?? 0
    const venue = pickIt()
    memoEpoch[k] = epoch
    memoVenue[k] = venue
    return venue
  }
  const crewMemoEpoch = new Float64Array(residents.length * 4).fill(Number.NaN)
  const crewMemoVenue = new Int32Array(residents.length * 4)
  const latchedCrew = (leader: number, epoch: number, pickIt: () => number): number => {
    const k = leader * 4 + (epoch & 3)
    if (crewMemoEpoch[k] === epoch) return crewMemoVenue[k] ?? 0
    const venue = pickIt()
    crewMemoEpoch[k] = epoch
    crewMemoVenue[k] = venue
    return venue
  }

  /** Whether a crew meets up in a cycle (all its members at one place, in a huddle). */
  const together = (i: number, epoch: number) =>
    (sizeOf[i] ?? 1) > 1 && hash01(seed, crewHash[i] ?? 0, epoch, 0x82) < crewConfig.meetShare

  const venueIn = (i: number, r: Resident, epoch: number): number => {
    if (together(i, epoch)) {
      const leader = leaderOf[i] ?? i
      return latchedCrew(leader, epoch, () => choose(r.home, crewHash[i] ?? 0, epoch, 0x86))
    }
    return latched(i, epoch, () => choose(r.home, r.hash, epoch, 0x73))
  }

  /** The ring slot a local takes at a place: home slots are even, visitors take the odd gaps. */
  const slotAt = (r: Resident, venue: number) =>
    venue === r.home ? 2 * r.slot : 2 * (r.hash % perVenue) + 1

  const ringRadius =
    Math.max(config.minRingOfHeight, (config.spacingOfHeight * ringSlots) / (2 * Math.PI)) * h

  const centreX = (venue: number) => venues[venue]?.x ?? 0
  const centreY = (venue: number) => (venues[venue]?.y ?? 0) - config.frontM
  const angleOf = (r: Resident, venue: number) =>
    (ringTurn[venue] ?? 0) + (slotAt(r, venue) / ringSlots) * Math.PI * 2

  /** The door a local goes in and out of: just in front of the place's point. */
  const doorX = (venue: number) => centreX(venue)
  const doorY = (venue: number) => (venues[venue]?.y ?? 0) - config.inside.doorM
  /** How far past the door a local walks in while it fades. */
  const stepInM = config.inside.stepOfHeight * h

  // ---- benches (S04r2) ---------------------------------------------------------------------
  /**
   * One bench per crew behind each place's ring (between it and the building), facing the camera:
   * each seat belongs to one local of the place (its crew's bench, its place in the crew), so two
   * sitters never share a seat. Only on tiers that bake the `sit` pose.
   */
  const sits = has('sit')
  const benchConfig = config.bench
  const benches: TownsfolkBench[] = []
  /** The index of each place's first bench, or -1 (a place sharing its spot has none). */
  const firstBench: number[] = []
  if (sits) {
    const clear = (2 * benchConfig.apartOfHeight + 3 * benchConfig.seatOfHeight) * h
    venues.forEach((venue, v) => {
      // Two places drawn at one spot would share their benches: only the first gets them.
      const crowded = venues.some(
        (other, u) => u < v && Math.hypot(other.x - venue.x, other.y - venue.y) < clear,
      )
      firstBench.push(crowded ? -1 : benches.length)
      if (crowded) return
      for (let c = 0; c < crews; c++) {
        const side = crews === 1 ? -0.5 : c - (crews - 1) / 2
        benches.push({
          venue: v,
          x: centreX(v) + side * 2 * benchConfig.apartOfHeight * h,
          y: centreY(v) + ringRadius + benchConfig.behindOfHeight * h,
          yaw: 0,
        })
      }
    })
  }
  /** Writes a resident's seat on its crew's bench at home into `out` (sitting `yawTurn` in). */
  const seatOf = (i: number, r: Resident, out: Stay, crewTurn: boolean): void => {
    const index = (firstBench[r.home] ?? 0) + crewOfSlot(r.slot)
    const bench = benches[index]
    const size = sizeOf[i] ?? 1
    const k = (memberOf[i] ?? 0) - (size - 1) / 2
    out.bench = index
    out.seat = k * benchConfig.seatOfHeight
    const along = out.seat * h
    const yaw = bench?.yaw ?? 0
    out.x = (bench?.x ?? 0) + Math.cos(yaw) * along
    out.y = (bench?.y ?? 0) - Math.sin(yaw) * along
    // A crew turns in to each other: the one on the left a little right, and so on.
    out.sitYaw = yaw - (crewTurn ? Math.sign(k) * benchConfig.turnInRad : 0)
    out.fx = out.x + Math.sin(out.sitYaw)
    out.fy = out.y - Math.cos(out.sitYaw)
  }

  /** Writes the stay of resident `i` in `epoch` into `out`. */
  const stayOf = (i: number, r: Resident, epoch: number, out: Stay): Stay => {
    const venue = venueIn(i, r, epoch)
    out.venue = venue
    out.crew = -1
    out.bench = -1
    out.seat = 0
    out.sitYaw = 0
    if (together(i, epoch)) {
      if (
        sits &&
        venue === r.home &&
        (firstBench[r.home] ?? -1) >= 0 &&
        hash01(seed, crewHash[i] ?? 0, epoch, 0x8b) < benchConfig.crewShare
      ) {
        // The crew sits together on its bench at home.
        seatOf(i, r, out, true)
        out.kind = 'crew'
        out.crew = leaderOf[i] ?? i
        return out
      }
      // A huddle just outside the ring, where the leader's ring spot is: members face its middle.
      const leader = residents[leaderOf[i] ?? i] ?? r
      const theta = angleOf(leader, venue)
      const out1 = ringRadius + crewConfig.outOfHeight * h
      out.fx = centreX(venue) + Math.sin(theta) * out1
      out.fy = centreY(venue) + Math.cos(theta) * out1
      const size = sizeOf[i] ?? 1
      const phi = theta + Math.PI / 2 + ((memberOf[i] ?? 0) / size) * Math.PI * 2
      const rad = crewConfig.huddleOfHeight * h
      out.x = out.fx + Math.sin(phi) * rad
      out.y = out.fy + Math.cos(phi) * rad
      out.kind = 'crew'
      out.crew = leaderOf[i] ?? i
      return out
    }
    if (
      sits &&
      venue === r.home &&
      (firstBench[r.home] ?? -1) >= 0 &&
      hash01(seed, r.hash, epoch, 0x8c) < benchConfig.soloShare
    ) {
      seatOf(i, r, out, false)
      out.kind = 'bench'
      return out
    }
    if (hash01(seed, r.hash, epoch, 0x83) < config.inside.share) {
      out.kind = 'inside'
      out.x = doorX(venue)
      out.y = doorY(venue)
      out.fx = out.x
      out.fy = out.y + 1
      return out
    }
    const theta = angleOf(r, venue)
    out.kind = 'ring'
    out.x = centreX(venue) + Math.sin(theta) * ringRadius
    out.y = centreY(venue) + Math.cos(theta) * ringRadius
    out.fx = centreX(venue)
    out.fy = centreY(venue)
    return out
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

  /**
   * The sidewalk polyline from one place's street node to another's, or null. `lane` (metres,
   * right of the walking direction) spreads a crew walking together side by side.
   */
  const routes = new Map<string, XY[] | null>()
  const routeOf = (from: number, to: number, lane: number): XY[] | null => {
    const key = `${from}>${to}>${Math.round(lane * 100)}`
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
          const sidewalk = edge.halfWidthM + config.sidewalkOfHeight * h + lane
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

  /** A walk at a constant cruising pace (at least `speed`) along smoothed points. */
  const walkAlong = (points: readonly XY[], streets: boolean, fitS: number): TownsfolkWalk => {
    const path = makePath(smoothPolyline(points, 3))
    // A long way round (the straight fallback's S) walks a little faster to fit the cycle.
    const pace = Math.max(speed, path.length / Math.max(1, fitS))
    const ease = Math.min(config.easeS, path.length / pace)
    return {
      path,
      speedMps: pace,
      durationS: path.length / pace + ease + 2 * config.turnS,
      streets,
    }
  }

  const sa = newStay()
  const sb = newStay()
  const sc = newStay()

  /** The walk that ends a resident's stay in `epoch`, cached for the cycle in progress. */
  const walks = new Map<number, { epoch: number; walk: TownsfolkWalk | null }>()
  const walkFor = (index: number, r: Resident, epoch: number): TownsfolkWalk | null => {
    const cached = walks.get(index)
    if (cached !== undefined && cached.epoch === epoch) return cached.walk
    const here = stayOf(index, r, epoch, newStay())
    const next = stayOf(index, r, epoch + 1, newStay())
    const from = here.venue
    const to = next.venue
    const a: XY = { x: here.x, y: here.y }
    const b: XY = { x: next.x, y: next.y }
    let walk: TownsfolkWalk | null = null
    const fitS = maxWalkS - 2 * config.turnS - config.easeS
    if (from === to) {
      // Across the same place (to a huddle, the door or back): a short, gently bent walk.
      const d = Math.hypot(b.x - a.x, b.y - a.y)
      if (d > 0.05 * h) {
        const bend = (hash01(seed, r.hash, epoch, 0x87) - 0.5) * 0.4
        const mid = {
          x: (a.x + b.x) / 2 + (b.y - a.y) * bend,
          y: (a.y + b.y) / 2 - (b.x - a.x) * bend,
        }
        walk = walkAlong([a, mid, b], false, fitS)
      }
    } else {
      // A crew leaving together walks side by side: each member a lane of its own.
      const side =
        here.kind === 'crew' && next.kind === 'crew' && here.crew === next.crew
          ? ((memberOf[index] ?? 0) - ((sizeOf[index] ?? 1) - 1) / 2) * crewConfig.laneOfHeight * h
          : 0
      const straight = Math.hypot(b.x - a.x, b.y - a.y)
      const route = routeOf(from, to, side)
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
        const inner: XY[] = [ga, { x: ga.x, y: my }, { x: gb.x, y: my }, gb]
        const lanes =
          side === 0
            ? inner
            : offsetPolyline(
                inner,
                inner.map(() => side),
              ).points
        points = [a, ...lanes, b]
      }
      walk = walkAlong(points, streets, fitS)
    }
    walks.set(index, { epoch, walk })
    return walk
  }

  /**
   * A stroll in the middle of a ring stay (S04r): out round a point near the place and back to
   * the same spot, a loop rather than an about-turn. Null when the stay has no room for one.
   */
  const strolls = new Map<number, { epoch: number; start: number; walk: TownsfolkWalk | null }>()
  const strollFor = (index: number, r: Resident, epoch: number, stay: Stay, leaveS: number) => {
    const cached = strolls.get(index)
    if (cached !== undefined && cached.epoch === epoch) return cached
    let walk: TownsfolkWalk | null = null
    let start = 0
    if (hash01(seed, r.hash, epoch, 0x88) < config.stroll.share) {
      const psi = hash01(seed, r.hash, epoch, 0x89) * Math.PI * 2
      const reach = ringRadius + config.stroll.outOfHeight * h
      const tx = centreX(stay.venue) + Math.sin(psi) * reach
      const ty = centreY(stay.venue) + Math.cos(psi) * reach
      const dx = tx - stay.x
      const dy = ty - stay.y
      const mx = (stay.x + tx) / 2
      const my = (stay.y + ty) / 2
      const w = config.stroll.loopShare
      const a: XY = { x: stay.x, y: stay.y }
      const loop = walkAlong(
        [
          a,
          { x: mx + dy * w, y: my - dx * w },
          { x: tx, y: ty },
          { x: mx - dy * w, y: my + dx * w },
          a,
        ],
        false,
        Infinity,
      )
      const room = leaveS - loop.durationS - 2 * config.segmentS
      if (room > 0) {
        walk = loop
        start = config.segmentS + hash01(seed, r.hash, epoch, 0x8a) * room
      }
    }
    const entry = { epoch, start, walk }
    strolls.set(index, entry)
    return entry
  }

  /** A ring stay's pose in segment `seg`: idle, talking to the ring, or waving at the camera. */
  const segmentPose = (r: Resident, epoch: number, seg: number, crew: boolean): TownsfolkPose => {
    const roll = hash01(seed, r.hash, epoch, 0x90 + seg)
    if (crew) return roll < crewConfig.talkShare ? talking : standing
    if (has('talk') && roll < config.poseShare.talk) return 'talk'
    if (has('wave') && roll < config.poseShare.talk + config.poseShare.wave) return 'wave'
    return standing
  }

  /** A ring stay's yaw through segment `seg` (talk: to the ring's centre; else the camera's way). */
  const segmentYaw = (r: Resident, epoch: number, seg: number, stay: Stay): number => {
    if (segmentPose(r, epoch, seg, false) === 'talk')
      return faceTo(stay.x, stay.y, stay.fx, stay.fy)
    return (hash01(seed, r.hash, epoch, 0xa0 + seg) * 2 - 1) * config.faceJitterRad
  }

  /** Where a standing local faces at `tau` into its stay (turning between segments). */
  const yawAt = (r: Resident, epoch: number, stay: Stay, tau: number, leaveS: number): number => {
    if (stay.bench >= 0) return stay.sitYaw
    if (stay.kind === 'crew') return faceTo(stay.x, stay.y, stay.fx, stay.fy)
    if (stay.kind === 'inside') return tau <= 0 ? NORTH : SOUTH
    const t = Math.max(0, Math.min(leaveS, tau))
    const seg = Math.floor(t / config.segmentS)
    const yaw = segmentYaw(r, epoch, seg, stay)
    if (seg === 0) return yaw
    const into = t - seg * config.segmentS
    return turnTowards(segmentYaw(r, epoch, seg - 1, stay), yaw, into / config.turnS)
  }

  const samples: TownsfolkSample[] = []
  const at = { x: 0, y: 0, dx: 0, dy: 1 }

  /** A local `t` seconds into a walk: turning off, easing along, turning to `toYaw` on arrival. */
  const writeWalk = (
    out: TownsfolkSample,
    walk: TownsfolkWalk,
    t: number,
    fromYaw: number,
    toYaw: number,
  ): void => {
    const path = walk.path
    const lookM = config.turnLookOfHeight * h
    const moveS = walk.durationS - 2 * config.turnS
    out.pose = walking
    if (t < config.turnS) {
      // Turning on the spot towards the way out, already stepping.
      sampleAt(path, 0, at)
      out.x = at.x
      out.y = at.y
      out.yaw = turnTowards(fromYaw, headingAt(path, lookM, lookM), t / config.turnS)
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
    // Arrived: turning to the pose held next (where the next stay or stand starts).
    sampleAt(path, path.length, at)
    out.x = at.x
    out.y = at.y
    out.yaw = turnTowards(
      headingAt(path, path.length - lookM, lookM),
      toYaw,
      (t - config.turnS - moveS) / config.turnS,
    )
  }

  /** Writes one local at city time `tS`; false while it is inside (not drawn). */
  const write = (out: TownsfolkSample, index: number, r: Resident, tS: number): boolean => {
    const shifted = tS + offsetOf(index)
    const epoch = Math.floor(shifted / config.epochS)
    const tau = shifted - epoch * config.epochS
    const stay = stayOf(index, r, epoch, sa)
    const walk = walkFor(index, r, epoch)
    const leaveS = config.epochS - (walk?.durationS ?? 0)
    out.resident = index
    out.speed = 0
    out.fade = 1
    out.bench = -1
    out.seat = 0
    if (walk !== null && tau >= leaveS) {
      const next = stayOf(index, r, epoch + 1, sb)
      const toYaw = yawAt(r, epoch + 1, next, 0, config.epochS)
      // `next` is scratch: read the leaving yaw from this stay again (sa still holds it).
      writeWalk(out, walk, tau - leaveS, yawAt(r, epoch, stay, leaveS, leaveS), toYaw)
      return true
    }
    if (stay.kind === 'inside') {
      // In at the door at the start, out of it at the end; inside (not drawn) in between.
      const prev = stayOf(index, r, epoch - 1, sb)
      const cameIn = !(prev.kind === 'inside' && prev.venue === stay.venue)
      const next = stayOf(index, r, epoch + 1, sc)
      const goesOut = !(next.kind === 'inside' && next.venue === stay.venue)
      const fadeS = Math.min(config.inside.fadeS, leaveS / 2)
      let u = -1
      if (cameIn && tau < fadeS) {
        u = tau / fadeS
        out.yaw = NORTH
      } else if (goesOut && tau > leaveS - fadeS) {
        u = (leaveS - tau) / fadeS
        out.yaw = SOUTH
      }
      if (u < 0) return false
      out.x = stay.x
      out.y = stay.y + u * stepInM
      out.pose = walking
      out.fade = 1 - u
      out.speed = fadeS > 0 ? stepInM / fadeS : 0
      return true
    }
    out.x = stay.x
    out.y = stay.y
    if (stay.kind === 'bench') {
      out.yaw = stay.sitYaw
      out.pose = 'sit'
      out.bench = stay.bench
      out.seat = stay.seat
      return true
    }
    if (stay.kind === 'crew') {
      out.yaw = stay.bench >= 0 ? stay.sitYaw : faceTo(stay.x, stay.y, stay.fx, stay.fy)
      // Hello as they meet; goodbye before they part (a crew leaving together just goes).
      const prev = stayOf(index, r, epoch - 1, sb)
      const met = Math.hypot(prev.x - stay.x, prev.y - stay.y) > 0.05 * h
      const next = stayOf(index, r, epoch + 1, sc)
      const parts = walk !== null && !(next.kind === 'crew' && next.crew === stay.crew)
      if (has('wave') && ((met && tau < config.waveS) || (parts && tau >= leaveS - config.waveS))) {
        out.pose = 'wave'
        return true
      }
      if (stay.bench >= 0) {
        out.pose = 'sit'
        out.bench = stay.bench
        out.seat = stay.seat
        return true
      }
      out.pose = segmentPose(r, epoch, Math.floor(tau / config.segmentS), true)
      return true
    }
    const stroll = strollFor(index, r, epoch, stay, leaveS)
    if (stroll.walk !== null && tau >= stroll.start && tau < stroll.start + stroll.walk.durationS) {
      const end = stroll.start + stroll.walk.durationS
      writeWalk(
        out,
        stroll.walk,
        tau - stroll.start,
        yawAt(r, epoch, stay, stroll.start, leaveS),
        yawAt(r, epoch, stay, end, leaveS),
      )
      return true
    }
    out.pose = segmentPose(r, epoch, Math.floor(Math.min(tau, leaveS) / config.segmentS), false)
    out.yaw = yawAt(r, epoch, stay, tau, leaveS)
    return true
  }

  /**
   * Small reactions (S04r): a local standing idle waves while another (not of its crew) walks
   * past within `passWave.radiusOfHeight`.
   */
  const reactRadius = passWave.radiusOfHeight * h
  const react = (n: number): void => {
    if (!has('wave') || passWave.share <= 0) return
    for (let i = 0; i < n; i++) {
      const s = samples[i]
      if (s === undefined || s.pose !== standing || s.speed > 0 || s.fade < 1) continue
      const r = residents[s.resident]
      if (r === undefined || hash01(seed, r.hash, 0x84) >= passWave.share) continue
      for (let j = 0; j < n; j++) {
        const w = samples[j]
        if (w === undefined || j === i || w.speed <= 0 || w.fade < 1) continue
        if (leaderOf[w.resident] === leaderOf[s.resident]) continue
        const dx = w.x - s.x
        const dy = w.y - s.y
        if (dx * dx + dy * dy <= reactRadius * reactRadius) {
          s.pose = 'wave'
          break
        }
      }
    }
  }

  return {
    residents,
    samples,
    benches,
    collect(x, y, radiusM, tS, share, nightBlend = 0) {
      night = Math.max(0, Math.min(1, nightBlend))
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
          sample = {
            resident: 0,
            x: 0,
            y: 0,
            yaw: 0,
            pose: standing,
            speed: 0,
            fade: 1,
            bench: -1,
            seat: 0,
          }
          samples.push(sample)
        }
        if (write(sample, i, r, tS)) n++
      }
      react(n)
      return n
    },
    venueAt(resident, tS) {
      const r = residents[resident]
      return r === undefined ? -1 : venueIn(resident, r, epochOf(resident, tS))
    },
    walkOf(resident, tS) {
      const r = residents[resident]
      return r === undefined ? null : walkFor(resident, r, epochOf(resident, tS))
    },
    stayAt(resident, tS) {
      const r = residents[resident]
      if (r === undefined) return null
      const stay = stayOf(resident, r, epochOf(resident, tS), sc)
      return { venue: stay.venue, kind: stay.kind, crew: stay.crew }
    },
  }
}
