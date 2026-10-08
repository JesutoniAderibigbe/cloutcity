/**
 * A trip's route as the game map style draws it (S04n): the engine plans every route between
 * the places' real points (travel time, fares and distances stay real), but on the game map a
 * venue stands at its compact point, so the route's first and last points move there. Only the
 * ends of walking and taxi legs move; subway legs ride their real lines between real stations.
 * Pure, no three.
 */
import type { Leg, Route } from '@/engine/transit/plan'
import type { LocalPoint } from '@/lib/geo/projection'

/** A venue's real point (as the places layer rounds it) and where the game map draws it. */
export interface PlaceMove {
  readonly from: LocalPoint
  readonly to: LocalPoint
}

/** Route ends are the places' unrounded points; the layer's are whole metres. */
const MATCH_M = 1

function movedTo(point: LocalPoint, moves: readonly PlaceMove[]): LocalPoint | undefined {
  return moves.find(
    (move) =>
      Math.abs(move.from.x - point.x) <= MATCH_M && Math.abs(move.from.y - point.y) <= MATCH_M,
  )?.to
}

function withStart(leg: Leg, to: LocalPoint): Leg {
  if (leg.mode === 'subway') return leg
  return { ...leg, from: to, polyline: [to, ...leg.polyline.slice(1)] }
}

function withEnd(leg: Leg, to: LocalPoint): Leg {
  if (leg.mode === 'subway') return leg
  return { ...leg, to, polyline: [...leg.polyline.slice(0, -1), to] }
}

/** The route with ends at moved venues drawn at their game-map points; others unchanged. */
export function relocateRoute(route: Route, moves: readonly PlaceMove[]): Route {
  if (moves.length === 0 || route.legs.length === 0) return route
  const start = movedTo(route.from, moves)
  const end = movedTo(route.to, moves)
  if (start === undefined && end === undefined) return route
  const legs = [...route.legs]
  const first = legs[0]
  if (start !== undefined && first !== undefined && first.mode !== 'subway') {
    legs[0] = withStart(first, start)
  }
  const lastIndex = legs.length - 1
  const last = legs[lastIndex]
  if (end !== undefined && last !== undefined && last.mode !== 'subway') {
    legs[lastIndex] = withEnd(last, end)
  }
  return {
    ...route,
    legs,
    from: legs[0]?.mode === 'subway' ? route.from : (start ?? route.from),
    to: legs[lastIndex]?.mode === 'subway' ? route.to : (end ?? route.to),
  }
}

/** The moves of every pin the game map draws away from its real point. */
export function placeMoves(
  pins: readonly {
    readonly x: number
    readonly y: number
    readonly gx?: number
    readonly gy?: number
  }[],
): PlaceMove[] {
  const moves: PlaceMove[] = []
  for (const pin of pins) {
    if (pin.gx === undefined || pin.gy === undefined) continue
    moves.push({ from: { x: pin.x, y: pin.y }, to: { x: pin.gx, y: pin.gy } })
  }
  return moves
}
