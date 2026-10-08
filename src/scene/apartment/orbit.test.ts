import { describe, expect, it } from 'vitest'
import { apartmentConfig } from './data'
import { easeToward, isDoubleTap, polarRange, zoomRange } from './orbit'

const orbit = apartmentConfig.orbit
const DEG = Math.PI / 180

describe('room orbit (S40b)', () => {
  it('zooms between shares of the fit, never inside the room’s sphere', () => {
    const wide = zoomRange(20, 4, orbit)
    expect(wide.min).toBeCloseTo(20 * orbit.zoomInShare)
    expect(wide.max).toBeCloseTo(20 * orbit.zoomOutShare)
    // A tight fit (a tall phone row) would zoom inside the walls: the sphere wins.
    const tight = zoomRange(6, 4, orbit)
    expect(tight.min).toBeCloseTo(4 * orbit.outsideShare)
    expect(tight.max).toBeGreaterThanOrEqual(tight.min)
  })

  it('tilts between the configured limits, widened to the home angle, never below the floor', () => {
    const range = polarRange(50 * DEG, orbit)
    expect(range.min).toBeCloseTo(orbit.minPolarDeg * DEG)
    expect(range.max).toBeCloseTo(orbit.maxPolarDeg * DEG)
    expect(range.max).toBeLessThan(Math.PI / 2)
    expect(polarRange(5 * DEG, orbit).min).toBeCloseTo(5 * DEG)
  })

  it('eases back the short way round and lands exactly; a cut at ease 1', () => {
    const home = { theta: 0.1, phi: 0.9, radius: 10 }
    let pose = { theta: -3, phi: 0.3, radius: 15 }
    // The first step turns the way the wrapped difference points (the short way round).
    const first = easeToward(pose, home, 0.5)
    const wrapped = Math.atan2(Math.sin(home.theta - pose.theta), Math.cos(home.theta - pose.theta))
    expect(Math.sign(first.pose.theta - pose.theta)).toBe(Math.sign(wrapped))
    let steps = 0
    let done = false
    while (!done && steps < 200) {
      const step = easeToward(pose, home, 0.2)
      pose = { ...step.pose }
      done = step.done
      steps++
    }
    expect(done).toBe(true)
    expect(pose).toEqual(home)
    expect(easeToward({ theta: 2, phi: 0.2, radius: 30 }, home, 1)).toEqual({
      pose: home,
      done: true,
    })
  })

  it('takes a second tap close in time and place as a double tap', () => {
    const first = { x: 100, y: 100, at: 1000 }
    expect(isDoubleTap(null, first, orbit)).toBe(false)
    expect(isDoubleTap(first, { x: 104, y: 98, at: 1000 + orbit.doubleTapMs - 1 }, orbit)).toBe(
      true,
    )
    expect(isDoubleTap(first, { x: 104, y: 98, at: 1000 + orbit.doubleTapMs + 1 }, orbit)).toBe(
      false,
    )
    expect(
      isDoubleTap(first, { x: 100 + orbit.doubleTapSlopPx + 1, y: 100, at: 1100 }, orbit),
    ).toBe(false)
  })
})
