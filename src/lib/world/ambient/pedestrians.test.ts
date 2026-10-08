import { describe, expect, it, vi } from 'vitest'
import { createPedestrianSim } from './pedestrians'
import { ambientConfig, gridGraph } from './testing'
import type { PedestrianAnchor } from './types'

const T0 = 1_760_000_000
const ANCHORS: PedestrianAnchor[] = [
  { id: 'bodega', kind: 'place', x: 50, y: 50 },
  { id: 'home', kind: 'home', x: 150, y: 150 },
  { id: 'park', kind: 'landmark', x: 150, y: 50 },
]

const make = (options: Partial<Parameters<typeof createPedestrianSim>[0]> = {}) =>
  createPedestrianSim({
    graph: gridGraph(),
    config: ambientConfig,
    tier: 'high',
    anchors: ANCHORS,
    avoid: [],
    kits: 2,
    ...options,
  })

const snapshot = (sim: ReturnType<typeof make>, t: number) => {
  const n = sim.collect(100, 100, 900, t, 1)
  return sim.samples.slice(0, n).map((p) => [p.id, p.pose.x, p.pose.y, p.pose.yaw, p.kit])
}

describe('ambient pedestrians', () => {
  it('is deterministic from seed and clock', () => {
    const a = make()
    const b = make()
    b.collect(100, 100, 900, T0 + 1000, 1)
    expect(snapshot(a, T0)).toEqual(snapshot(b, T0))
    expect(snapshot(a, T0).length).toBeGreaterThan(0)
    const other = make({ config: { ...ambientConfig, seed: 77 } })
    expect(snapshot(other, T0)).not.toEqual(snapshot(a, T0))
  })

  it('draws nothing from Math.random', () => {
    const spy = vi.spyOn(Math, 'random')
    const sim = make()
    for (let t = 0; t < 20; t++) sim.collect(100, 100, 900, T0 + t, 1)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('walks the sidewalks, never on a street, never across one', () => {
    const sim = make()
    const p = ambientConfig.pedestrians
    let checked = 0
    for (let t = T0; t < T0 + 2 * p.epochS; t += 0.5) {
      const n = sim.collect(100, 100, 900, t, 1)
      for (const ped of sim.samples.slice(0, n)) {
        // Distance to the nearest grid centreline (streets at 0, 100, 200 on both axes,
        // half-width 5, the middle east-west one 8).
        const { x, y } = ped.pose
        for (const c of [0, 100, 200]) {
          const half = c === 100 ? 8 : 5
          const inSpanX = x > -50 && x < 250
          const inSpanY = y > -50 && y < 250
          if (inSpanX) expect(Math.abs(y - c)).toBeGreaterThan(half + 0.4)
          if (inSpanY) expect(Math.abs(x - c)).toBeGreaterThan(5 + 0.4)
        }
        checked++
      }
    }
    expect(checked).toBeGreaterThan(200)
  })

  it('stays near its anchor', () => {
    const sim = make()
    const p = ambientConfig.pedestrians
    for (let t = T0; t < T0 + p.epochS * 2; t += 1) {
      const n = sim.collect(100, 100, 900, t, 1)
      for (const ped of sim.samples.slice(0, n)) {
        const anchor = sim.anchors[Math.floor(ped.id / 8)]
        if (!anchor) throw new Error('anchor')
        expect(Math.hypot(ped.pose.x - anchor.x, ped.pose.y - anchor.y)).toBeLessThan(
          p.anchorRadiusM + 120,
        )
      }
    }
  })

  it('never walks inside a memorial clearance, and drops anchors in one', () => {
    const memorial = { x: 100, y: 100, r: 30 }
    const avoid = [{ ...memorial, r: memorial.r + ambientConfig.pedestrians.lookOnlyMarginM }]
    const sim = make({
      graph: gridGraph({ pedestrianAvoid: avoid }),
      avoid,
      anchors: [...ANCHORS, { id: 'too-close', kind: 'place', x: 110, y: 110 }],
    })
    expect(sim.anchors.map((a) => a.id)).not.toContain('too-close')
    for (let t = T0; t < T0 + 300; t += 0.5) {
      const n = sim.collect(100, 100, 900, t, 1)
      for (const ped of sim.samples.slice(0, n)) {
        expect(Math.hypot(ped.pose.x - memorial.x, ped.pose.y - memorial.y)).toBeGreaterThan(
          avoid[0]?.r ?? 0,
        )
      }
    }
  })

  it('walks without hopping (S04q: bobM 0), swaying, and fades in and out of its epoch', () => {
    const sim = make()
    const yaws = new Set<number>()
    let faded = 0
    for (let t = T0; t < T0 + 240; t += 0.1) {
      const n = sim.collect(100, 100, 900, t, 1)
      for (const ped of sim.samples.slice(0, n)) {
        yaws.add(Math.round(ped.pose.yaw * 1000))
        if (ped.pose.scale < 1) faded++
        expect(ped.pose.lift).toBe(0)
      }
    }
    expect(yaws.size).toBeGreaterThan(5)
    expect(faded).toBeGreaterThan(0)
  })

  it('ignores anchor kinds the config leaves out', () => {
    const sim = make({
      config: {
        ...ambientConfig,
        pedestrians: { ...ambientConfig.pedestrians, anchors: ['home'] },
      },
    })
    expect(sim.anchors.map((a) => a.kind)).toEqual(['home'])
  })
})
