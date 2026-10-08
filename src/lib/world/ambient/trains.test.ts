import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodePath } from '@/lib/geo/codec'
import { ambientConfig } from './testing'
import { buildTrainRuns, trainCarsAt, trainHead, type TrainHead } from './trains'
import { createPose, type TrainLine, type TrainStation } from './types'

const T0 = 1_760_000_000
const trains = ambientConfig.trains
const LINE: TrainLine = {
  id: 'Q',
  color: '#fccc0a',
  paths: [
    [
      { x: 0, y: 0 },
      { x: 3000, y: 0 },
      { x: 3000, y: 2000 },
    ],
  ],
}
const STATIONS: TrainStation[] = [
  { x: 0, y: 5, lines: ['Q'] },
  { x: 1000, y: -3, lines: ['Q'] },
  { x: 3000, y: 800, lines: ['Q'] },
  { x: 3000, y: 2000, lines: ['Q'] },
  { x: 1500, y: 900, lines: ['Q'] }, // too far off the path
  { x: 2000, y: 0, lines: ['R'] }, // another line
]

const head = (): TrainHead => ({ arc: 0, dir: 1 })

describe('ambient trains', () => {
  const runs = buildTrainRuns([LINE], STATIONS, ambientConfig)

  it('stops at the line’s own stations only', () => {
    const run = runs[0]
    expect(run).toBeDefined()
    expect([...(run?.stops ?? [])].map(Math.round)).toEqual([0, 1000, 3800, 5000])
  })

  it('spaces trains about a headway apart round the trip', () => {
    const run = runs[0]
    if (!run) throw new Error('no run')
    expect(runs.length).toBe(Math.max(1, Math.round((2 * run.oneWayS) / trains.headwayS)))
    expect(new Set(runs.map((r) => r.phaseS)).size).toBe(runs.length)
  })

  it('dwells at every stop and turns back at the terminals', () => {
    const run = runs[0]
    if (!run) throw new Error('no run')
    const stops = [...run.stops]
    const dwelt = new Set<number>()
    const dirs = new Set<number>()
    const h = head()
    let last = trainHead(run, T0, trains.dwellS, head()).arc
    for (let t = T0 + 1; t < T0 + 2 * run.oneWayS + 10; t += 1) {
      trainHead(run, t, trains.dwellS, h)
      expect(h.arc).toBeGreaterThanOrEqual((stops[0] ?? 0) - 1e-6)
      expect(h.arc).toBeLessThanOrEqual((stops[stops.length - 1] ?? 0) + 1e-6)
      dirs.add(h.dir)
      if (Math.abs(h.arc - last) < 1e-9) {
        const at = stops.findIndex((s) => Math.abs(s - h.arc) < 1e-6)
        expect(at).toBeGreaterThanOrEqual(0)
        dwelt.add(at)
      }
      // Never faster than the eased peak (π/2 × the average).
      expect(Math.abs(h.arc - last)).toBeLessThanOrEqual(trains.speedMps * (Math.PI / 2) + 1e-6)
      last = h.arc
    }
    expect([...dwelt].sort()).toEqual(stops.map((_, i) => i))
    expect(dirs).toEqual(new Set([1, -1]))
  })

  it('is a pure function of the clock', () => {
    const run = runs[0]
    if (!run) throw new Error('no run')
    const a = trainHead(run, T0 + 123.4, trains.dwellS, head())
    trainHead(run, T0 + 999, trains.dwellS, head())
    expect(trainHead(run, T0 + 123.4, trains.dwellS, head())).toEqual(a)
  })

  it('articulates its cars along the path behind the head', () => {
    const run = runs[0]
    if (!run) throw new Error('no run')
    const out = [createPose(), createPose(), createPose()]
    for (let t = T0; t < T0 + 300; t += 7) {
      trainCarsAt(run, 3, 20, t, trains, [], out)
      for (let i = 1; i < 3; i++) {
        const a = out[i - 1]
        const b = out[i]
        if (!a || !b) continue
        // Each car centre sits one pitch behind the one ahead (less along the corner).
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThanOrEqual(
          20 * (1 + trains.gapRatio) + 1e-6,
        )
      }
    }
  })

  it('hides cars near a memorial', () => {
    const run = runs[0]
    if (!run) throw new Error('no run')
    const out = [createPose(), createPose(), createPose()]
    const memorial = { x: 1500, y: 0 }
    for (let t = T0; t < T0 + 2 * run.oneWayS; t += 3) {
      trainCarsAt(run, 3, 20, t, trains, [memorial], out)
      for (const pose of out) {
        const d = Math.hypot(pose.x - memorial.x, pose.y - memorial.y)
        if (d < trains.memorialMarginM) expect(pose.alpha).toBe(0)
        if (d > trains.memorialMarginM + trains.memorialFadeM) expect(pose.scale).toBe(1)
      }
    }
  })

  it('runs every real line', () => {
    const subway = JSON.parse(
      readFileSync(join(import.meta.dirname, '../../../../data/geo/subway.derived.json'), 'utf8'),
    ) as {
      lines: { id: string; paths: number[][] }[]
      stations: { x: number; y: number; lines: string[] }[]
    }
    const lines: TrainLine[] = subway.lines.map((line) => ({
      id: line.id,
      color: '#888888',
      paths: line.paths.map((p) => decodePath(p)),
    }))
    const real = buildTrainRuns(lines, subway.stations, ambientConfig)
    expect(new Set(real.map((r) => r.line)).size).toBe(lines.length)
    for (const run of real) expect(run.stops.length).toBeGreaterThanOrEqual(2)
    // Most lines stop at most of their stations.
    const withStops = real.filter((run) => run.stops.length > 5).length
    expect(withStops / real.length).toBeGreaterThan(0.8)
  })
})
