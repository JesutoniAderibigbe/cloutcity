/**
 * A piecewise arc-over-time table (S04l): where along its path a car is at each second of its
 * epoch, compiled once when the epoch starts, read with a binary search per tick.
 *
 * Segment i runs from knot i to knot i + 1 and is one of: cruise (constant speed), dwell
 * (standing), brake (constant deceleration to a stop) or pull away (constant acceleration from a
 * stop). A brake from cruise speed v over T seconds covers v·T/2 metres, so cruise, brake and
 * pull-away join without a jump in speed.
 */

export const SEGMENT = { cruise: 0, dwell: 1, brake: 2, pullAway: 3 } as const
export type SegmentKind = (typeof SEGMENT)[keyof typeof SEGMENT]

export interface Timetable {
  /** Knot times, seconds from the epoch start, ascending. */
  readonly t: Float64Array
  /** Knot arcs, metres along the path, non-decreasing. */
  readonly arc: Float64Array
  /** Kind of the segment starting at each knot (the last entry is unused). */
  readonly kind: Uint8Array
}

/** Collects knots while a route compiles. */
export class TimetableBuilder {
  private readonly ts: number[] = []
  private readonly arcs: number[] = []
  private readonly kinds: number[] = []

  constructor(t0: number, arc0: number) {
    this.ts.push(t0)
    this.arcs.push(arc0)
  }

  get t(): number {
    return this.ts[this.ts.length - 1] ?? 0
  }

  get arc(): number {
    return this.arcs[this.arcs.length - 1] ?? 0
  }

  /** Appends a segment of `kind` ending at (t, arc). Zero-length segments are dropped. */
  push(kind: SegmentKind, t: number, arc: number): void {
    if (t <= this.t) return
    this.kinds.push(kind)
    this.ts.push(t)
    this.arcs.push(Math.max(this.arc, arc))
  }

  build(): Timetable {
    return {
      t: Float64Array.from(this.ts),
      arc: Float64Array.from(this.arcs),
      kind: Uint8Array.from([...this.kinds, SEGMENT.dwell]),
    }
  }
}

/** Mutable result of `evaluate`. */
export interface TableSample {
  arc: number
  speed: number
}

/** Arc and speed at `tS` seconds into the table, held at its ends. */
export function evaluate(table: Timetable, tS: number, out: TableSample): TableSample {
  const { t, arc, kind } = table
  const n = t.length
  if (n === 0) {
    out.arc = 0
    out.speed = 0
    return out
  }
  if (tS <= (t[0] ?? 0)) {
    out.arc = arc[0] ?? 0
    out.speed = 0
    return out
  }
  if (tS >= (t[n - 1] ?? 0)) {
    out.arc = arc[n - 1] ?? 0
    out.speed = 0
    return out
  }
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if ((t[mid] ?? 0) <= tS) lo = mid
    else hi = mid
  }
  const t0 = t[lo] ?? 0
  const span = (t[lo + 1] ?? t0) - t0
  const a0 = arc[lo] ?? 0
  const d = (arc[lo + 1] ?? a0) - a0
  const u = span <= 0 ? 1 : (tS - t0) / span
  switch (kind[lo]) {
    case SEGMENT.cruise:
      out.arc = a0 + d * u
      out.speed = span <= 0 ? 0 : d / span
      break
    case SEGMENT.brake:
      out.arc = a0 + d * (2 * u - u * u)
      out.speed = span <= 0 ? 0 : ((2 * d) / span) * (1 - u)
      break
    case SEGMENT.pullAway:
      out.arc = a0 + d * u * u
      out.speed = span <= 0 ? 0 : ((2 * d) / span) * u
      break
    default:
      out.arc = a0
      out.speed = 0
  }
  return out
}
