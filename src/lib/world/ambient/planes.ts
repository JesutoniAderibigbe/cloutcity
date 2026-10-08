/**
 * The sky over the living city (S04q): airliners on long, smooth arcs into and out of the two
 * Queens airports (LaGuardia's runway 4 approach over Brooklyn and Queens, its runway 13
 * departures, JFK's runway 31 arrivals over the bay and runway 22 departures over the harbour, a
 * high crossing) and a sightseeing helicopter looping over Manhattan. Scenery only, never players.
 *
 * Each route (data/config/ambient.json `planes.routes`) is a list of lon/lat/altitude waypoints
 * turned into one smooth curve (centripetal Catmull-Rom, sampled by arc length). Flight k of a
 * route takes off from its first waypoint at `offsetS + k × headwayS` and flies the curve at
 * `speedMps`, so where every aircraft is stays a pure function of the city clock: a reload or
 * another device shows the same plane at the same spot. A route whose flight lasts longer than
 * its headway always has a plane in the air (DEC-52: the city is always alive). A closed route
 * (the helicopter) loops for ever instead.
 *
 * Real routes rarely cross the small patch of city a phone shows, so the sky also has passing
 * flights (`planes.passing`): each `cellM` square of the city sends one across itself every
 * `headwayS`, on a straight line through a hashed point near its middle, heading for (or away
 * from) the nearest airport, descending or climbing on the way, like traffic in the airports'
 * flows. The camera's square and its eight neighbours are flown, so a plane in sight never
 * vanishes because the camera moved one square over; who flies where is again a pure function of
 * the seed, the square and the clock.
 *
 * Altitudes are map altitudes, compressed like the game map's buildings, so a plane passes below
 * the default camera and crosses the screen instead of flying over it unseen.
 */
import { project } from '@/lib/geo/projection'
import { hash01, headingAt, makePath, sampleAt, yawOf, type Path, type XY } from './path'
import type { AmbientTier, PlanesConfig, PlaneRouteConfig } from './types'

export type AircraftKind = 'plane' | 'helicopter'

/** One aircraft now. Mutable and reused (no allocation per tick). */
export interface AircraftSample {
  kind: AircraftKind
  /** `${route}#${flight}`: stable for a flight's whole life. */
  id: string
  x: number
  y: number
  /** Metres above the land top. */
  alt: number
  yaw: number
  /** Nose up, radians. */
  pitch: number
  /** Right wing down, radians (a coordinated turn). */
  bank: number
  /** 0..1: grows in after take-off and shrinks away on landing, so nothing pops. */
  fade: number
  /** Seconds into the flight (lights blink and rotors spin from it). */
  age: number
}

interface Route {
  readonly id: string
  readonly kind: AircraftKind
  readonly path: Path
  /** Altitude at each path vertex. */
  readonly alts: Float64Array
  readonly speed: number
  readonly headwayS: number
  readonly offsetS: number
  readonly closed: boolean
  readonly durationS: number
}

export interface PlaneSim {
  readonly routes: readonly { readonly id: string; readonly durationS: number }[]
  readonly samples: readonly AircraftSample[]
  /**
   * Writes the aircraft in the air at city time `tS` into `samples`, nearest to (x, y) first,
   * at most the tier's planes and helicopters, and returns how many.
   */
  collect(x: number, y: number, tS: number): number
}

/** Centripetal Catmull-Rom through the points (x, y, alt), `per` samples a span, ends kept. */
export function smoothCurve(
  points: readonly (readonly [number, number, number])[],
  per: number,
  closed: boolean,
): [number, number, number][] {
  const n = points.length
  if (n < 2) return points.map((p) => [p[0], p[1], p[2]])
  const at = (i: number) => {
    if (closed) return points[((i % n) + n) % n] ?? points[0]
    if (i < 0) {
      // Mirror the first span so the curve leaves the first point along it.
      const a = points[0] ?? [0, 0, 0]
      const b = points[1] ?? a
      return [2 * a[0] - b[0], 2 * a[1] - b[1], 2 * a[2] - b[2]] as const
    }
    if (i >= n) {
      const a = points[n - 1] ?? [0, 0, 0]
      const b = points[n - 2] ?? a
      return [2 * a[0] - b[0], 2 * a[1] - b[1], 2 * a[2] - b[2]] as const
    }
    return points[i]
  }
  const out: [number, number, number][] = []
  const spans = closed ? n : n - 1
  for (let s = 0; s < spans; s++) {
    const p0 = at(s - 1) ?? [0, 0, 0]
    const p1 = at(s) ?? [0, 0, 0]
    const p2 = at(s + 1) ?? [0, 0, 0]
    const p3 = at(s + 2) ?? [0, 0, 0]
    const knot = (a: readonly number[], b: readonly number[]) =>
      Math.sqrt(Math.hypot((b[0] ?? 0) - (a[0] ?? 0), (b[1] ?? 0) - (a[1] ?? 0))) || 1e-6
    const t1 = knot(p0, p1)
    const t2 = t1 + knot(p1, p2)
    const t3 = t2 + knot(p2, p3)
    for (let k = 0; k < per; k++) {
      const t = t1 + ((t2 - t1) * k) / per
      const point: [number, number, number] = [0, 0, 0]
      for (let d = 0; d < 3; d++) {
        const a1 = ((t1 - t) * (p0[d] ?? 0)) / t1 + (t * (p1[d] ?? 0)) / t1
        const a2 = ((t2 - t) * (p1[d] ?? 0) + (t - t1) * (p2[d] ?? 0)) / (t2 - t1)
        const a3 = ((t3 - t) * (p2[d] ?? 0) + (t - t2) * (p3[d] ?? 0)) / (t3 - t2)
        const b1 = ((t2 - t) * a1 + t * a2) / t2
        const b2 = ((t3 - t) * a2 + (t - t1) * a3) / (t3 - t1)
        point[d] = ((t2 - t) * b1 + (t - t1) * b2) / (t2 - t1)
      }
      out.push(point)
    }
  }
  const last = closed ? points[0] : points[n - 1]
  if (last !== undefined) out.push([last[0], last[1], last[2]])
  return out
}

function buildRoute(config: PlaneRouteConfig, planes: PlanesConfig): Route {
  const kind: AircraftKind = config.kind === 'helicopter' ? 'helicopter' : 'plane'
  const projected = config.points.map(([lng, lat, alt]) => {
    const p = project({ lat, lng })
    return [p.x, p.y, alt] as const
  })
  const curve = smoothCurve(projected, planes.samplesPerSpan, config.closed)
  const path = makePath(curve.map(([x, y]) => ({ x, y })))
  const alts = Float64Array.from(curve.map((p) => p[2]))
  const speed = kind === 'helicopter' ? planes.helicopter.speedMps : planes.speedMps
  return {
    id: config.id,
    kind,
    path,
    alts,
    speed,
    headwayS: config.headwayS,
    offsetS: config.offsetS,
    closed: config.closed,
    durationS: path.length / speed,
  }
}

/** Altitude at arc `s` (linear between the curve's samples). */
function altitudeAt(route: Route, s: number): number {
  const { arc } = route.path
  let lo = 0
  let hi = arc.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if ((arc[mid] ?? 0) <= s) lo = mid
    else hi = mid
  }
  const a = arc[lo] ?? 0
  const b = arc[hi] ?? a
  const u = b > a ? Math.max(0, Math.min(1, (s - a) / (b - a))) : 0
  return (route.alts[lo] ?? 0) * (1 - u) + (route.alts[hi] ?? 0) * u
}

const wrapAngle = (a: number) => {
  let d = a % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

export function createPlaneSim(config: PlanesConfig, tier: AmbientTier, seed: number): PlaneSim {
  const routes = config.routes.map((route) => buildRoute(route, config))
  const passing = config.passing
  const airports = passing.airports.map(([lng, lat]) => project({ lat, lng }))
  const passS = passing.lengthM / config.speedMps
  const maxPlanes = config.maxShown[tier]
  const maxHelicopters = config.helicopters[tier]
  const samples: AircraftSample[] = []
  const scratch: AircraftSample[] = []
  const point: XY & { dx: number; dy: number } = { x: 0, y: 0, dx: 0, dy: 1 }
  const look = config.lookM

  const sampleOf = (i: number): AircraftSample => {
    let sample = scratch[i]
    if (sample === undefined) {
      sample = {
        kind: 'plane',
        id: '',
        x: 0,
        y: 0,
        alt: 0,
        yaw: 0,
        pitch: 0,
        bank: 0,
        fade: 1,
        age: 0,
      }
      scratch.push(sample)
    }
    return sample
  }

  const front = { x: 0, y: 0, dx: 0, dy: 1 }
  const back = { x: 0, y: 0, dx: 0, dy: 1 }
  /** The heading at `s` from the chord over ±`lookM`, wrapping round a closed route. */
  const headingOn = (route: Route, s: number): number => {
    const length = route.path.length
    if (!route.closed) return headingAt(route.path, s, look)
    sampleAt(route.path, (((s + look) % length) + length) % length, front)
    sampleAt(route.path, (((s - look) % length) + length) % length, back)
    return yawOf(front.x - back.x, front.y - back.y)
  }

  const write = (out: AircraftSample, route: Route, flight: number, age: number) => {
    const length = route.path.length
    const s = route.closed ? (age * route.speed) % length : Math.min(length, age * route.speed)
    sampleAt(route.path, s, point)
    out.kind = route.kind
    out.id = `${route.id}#${flight}`
    out.x = point.x
    out.y = point.y
    out.alt = altitudeAt(route, s)
    const ahead = route.closed ? (s + look) % length : Math.min(length, s + look)
    const behind = route.closed ? (s - look + length) % length : Math.max(0, s - look)
    out.yaw = headingOn(route, s)
    const climb = altitudeAt(route, ahead) - altitudeAt(route, behind)
    const span = ahead >= behind ? ahead - behind : ahead + length - behind
    out.pitch = Math.atan2(climb, Math.max(1, span))
    // Bank into the turn: the heading's change over the look-ahead, scaled and capped.
    const turn = wrapAngle(headingAt(route.path, ahead, look) - headingAt(route.path, behind, look))
    out.bank = Math.max(-config.maxBankRad, Math.min(config.maxBankRad, turn * config.bankGain))
    out.age = age
    if (route.closed) {
      out.fade = 1
    } else {
      const left = route.durationS - age
      const u = Math.min(1, age / config.fadeS, left / config.fadeS)
      out.fade = Math.max(0, u * u * (3 - 2 * u))
    }
  }

  /** Passing flight `k` over square (cx, cy), `age` seconds after it entered its line. */
  const writePass = (out: AircraftSample, cx: number, cy: number, k: number, age: number) => {
    const roll = (salt: number) => hash01(seed, cx * 92821 + cy, k, salt)
    const mx = (cx + 0.5 + (roll(1) * 2 - 1) * passing.jitter) * passing.cellM
    const my = (cy + 0.5 + (roll(2) * 2 - 1) * passing.jitter) * passing.cellM
    let near = airports[0] ?? { x: 0, y: 0 }
    for (const airport of airports) {
      if (Math.hypot(airport.x - mx, airport.y - my) < Math.hypot(near.x - mx, near.y - my)) {
        near = airport
      }
    }
    const arriving = roll(3) < 0.5
    const toward =
      Math.atan2(near.x - mx, near.y - my) + (roll(4) * 2 - 1) * passing.headingJitterRad
    const angle = arriving ? toward : toward + Math.PI
    const dx = Math.sin(angle)
    const dy = Math.cos(angle)
    const u = Math.max(0, Math.min(1, age / passS))
    const along = (u - 0.5) * passing.lengthM
    const [low, high] = passing.altM
    const climb = (high - low) / passing.lengthM
    out.kind = 'plane'
    out.id = `pass-${cx}-${cy}#${k}`
    out.x = mx + dx * along
    out.y = my + dy * along
    out.alt = arriving ? high - (high - low) * u : low + (high - low) * u
    out.yaw = yawOf(dx, dy)
    out.pitch = Math.atan(arriving ? -climb : climb)
    out.bank = 0
    out.age = age
    const w = Math.min(1, age / config.fadeS, (passS - age) / config.fadeS)
    out.fade = Math.max(0, w * w * (3 - 2 * w))
  }

  return {
    routes: routes.map((route) => ({ id: route.id, durationS: route.durationS })),
    samples,
    collect(x, y, tS) {
      let n = 0
      for (const route of routes) {
        const quota = route.kind === 'helicopter' ? maxHelicopters : maxPlanes
        if (quota === 0) continue
        if (route.closed) {
          const sample = sampleOf(n++)
          write(sample, route, 0, Math.max(0, tS - route.offsetS))
          continue
        }
        // The flights airborne now: those that left within the last duration.
        const since = tS - route.offsetS
        const newest = Math.floor(since / route.headwayS)
        const oldest = Math.ceil((since - route.durationS) / route.headwayS)
        for (let k = Math.max(oldest, newest - 8); k <= newest; k++) {
          const age = since - k * route.headwayS
          if (age < 0 || age >= route.durationS) continue
          write(sampleOf(n++), route, k, age)
        }
      }
      const cx = Math.floor(x / passing.cellM)
      const cy = Math.floor(y / passing.cellM)
      for (let ix = cx - 1; ix <= cx + 1; ix++) {
        for (let iy = cy - 1; iy <= cy + 1; iy++) {
          const since = tS - hash01(seed, ix * 92821 + iy, 0, 7) * passing.headwayS
          const newest = Math.floor(since / passing.headwayS)
          const oldest = Math.ceil((since - passS) / passing.headwayS)
          for (let k = Math.max(oldest, newest - 8); k <= newest; k++) {
            const age = since - k * passing.headwayS
            if (age < 0 || age >= passS) continue
            writePass(sampleOf(n++), ix, iy, k, age)
          }
        }
      }
      // Nearest the camera target first, then each kind up to its tier's count.
      const live = scratch.slice(0, n)
      live.sort(
        (a, b) =>
          Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y) || (a.id < b.id ? -1 : 1),
      )
      let planes = 0
      let helicopters = 0
      samples.length = 0
      for (const sample of live) {
        if (sample.kind === 'helicopter') {
          if (helicopters >= maxHelicopters) continue
          helicopters++
        } else {
          if (planes >= maxPlanes) continue
          planes++
        }
        samples.push(sample)
      }
      return samples.length
    },
  }
}
