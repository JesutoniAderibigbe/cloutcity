import realtimeJson from '@data/config/realtime.json'
import { describe, expect, it } from 'vitest'
import { ringGeometry, themeColour } from './layer'

describe('players layer', () => {
  it("the ring's colour token is a theme colour", () => {
    expect(themeColour(realtimeJson.presence.map.ringColorToken)).toMatch(/^#[0-9a-f]{6}$/i)
    expect(() => themeColour('no-such-token')).toThrow()
  })

  it('the ring is a flat, upward-facing annulus with only position and normal (the kits’ program)', () => {
    const ring = ringGeometry(0.5)
    expect(Object.keys(ring.attributes).sort()).toEqual(['normal', 'position'])
    expect(ring.index).toBeNull()
    const position = ring.getAttribute('position')
    const normal = ring.getAttribute('normal')
    for (let i = 0; i < position.count; i++) {
      expect(position.getY(i)).toBe(0)
      const r = Math.hypot(position.getX(i), position.getZ(i))
      expect(r).toBeGreaterThanOrEqual(0.5 - 1e-6)
      expect(r).toBeLessThanOrEqual(1 + 1e-6)
      expect([normal.getX(i), normal.getY(i), normal.getZ(i)]).toEqual([0, 1, 0])
    }
    // Every triangle winds counter-clockwise seen from above (its face points up).
    for (let t = 0; t < position.count; t += 3) {
      const [ax, az, bx, bz, cx, cz] = [
        position.getX(t),
        position.getZ(t),
        position.getX(t + 1),
        position.getZ(t + 1),
        position.getX(t + 2),
        position.getZ(t + 2),
      ]
      const crossY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
      expect(crossY).toBeGreaterThan(0)
    }
  })
})
