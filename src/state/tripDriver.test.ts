/**
 * S04s: a trip is planned to the game map's points on both map styles; the Real NYC style draws
 * the same trip between the real points (`realDrawnRoute`), over the same game minutes, so the
 * HUD clock and the arrival match what the save holds.
 */
import { describe, expect, it } from 'vitest'
import { transitConfig } from '@/engine/transit/config'
import { planTrip, type Route } from '@/engine/transit/plan'
import { buildTransitWorld } from '@/engine/transit/world'
import { land, subway } from '@/lib/data/geo'
import { tripEnd, type TripEnd } from '@/lib/world/tripEnds'
import { realDrawnRoute } from './tripDriver'

const NOON = 12 * 60
const world = buildTransitWorld({ subway, land }, transitConfig)

function end(placeId: string | null): TripEnd {
  const found = tripEnd(
    placeId === null ? { kind: 'home' } : { kind: 'place', placeId },
    'queens-room',
  )
  if (found === undefined) throw new Error(`no trip end for ${placeId}`)
  return found
}

function planned(plan: { from: TripEnd; to: TripEnd }, mode: 'walk' | 'subway' | 'taxi'): Route {
  const result = planTrip(plan.from.stop.point, plan.to.stop.point, mode, {
    config: transitConfig,
    minuteOfDay: NOON,
    world,
  })
  if (!result.ok) throw new Error(result.error.code)
  return result.route
}

const lastPoint = (route: Route) => route.legs.at(-1)?.polyline.at(-1)
const firstPoint = (route: Route) => route.legs[0]?.polyline[0]

describe('the Real NYC drawing of a trip (S04s)', () => {
  it('a walk to the ring statue is drawn across the real city, over the same game minutes', () => {
    const plan = { from: end(null), to: end('statue-of-liberty') }
    const route = planned(plan, 'walk')
    const drawn = realDrawnRoute(route, plan, NOON, world)
    // No walk reaches the harbour from Queens: the drawing rides a taxi over a bridge instead.
    expect(drawn.mode).toBe('taxi')
    expect(drawn.durationMin).toBe(route.durationMin)
    expect(firstPoint(drawn)).toEqual(plan.from.real.rest)
    expect(lastPoint(drawn)).toEqual(plan.to.real.rest)
    expect(drawn.to).toEqual(plan.to.real.rest)
  }, 60_000)

  it('a trip between places the game map leaves where they are is drawn as taken', () => {
    const plan = { from: end(null), to: end('flushing-meadows') }
    const route = planned(plan, 'subway')
    const drawn = realDrawnRoute(route, plan, NOON, world)
    expect(drawn.mode).toBe('subway')
    expect(drawn.legs.length).toBe(route.legs.length)
    expect(drawn.durationMin).toBe(route.durationMin)
    expect(lastPoint(drawn)).toEqual(plan.to.real.rest)
  }, 60_000)

  it('without the transit world the drawing is a straight line between the real points', () => {
    const plan = { from: end(null), to: end('glowmatic') }
    const route = planned(plan, 'taxi')
    const drawn = realDrawnRoute(route, plan, NOON, null)
    expect(drawn.legs).toHaveLength(1)
    expect(drawn.durationMin).toBe(route.durationMin)
    expect(firstPoint(drawn)).toEqual(plan.from.real.rest)
    expect(lastPoint(drawn)).toEqual(plan.to.real.rest)
  }, 60_000)
})
