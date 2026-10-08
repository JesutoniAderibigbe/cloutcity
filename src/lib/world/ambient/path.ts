/**
 * Polylines for the ambient sim (S04l): measured paths sampled by arc length with no allocation,
 * a lane/sidewalk offset with mitred corners, and the seeded hashes every draw comes from.
 *
 * The hashes reuse src/lib/world/streetProps.ts (`mixSeed`, `createRng`), which already ships in
 * the lazy street chunks, rather than src/engine: see that module's note on bundling.
 */
import { mixSeed } from '../streetProps'

export interface XY {
  readonly x: number
  readonly y: number
}

/** A polyline with its cumulative arc lengths, in flat typed arrays. */
export interface Path {
  readonly xs: Float64Array
  readonly ys: Float64Array
  /** arc[i]: metres from the first point to point i. */
  readonly arc: Float64Array
  readonly length: number
}

export function makePath(points: readonly XY[]): Path {
  const n = points.length
  const xs = new Float64Array(n)
  const ys = new Float64Array(n)
  const arc = new Float64Array(n)
  let total = 0
  for (let i = 0; i < n; i++) {
    const p = points[i] ?? { x: 0, y: 0 }
    xs[i] = p.x
    ys[i] = p.y
    if (i > 0) total += Math.hypot(p.x - (xs[i - 1] ?? 0), p.y - (ys[i - 1] ?? 0))
    arc[i] = total
  }
  return { xs, ys, arc, length: total }
}

/** Mutable sample: a point and the unit direction of its segment. */
export interface PathSample {
  x: number
  y: number
  dx: number
  dy: number
}

export const createSample = (): PathSample => ({ x: 0, y: 0, dx: 0, dy: 1 })

/** Index of the segment holding arc `s` (binary search), clamped to the path. */
function segmentOf(path: Path, s: number): number {
  const { arc } = path
  let lo = 0
  let hi = arc.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if ((arc[mid] ?? 0) <= s) lo = mid
    else hi = mid
  }
  return lo
}

/** Writes the point `s` metres along the path (clamped to its ends) and its direction. */
export function sampleAt(path: Path, s: number, out: PathSample): PathSample {
  const n = path.xs.length
  if (n === 0) {
    out.x = 0
    out.y = 0
    return out
  }
  if (n === 1) {
    out.x = path.xs[0] ?? 0
    out.y = path.ys[0] ?? 0
    return out
  }
  const i = segmentOf(path, Math.max(0, Math.min(path.length, s)))
  const ax = path.xs[i] ?? 0
  const ay = path.ys[i] ?? 0
  const bx = path.xs[i + 1] ?? ax
  const by = path.ys[i + 1] ?? ay
  const span = (path.arc[i + 1] ?? 0) - (path.arc[i] ?? 0)
  const t = span <= 0 ? 0 : Math.max(0, Math.min(1, (s - (path.arc[i] ?? 0)) / span))
  out.x = ax + (bx - ax) * t
  out.y = ay + (by - ay) * t
  if (span > 0) {
    out.dx = (bx - ax) / span
    out.dy = (by - ay) / span
  }
  return out
}

/** Rotation about +y that turns a model's +z (nose) to the local direction (dx, dy). */
export const yawOf = (dx: number, dy: number) => Math.atan2(dx, -dy)

const ahead = createSample()
const behind = createSample()

/**
 * The heading at `s`, from the chord between `s - lookM` and `s + lookM`: a car or a walker
 * swings round a mitred corner instead of snapping to the next segment's direction.
 */
export function headingAt(path: Path, s: number, lookM: number, sign = 1): number {
  sampleAt(path, s + lookM, ahead)
  sampleAt(path, s - lookM, behind)
  const dx = (ahead.x - behind.x) * sign
  const dy = (ahead.y - behind.y) * sign
  if (dx === 0 && dy === 0) return yawOf(ahead.dx * sign, ahead.dy * sign)
  return yawOf(dx, dy)
}

/**
 * Offsets a polyline sideways, segment by segment: `signed[i]` metres to the right of segment
 * i's direction (negative: to the left). Each inner vertex moves to where its two offset
 * segments meet (a mitre), capped at `mitreMax` × the larger offset so a hairpin cannot spike.
 * A reversal (a U-turn at a dead end, where both segments are parallel and opposed) keeps two
 * points, one per side. Returns the points and, for each input vertex, its output index.
 */
export function offsetPolyline(
  points: readonly XY[],
  signed: readonly number[],
  mitreMax = 3,
): { points: XY[]; index: number[] } {
  const out: XY[] = []
  const index: number[] = []
  const n = points.length
  const dir = (i: number) => {
    const a = points[i] ?? { x: 0, y: 0 }
    const b = points[i + 1] ?? a
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }
  }
  for (let i = 0; i < n; i++) {
    const p = points[i] ?? { x: 0, y: 0 }
    index.push(out.length)
    if (n === 1) {
      out.push(p)
      continue
    }
    if (i === 0 || i === n - 1) {
      const seg = i === 0 ? 0 : n - 2
      const d = dir(seg)
      const o = signed[seg] ?? 0
      // Right of (dx, dy) is (dy, -dx).
      out.push({ x: p.x + d.y * o, y: p.y - d.x * o })
      continue
    }
    const d1 = dir(i - 1)
    const d2 = dir(i)
    const o1 = signed[i - 1] ?? 0
    const o2 = signed[i] ?? 0
    const a = { x: p.x + d1.y * o1, y: p.y - d1.x * o1 }
    const b = { x: p.x + d2.y * o2, y: p.y - d2.x * o2 }
    const cross = d1.x * d2.y - d1.y * d2.x
    const dot = d1.x * d2.x + d1.y * d2.y
    if (Math.abs(cross) < 1e-3) {
      if (dot < 0) {
        out.push(a, b)
      } else {
        out.push(b)
      }
      continue
    }
    // Line a + d1·u meets line b + d2·v.
    const u = ((b.x - a.x) * d2.y - (b.y - a.y) * d2.x) / cross
    const m = { x: a.x + d1.x * u, y: a.y + d1.y * u }
    const cap = mitreMax * Math.max(Math.abs(o1), Math.abs(o2), 0.5)
    if (Math.hypot(m.x - p.x, m.y - p.y) > cap) out.push(a, b)
    else out.push(m)
  }
  return { points: out, index }
}

/** Shortest distance from a point to the segment a–b. */
export function segmentDistance(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq))
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

/** A seeded hash of up to three integers, as a number in [0, 1). */
export function hash01(seed: number, a: number, b = 0, c = 0): number {
  return mixSeed(mixSeed(mixSeed(seed, a | 0), b | 0), c | 0) / 4_294_967_296
}

/** A seeded hash of up to three integers, as a 32-bit unsigned integer. */
export function hashInt(seed: number, a: number, b = 0, c = 0): number {
  return mixSeed(mixSeed(mixSeed(seed, a | 0), b | 0), c | 0)
}
