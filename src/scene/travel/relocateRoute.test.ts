import { describe, expect, it } from 'vitest'
import type { Route } from '@/engine/transit/plan'
import { placeMoves, relocateRoute } from './relocateRoute'

const route = (legs: Route['legs']): Route => ({
  mode: 'subway',
  from: legs[0]?.from ?? { x: 0, y: 0 },
  to: legs[legs.length - 1]?.to ?? { x: 0, y: 0 },
  legs,
  durationMin: 30,
  fare: 3,
  transfers: 0,
  walkedM: 400,
  rushHour: false,
})
const walk = (from: { x: number; y: number }, to: { x: number; y: number }) => ({
  mode: 'walk' as const,
  from,
  to,
  distanceM: 200,
  minutes: 3,
  polyline: [from, to],
})
const ride = {
  mode: 'subway' as const,
  lineId: 'n',
  fromStationId: 'a',
  toStationId: 'b',
  stops: 2,
  waitMin: 3,
  rideMin: 6,
  minutes: 9,
  distanceM: 2000,
  from: { x: 100, y: 100 },
  to: { x: 2000, y: 100 },
  polyline: [
    { x: 100, y: 100 },
    { x: 2000, y: 100 },
  ],
}

describe('relocateRoute (S04n)', () => {
  const moves = placeMoves([
    { x: 0, y: 0, gx: 50, gy: 60 },
    { x: 2100, y: 300, gx: 2200, gy: 250 },
    { x: 999, y: 999 },
  ])

  it('lists only pins drawn away from their real point', () => {
    expect(moves).toHaveLength(2)
  })

  it('moves the walking ends to the game points and keeps the ride and the maths', () => {
    const original = route([
      walk({ x: 0.4, y: -0.3 }, { x: 100, y: 100 }),
      ride,
      walk({ x: 2000, y: 100 }, { x: 2100.2, y: 300 }),
    ])
    const moved = relocateRoute(original, moves)
    expect(moved.from).toEqual({ x: 50, y: 60 })
    expect(moved.to).toEqual({ x: 2200, y: 250 })
    expect(moved.legs[0]?.polyline[0]).toEqual({ x: 50, y: 60 })
    expect(moved.legs[1]).toBe(ride)
    expect(moved.legs[2]?.polyline.at(-1)).toEqual({ x: 2200, y: 250 })
    expect(moved.durationMin).toBe(original.durationMin)
    expect(moved.fare).toBe(original.fare)
    expect(moved.legs[0]?.minutes).toBe(original.legs[0]?.minutes)
  })

  it('leaves routes between unmoved points, and every route with no moves, as they are', () => {
    const original = route([walk({ x: 500, y: 500 }, { x: 700, y: 500 })])
    expect(relocateRoute(original, moves)).toBe(original)
    const atVenue = route([walk({ x: 0, y: 0 }, { x: 700, y: 500 })])
    expect(relocateRoute(atVenue, [])).toBe(atVenue)
  })
})
