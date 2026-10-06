import { describe, expect, it } from 'vitest'
import { distanceToPolyline } from '../../src/lib/geo/polygon'
import { douglasPeucker } from './douglas-peucker'

describe('douglasPeucker', () => {
  it('keeps both endpoints and drops collinear points', () => {
    const line = Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: 0 }))
    expect(douglasPeucker(line, 1)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ])
  })

  it('keeps a corner that deviates more than the tolerance', () => {
    const corner = [
      { x: 0, y: 0 },
      { x: 50, y: 20 },
      { x: 100, y: 0 },
    ]
    expect(douglasPeucker(corner, 5)).toEqual(corner)
    expect(douglasPeucker(corner, 25)).toEqual([corner[0], corner[2]])
  })

  it('bounds the error: every dropped vertex is within the tolerance of the result', () => {
    // A deterministic wiggly line.
    const points = Array.from({ length: 500 }, (_, i) => ({
      x: i * 3,
      y: Math.sin(i / 7) * 40 + Math.sin(i * 1.3) * 2,
    }))
    for (const tolerance of [0.5, 3, 10]) {
      const simplified = douglasPeucker(points, tolerance)
      expect(simplified.length).toBeLessThan(points.length)
      expect(simplified[0]).toEqual(points[0])
      expect(simplified[simplified.length - 1]).toEqual(points[points.length - 1])
      for (const point of points) {
        expect(distanceToPolyline(point, simplified)).toBeLessThanOrEqual(tolerance + 1e-9)
      }
    }
  })

  it('returns short inputs unchanged', () => {
    expect(douglasPeucker([], 1)).toEqual([])
    expect(douglasPeucker([{ x: 1, y: 2 }], 1)).toEqual([{ x: 1, y: 2 }])
  })
})
