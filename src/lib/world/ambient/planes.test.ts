import { describe, expect, it } from 'vitest'
import ambientJson from '@data/config/ambient.json'
import { createPlaneSim, smoothCurve } from './planes'
import type { AmbientConfig } from './types'

const planes = (ambientJson as unknown as AmbientConfig).planes
const TIERS = ['low', 'mid', 'high'] as const
/** Astoria, near the default Queens start (local metres). */
const START = { x: 4673, y: 7229 }

describe('the sky (S04q)', () => {
  it('always has a plane in the air on every tier (DEC-52), within the tier counts', () => {
    for (const tier of TIERS) {
      const sim = createPlaneSim(planes, tier, 5209)
      for (let t = 0; t < 3600; t += 7) {
        const n = sim.collect(START.x, START.y, t)
        const live = sim.samples.slice(0, n)
        const airliners = live.filter((s) => s.kind === 'plane').length
        expect(airliners).toBeGreaterThanOrEqual(1)
        expect(airliners).toBeLessThanOrEqual(planes.maxShown[tier])
        expect(live.filter((s) => s.kind === 'helicopter').length).toBeLessThanOrEqual(
          planes.helicopters[tier],
        )
      }
    }
  })

  it('is a pure function of the clock', () => {
    const a = createPlaneSim(planes, 'high', 5209)
    const b = createPlaneSim(planes, 'high', 5209)
    const n = a.collect(START.x, START.y, 12_345.6)
    expect(b.collect(START.x, START.y, 12_345.6)).toBe(n)
    expect(a.samples.slice(0, n)).toEqual(b.samples.slice(0, n))
  })

  it('flies smoothly: no jumps, gentle banks, fading in and out', () => {
    const sim = createPlaneSim(planes, 'high', 5209)
    const last = new Map<string, { x: number; y: number; alt: number; yaw: number; t: number }>()
    const dt = 0.25
    const fades: number[] = []
    for (let t = 0; t < 1200; t += dt) {
      const n = sim.collect(START.x, START.y, t)
      for (const s of sim.samples.slice(0, n)) {
        const before = last.get(s.id)
        // Consecutive steps only: a far flight may leave the shown set and come back.
        if (before !== undefined && before.t === t - dt) {
          const speed = s.kind === 'helicopter' ? planes.helicopter.speedMps : planes.speedMps
          const moved = Math.hypot(s.x - before.x, s.y - before.y, s.alt - before.alt)
          expect(moved).toBeLessThanOrEqual(speed * dt * 1.05 + 0.5)
          let turn = Math.abs(s.yaw - before.yaw) % (Math.PI * 2)
          if (turn > Math.PI) turn = Math.PI * 2 - turn
          expect(turn).toBeLessThan(0.2)
        }
        expect(Math.abs(s.bank)).toBeLessThanOrEqual(planes.maxBankRad + 1e-9)
        expect(s.alt).toBeGreaterThanOrEqual(0)
        fades.push(s.fade)
        last.set(s.id, { x: s.x, y: s.y, alt: s.alt, yaw: s.yaw, t })
      }
    }
    expect(Math.min(...fades)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...fades)).toBe(1)
  })

  it('passes over the Queens start on the default route', () => {
    const sim = createPlaneSim(planes, 'low', 5209)
    let closest = Infinity
    for (let t = 0; t < 600; t += 1) {
      const n = sim.collect(START.x, START.y, t)
      for (const s of sim.samples.slice(0, n)) {
        closest = Math.min(closest, Math.hypot(s.x - START.x, s.y - START.y))
      }
    }
    expect(closest).toBeLessThan(1500)
  })

  it('draws a curve through its waypoints', () => {
    const curve = smoothCurve(
      [
        [0, 0, 0],
        [100, 0, 50],
        [100, 100, 100],
      ],
      8,
      false,
    )
    expect(curve[0]).toEqual([0, 0, 0])
    expect(curve[8]?.[0]).toBeCloseTo(100)
    expect(curve[curve.length - 1]).toEqual([100, 100, 100])
  })
})
