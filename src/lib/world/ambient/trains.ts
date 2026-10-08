/**
 * Ambient subway trains (S04l): trains running the real line paths between their stations, in
 * closed form. Each path of a line is a shuttle between its first and last stop: the train
 * dwells `dwellS` at every stop, runs the legs between at an average of `speedMps` (easing out of
 * and into each station), and turns back at the terminals. Trains on one path are spaced evenly
 * around that round trip, about `headwayS` apart, from a phase hashed per line and path, so a
 * position needs no state at all: the city clock alone places every car.
 *
 * Cars are articulated along the path behind the head car. Within `lookOnlyMarginM` of a
 * memorial a car is hidden (it fades out over `lookOnlyFadeM` before), as a line under the
 * memorial is.
 */
import { createSample, hashInt, makePath, sampleAt, yawOf, type Path, type XY } from './path'
import type { AmbientConfig, AmbientPose, TrainLine, TrainStation } from './types'

export interface TrainRun {
  /** Index into the lines passed to `buildTrainRuns`. */
  readonly line: number
  readonly color: string
  readonly path: Path
  /** Stop arcs along the path, ascending (first and last are the terminals). */
  readonly stops: Float64Array
  /** The same stops measured from the path's far end (the trip back), ascending. */
  readonly stopsBack: Float64Array
  /** legStart[i]: seconds into a one-way trip the train leaves stop i (after its dwell). */
  readonly legStart: Float64Array
  readonly legStartBack: Float64Array
  /** One-way time: dwell at the first stop, legs and dwells to the last. */
  readonly oneWayS: number
  /** Phase of this train within the round trip (s). */
  readonly phaseS: number
}

/** Stops of one path: stations of the line within `stationSnapM`, merged when close. */
function stopsOf(
  path: Path,
  points: readonly XY[],
  stations: readonly TrainStation[],
  lineId: string,
  trains: AmbientConfig['trains'],
): number[] {
  const arcs: number[] = []
  for (const station of stations) {
    if (!station.lines.includes(lineId)) continue
    let best = Infinity
    let bestArc = 0
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]
      const b = points[i]
      if (a === undefined || b === undefined) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const lengthSq = dx * dx + dy * dy
      const t =
        lengthSq === 0
          ? 0
          : Math.max(0, Math.min(1, ((station.x - a.x) * dx + (station.y - a.y) * dy) / lengthSq))
      const d = Math.hypot(station.x - (a.x + dx * t), station.y - (a.y + dy * t))
      if (d < best) {
        best = d
        bestArc = (path.arc[i - 1] ?? 0) + t * Math.sqrt(lengthSq)
      }
    }
    if (best <= trains.stationSnapM) arcs.push(bestArc)
  }
  arcs.sort((a, b) => a - b)
  const merged: number[] = []
  for (const arc of arcs) {
    const last = merged[merged.length - 1]
    if (last === undefined || arc - last >= trains.minStopGapM) merged.push(arc)
  }
  if (merged.length < 2) return [0, path.length]
  return merged
}

/** Seconds into a one-way trip the train leaves each stop (it dwells at every one). */
function legStarts(stops: Float64Array, trains: AmbientConfig['trains']): Float64Array {
  const out = new Float64Array(stops.length)
  let t = 0
  for (let i = 0; i < stops.length; i++) {
    t += trains.dwellS
    out[i] = t
    if (i + 1 < stops.length) t += ((stops[i + 1] ?? 0) - (stops[i] ?? 0)) / trains.speedMps
  }
  return out
}

/** Every train of every line path, evenly spaced on its round trip. */
export function buildTrainRuns(
  lines: readonly TrainLine[],
  stations: readonly TrainStation[],
  config: Pick<AmbientConfig, 'seed' | 'trains'>,
): TrainRun[] {
  const { trains, seed } = config
  const runs: TrainRun[] = []
  lines.forEach((line, li) => {
    line.paths.forEach((points, pi) => {
      if (points.length < 2) return
      const path = makePath(points)
      if (path.length < 50) return
      const stops = stopsOf(path, points, stations, line.id, trains)
      const stopArcs = Float64Array.from(stops)
      const stopsBack = Float64Array.from(stops.map((s) => path.length - s).reverse())
      const legStart = legStarts(stopArcs, trains)
      const legStartBack = legStarts(stopsBack, trains)
      const oneWayS = legStart[legStart.length - 1] ?? 0
      const roundS = 2 * oneWayS
      const count = Math.max(1, Math.round(roundS / trains.headwayS))
      const base = (hashInt(seed, li, pi, 0x7a) / 4_294_967_296) * roundS
      for (let j = 0; j < count; j++) {
        runs.push({
          line: li,
          color: line.color,
          path,
          stops: stopArcs,
          stopsBack,
          legStart,
          legStartBack,
          oneWayS,
          phaseS: (base + (j * roundS) / count) % roundS,
        })
      }
    })
  })
  return runs
}

/** Mutable head position: arc along the path and direction (+1 forwards, -1 back). */
export interface TrainHead {
  arc: number
  dir: number
}

/** Writes where a run's head is at city time `tS`. */
export function trainHead(run: TrainRun, tS: number, dwellS: number, out: TrainHead): TrainHead {
  const roundS = 2 * run.oneWayS
  const c = (((tS + run.phaseS) % roundS) + roundS) % roundS
  const back = c >= run.oneWayS
  const u = back ? c - run.oneWayS : c
  const stops = back ? run.stopsBack : run.stops
  const legs = back ? run.legStartBack : run.legStart
  const n = stops.length
  // The stop whose dwell-and-leg holds u: the last one it has arrived at.
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if ((legs[mid] ?? 0) - dwellS <= u) lo = mid
    else hi = mid - 1
  }
  const leave = legs[lo] ?? 0
  const here = stops[lo] ?? 0
  let arc = here
  if (u > leave && lo < n - 1) {
    const next = stops[lo + 1] ?? here
    const legS = (legs[lo + 1] ?? leave) - dwellS - leave
    const w = legS <= 0 ? 1 : Math.min(1, (u - leave) / legS)
    arc = here + (next - here) * (1 - Math.cos(Math.PI * w)) * 0.5
  }
  out.arc = back ? run.path.length - arc : arc
  out.dir = back ? -1 : 1
  return out
}

const head = createSample()
const tail = createSample()
const middle = createSample()
const headNow: TrainHead = { arc: 0, dir: 1 }
const headSoon: TrainHead = { arc: 0, dir: 1 }

/**
 * Writes the poses of a run's `cars` cars (`carLengthM` long each, the runtime's distance-scaled
 * length) into `out[offset..offset + cars)` at city time `tS`; returns how many are visible.
 */
export function trainCarsAt(
  run: TrainRun,
  cars: number,
  carLengthM: number,
  tS: number,
  trains: Pick<
    AmbientConfig['trains'],
    'dwellS' | 'gapRatio' | 'lookOnlyMarginM' | 'lookOnlyFadeM'
  >,
  memorials: readonly XY[],
  out: AmbientPose[],
  offset = 0,
): number {
  const { arc, dir } = trainHead(run, tS, trains.dwellS, headNow)
  const pitch = carLengthM * (1 + trains.gapRatio)
  const moving = Math.abs(trainHead(run, tS + 0.5, trains.dwellS, headSoon).arc - arc) * 2
  let visible = 0
  for (let i = 0; i < cars; i++) {
    const pose = out[offset + i]
    if (pose === undefined) break
    // Car centres trail the head's centre; the train never runs past a terminal.
    const centre = Math.max(0, Math.min(run.path.length, arc - dir * (i * pitch + carLengthM / 2)))
    const front = Math.max(0, Math.min(run.path.length, centre + (dir * carLengthM) / 2))
    const back = Math.max(0, Math.min(run.path.length, centre - (dir * carLengthM) / 2))
    sampleAt(run.path, front, head)
    sampleAt(run.path, back, tail)
    const p = sampleAt(run.path, centre, middle)
    let fade = 1
    for (const m of memorials) {
      const d = Math.hypot(p.x - m.x, p.y - m.y)
      if (d < trains.lookOnlyMarginM) fade = 0
      else if (d < trains.lookOnlyMarginM + trains.lookOnlyFadeM) {
        fade = Math.min(fade, (d - trains.lookOnlyMarginM) / trains.lookOnlyFadeM)
      }
    }
    const dx = head.x - tail.x
    const dy = head.y - tail.y
    pose.x = p.x
    pose.y = p.y
    pose.yaw = dx === 0 && dy === 0 ? yawOf(p.dx * dir, p.dy * dir) : yawOf(dx, dy)
    pose.scale = fade
    pose.alpha = fade > 0 ? 1 : 0
    pose.lift = 0
    pose.speed = moving
    if (fade > 0) visible++
  }
  return visible
}
