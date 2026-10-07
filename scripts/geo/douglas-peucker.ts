/**
 * Douglas-Peucker polyline simplification. Unlike area-based simplification it gives a hard
 * error bound: every dropped vertex lies within `toleranceM` of the simplified path, which is
 * what keeps subway stations on their lines. Endpoints are always kept.
 */
import { distanceToSegment } from '../../src/lib/geo/polygon.ts'
import type { LocalPoint } from '../../src/lib/geo/projection.ts'

export function douglasPeucker(points: readonly LocalPoint[], toleranceM: number): LocalPoint[] {
  if (points.length <= 2) return [...points]
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  // An explicit stack instead of recursion: shapes have thousands of points.
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [start, end] = stack.pop() ?? [0, 0]
    const a = points[start]
    const b = points[end]
    if (a === undefined || b === undefined) continue
    let farthest = -1
    let farthestDistance = 0
    for (let i = start + 1; i < end; i++) {
      const point = points[i]
      if (point === undefined) continue
      const distance = distanceToSegment(point, a, b)
      if (distance > farthestDistance) {
        farthestDistance = distance
        farthest = i
      }
    }
    if (farthest !== -1 && farthestDistance > toleranceM) {
      keep[farthest] = 1
      stack.push([start, farthest], [farthest, end])
    }
  }
  return points.filter((_, index) => keep[index] === 1)
}

/**
 * Douglas-Peucker for an open ring (first vertex not repeated). The ring is split at its first
 * vertex and the vertex farthest from it, both kept, and each half simplified as a path, so the
 * same error bound holds all the way round. Returns the ring unchanged when simplifying would
 * leave fewer than three vertices (a sliver narrower than the tolerance keeps its shape).
 */
export function douglasPeuckerRing(ring: readonly LocalPoint[], toleranceM: number): LocalPoint[] {
  const first = ring[0]
  if (first === undefined || ring.length <= 3) return [...ring]
  let farthest = 1
  let farthestDistance = -1
  for (let i = 1; i < ring.length; i++) {
    const point = ring[i]
    if (point === undefined) continue
    const distance = Math.hypot(point.x - first.x, point.y - first.y)
    if (distance > farthestDistance) {
      farthestDistance = distance
      farthest = i
    }
  }
  const there = douglasPeucker(ring.slice(0, farthest + 1), toleranceM)
  const back = douglasPeucker([...ring.slice(farthest), first], toleranceM)
  const simplified = [...there, ...back.slice(1, -1)]
  return simplified.length >= 3 ? simplified : [...ring]
}
