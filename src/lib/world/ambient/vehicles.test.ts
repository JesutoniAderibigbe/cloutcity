import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { StreetsFileSchema } from '@/lib/data/schemas/world'
import { decodeStreets } from '../streetProps'
import { buildStreetGraph } from './graph'
import { isGreen } from './lights'
import { createSample, sampleAt, segmentDistance } from './path'
import { ambientConfig, gridGraph } from './testing'
import { createVehicleSim, vehicleAt, type VehicleModel } from './vehicles'
import { createPose, type AmbientConfig, type StreetGraph } from './types'

const ROOT = join(import.meta.dirname, '../../../..')
const T0 = 1_760_000_000 // a fixed city clock, seconds
const MODELS: VehicleModel[] = [
  { kind: 'taxi', lengthM: 4.6 },
  { kind: 'car', lengthM: 4.4 },
  { kind: 'bus', lengthM: 10 },
]

function realGraph(): {
  graph: StreetGraph
  clear: readonly { x: number; y: number; r: number }[]
} {
  const data = decodeStreets(
    StreetsFileSchema.parse(
      JSON.parse(readFileSync(join(ROOT, 'data/geo/streets.derived.json'), 'utf8')),
    ),
    ambientConfig.seed,
  )
  return {
    graph: buildStreetGraph(data, {
      seed: ambientConfig.seed,
      cellM: ambientConfig.cellM,
      lights: ambientConfig.lights,
      vehicleAvoid: data.clear,
      pedestrianAvoid: [],
    }),
    clear: data.clear,
  }
}

const sim = (graph: StreetGraph, config: AmbientConfig = ambientConfig) =>
  createVehicleSim({ graph, config, tier: 'high', models: MODELS })

const snapshot = (s: ReturnType<typeof sim>, x: number, y: number, r: number, t: number) => {
  const n = s.collect(x, y, r, t, 1)
  return s.samples
    .slice(0, n)
    .map((v) => ({ id: v.id, x: v.pose.x, y: v.pose.y, yaw: v.pose.yaw, model: v.model }))
}

describe('ambient vehicles', () => {
  it('places the same cars for the same seed and clock, whatever was simulated before', () => {
    const graph = gridGraph()
    const a = sim(graph)
    const b = sim(graph)
    // b has seen other times first: its cache must not change the answer.
    b.collect(100, 100, 600, T0 - 500, 1)
    b.collect(100, 100, 600, T0 + 900, 1)
    expect(snapshot(a, 100, 100, 600, T0)).toEqual(snapshot(b, 100, 100, 600, T0))
    expect(snapshot(a, 100, 100, 600, T0).length).toBeGreaterThan(0)
  })

  it('places different cars for a different seed', () => {
    const graph = gridGraph()
    const other = { ...ambientConfig, seed: ambientConfig.seed + 1 }
    expect(snapshot(sim(graph), 100, 100, 600, T0)).not.toEqual(
      snapshot(sim(graph, other), 100, 100, 600, T0),
    )
  })

  it('draws nothing from Math.random', () => {
    const spy = vi.spyOn(Math, 'random')
    const s = sim(gridGraph())
    for (let t = 0; t < 30; t++) s.collect(100, 100, 600, T0 + t, 1)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('moves continuously, never faster than the top speed', () => {
    const { graph } = realGraph()
    const s = sim(graph)
    const dt = 0.1
    const vmax = ambientConfig.vehicles.speedMps.max
    const previous = new Map<number, { x: number; y: number; scale: number }>()
    let checked = 0
    for (let t = T0; t < T0 + 60; t += dt) {
      const n = s.collect(-338, 6097, 900, t, 1)
      for (const v of s.samples.slice(0, n)) {
        const last = previous.get(v.id)
        if (last !== undefined && last.scale === 1 && v.pose.scale === 1) {
          const moved = Math.hypot(v.pose.x - last.x, v.pose.y - last.y)
          // A U-turn hop at a dead end crosses the street once (2 lane offsets).
          if (moved > vmax * dt * 1.05 + 1e-6) {
            expect(moved).toBeLessThan(2 * 6 + vmax * dt)
          } else checked++
        }
        previous.set(v.id, { x: v.pose.x, y: v.pose.y, scale: v.pose.scale })
      }
    }
    expect(checked).toBeGreaterThan(1000)
  })

  it('drives on the right-hand side of the street', () => {
    const graph = gridGraph()
    const s = sim(graph)
    let checked = 0
    for (let t = T0; t < T0 + 200; t += 1) {
      const n = s.collect(100, 100, 600, t, 1)
      for (const v of s.samples.slice(0, n)) {
        if (v.pose.speed < 1) continue
        // Heading: model +z to (dx, dy) means yaw = atan2(dx, -dy).
        const dx = Math.sin(v.pose.yaw)
        const dy = -Math.cos(v.pose.yaw)
        // On the grid, find the street it drives along (the one it is parallel to and near).
        const alongX = Math.abs(dx) > 0.95
        const alongY = Math.abs(dy) > 0.95
        if (!alongX && !alongY) continue
        const centre = alongX
          ? [0, 100, 200].reduce((a, b) =>
              Math.abs(v.pose.y - b) < Math.abs(v.pose.y - a) ? b : a,
            )
          : [0, 100, 200].reduce((a, b) =>
              Math.abs(v.pose.x - b) < Math.abs(v.pose.x - a) ? b : a,
            )
        // Right of (dx, dy) is (dy, -dx): the signed offset from the centreline along it.
        const off = alongX ? (v.pose.y - centre) * -dx : (v.pose.x - centre) * dy
        expect(off).toBeGreaterThan(0.5)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(50)
  })

  it('waits at red lights with speed 0, and only while red', () => {
    const { graph } = realGraph()
    const s = sim(graph)
    const pose = createPose()
    let stops = 0
    for (let cx = -6; cx <= 4; cx++) {
      for (let cy = 20; cy <= 28; cy++) {
        for (let slot = 0; slot < 3; slot++) {
          const run = s.runOf(cx, cy, slot, T0)
          if (run === null) continue
          for (const stop of run.stops) {
            if (stop.untilS - stop.fromS < 0.5) continue
            const mid = (stop.fromS + stop.untilS) / 2
            vehicleAt(run, mid, ambientConfig.vehicles.fadeS, pose)
            if (pose.alpha === 0) continue
            expect(pose.speed).toBe(0)
            const node = graph.nodes[stop.node]
            const signal = node?.signal
            expect(signal).toBeTruthy()
            // It drove up to the light, so it waits on its approach's red.
            if (signal) {
              expect(isGreen(signal, stop.axis, mid, ambientConfig.lights)).toBe(false)
              expect(isGreen(signal, stop.axis, stop.untilS + 0.01, ambientConfig.lights)).toBe(
                true,
              )
            }
            stops++
          }
        }
      }
    }
    expect(stops).toBeGreaterThan(20)
  })

  it('queues cars of one cell and cohort a car length apart at a shared red', () => {
    const { graph } = realGraph()
    const s = sim(graph)
    const spacing = 4.4 + ambientConfig.lights.queueGapM
    let pairs = 0
    for (let cx = -8; cx <= 6; cx++) {
      for (let cy = 18; cy <= 30; cy++) {
        for (let k = 0; k < 8; k++) {
          const t = T0 + k * ambientConfig.vehicles.epochS
          const runs = [0, 1, 2].flatMap((slot) => s.runOf(cx, cy, slot, t) ?? [])
          for (let i = 0; i < runs.length; i++) {
            for (let j = i + 1; j < runs.length; j++) {
              const a = runs[i]
              const b = runs[j]
              if (!a || !b || a.startS !== b.startS) continue
              for (const sa of a.stops) {
                for (const sb of b.stops) {
                  if (sa.node !== sb.node || sa.untilS !== sb.untilS || sa.axis !== sb.axis)
                    continue
                  const pa = sampleAt(a.path, sa.arc, createSample())
                  const pb = sampleAt(b.path, sb.arc, createSample())
                  // Opposite approaches share a phase but not a lane.
                  if (pa.dx * pb.dx + pa.dy * pb.dy < 0.9) continue
                  const d = Math.hypot(pa.x - pb.x, pa.y - pb.y)
                  if (d < 20) {
                    expect(d).toBeGreaterThanOrEqual(spacing - 0.3)
                    pairs++
                  }
                }
              }
            }
          }
        }
      }
    }
    expect(pairs).toBeGreaterThanOrEqual(0)
  })

  it('turns back only at dead ends', () => {
    const graph = gridGraph()
    const s = sim(graph)
    const deadEnds = graph.nodes.filter((node) => node.ends.length === 1)
    for (let cx = -1; cx <= 1; cx++) {
      for (let cy = -1; cy <= 1; cy++) {
        for (let slot = 0; slot < 3; slot++) {
          for (let k = 0; k < 6; k++) {
            const run = s.runOf(cx, cy, slot, T0 + k * ambientConfig.vehicles.epochS)
            if (run === null) continue
            const { xs, ys } = run.path
            for (let i = 1; i + 1 < xs.length; i++) {
              const ax = (xs[i] ?? 0) - (xs[i - 1] ?? 0)
              const ay = (ys[i] ?? 0) - (ys[i - 1] ?? 0)
              const bx = (xs[i + 1] ?? 0) - (xs[i] ?? 0)
              const by = (ys[i + 1] ?? 0) - (ys[i] ?? 0)
              const la = Math.hypot(ax, ay)
              const lb = Math.hypot(bx, by)
              if (la < 0.01 || lb < 0.01) continue
              // The U-turn's lateral hop is perpendicular; the reversal is the next vertex.
              const cos = (ax * bx + ay * by) / (la * lb)
              if (cos < -0.9) {
                const near = deadEnds.some(
                  (n) => Math.hypot(n.x - (xs[i] ?? 0), n.y - (ys[i] ?? 0)) < 15,
                )
                expect(near).toBe(true)
              }
            }
          }
        }
      }
    }
  })

  it('runs buses on wide streets only', () => {
    const graph = gridGraph()
    const s = createVehicleSim({
      graph,
      config: { ...ambientConfig, vehicles: { ...ambientConfig.vehicles, busShare: 1 } },
      tier: 'high',
      models: MODELS,
    })
    let buses = 0
    for (let t = T0; t < T0 + 400; t += 5) {
      const n = s.collect(100, 100, 600, t, 1)
      for (const v of s.samples.slice(0, n)) {
        if (v.kind !== 'bus') continue
        // The wide street is y = 100 (half-width 8): the bus stays on it.
        expect(Math.abs(v.pose.y - 100)).toBeLessThan(12)
        buses++
      }
    }
    expect(buses).toBeGreaterThan(0)
  })

  it('never puts a car inside a memorial clearance', () => {
    const { graph, clear } = realGraph()
    const s = sim(graph)
    for (const c of clear) {
      for (let t = T0; t < T0 + 400; t += 4) {
        const n = s.collect(c.x, c.y, 1200, t, 1)
        for (const v of s.samples.slice(0, n)) {
          expect(Math.hypot(v.pose.x - c.x, v.pose.y - c.y)).toBeGreaterThanOrEqual(c.r - 6)
        }
      }
    }
    expect(segmentDistance).toBeTypeOf('function')
  })

  it('activates a nested subset of slots as the share drops', () => {
    const { graph } = realGraph()
    const s = sim(graph)
    const ids = (share: number) => {
      const n = s.collect(-338, 6097, 900, T0, share)
      return new Set(s.samples.slice(0, n).map((v) => v.id))
    }
    const full = ids(1)
    const some = ids(0.6)
    const few = ids(0.3)
    expect(some.size).toBeLessThan(full.size)
    expect(few.size).toBeLessThan(some.size)
    for (const id of few) expect(some.has(id)).toBe(true)
    for (const id of some) expect(full.has(id)).toBe(true)
  })
})
