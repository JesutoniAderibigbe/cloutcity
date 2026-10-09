/**
 * S04s "match the map": trips plan to the game map's points on both map styles, and a ring
 * landmark is gated where the game map draws it. The map style is a client-side view only, so
 * nothing here may depend on it: a style switch must never change a trip's time or fare.
 */
import { describe, expect, it } from 'vitest'
import gamePoints from '@data/places/game-points.derived.json'
import { placeBoroughAccess, placeGateBorough } from '@/engine/boroughs'
import { engineConfig } from '@/engine/config'
import { initialSnapshot } from '@/engine/game'
import { transitConfig } from '@/engine/transit/config'
import { tripOptions } from '@/engine/transit/trip'
import { buildTransitWorld } from '@/engine/transit/world'
import { land, subway } from '@/lib/data/geo'
import { distanceM } from '@/lib/geo/projection'
import { mapPlaces } from './places'
import { tripEnd } from './tripEnds'

const HOME = 'queens-room'
const points = gamePoints.points as Record<string, { x: number; y: number }>
const placeEnd = (placeId: string) => {
  const end = tripEnd({ kind: 'place', placeId }, HOME)
  if (end === undefined) throw new Error(`no trip end for ${placeId}`)
  return end
}

describe('trip ends match the game map (S04s)', () => {
  it('a compact venue routes to and rests at its game-map point; real keeps the real ones', () => {
    const place = mapPlaces().find((candidate) => candidate.id === 'glowmatic')
    const end = placeEnd('glowmatic')
    expect(end.stop.point).toEqual(points.glowmatic)
    expect(end.rest).toEqual(points.glowmatic)
    expect(end.real).toEqual({
      point: { x: place?.routeX, y: place?.routeY },
      rest: { x: place?.x, y: place?.y },
    })
    expect(end.stop.borough).toBe('queens')
  })

  it('a ring landmark routes to its ring spot, not its island approach', () => {
    const end = placeEnd('statue-of-liberty')
    expect(end.stop.point).toEqual(points['statue-of-liberty'])
    // Drawn beside the Queens home: a short trip, kilometres from the real harbour approach.
    const home = tripEnd({ kind: 'home' }, HOME)
    expect(distanceM(home!.stop.point, end.stop.point)).toBeLessThan(2000)
    expect(distanceM(end.stop.point, end.real.point)).toBeGreaterThan(5000)
  })

  it('a place the game map leaves where it is keeps its real points', () => {
    const end = placeEnd('central-park')
    expect(points['central-park']).toBeUndefined()
    expect(end.stop.point).toEqual(end.real.point)
    expect(end.rest).toEqual(end.real.rest)
  })

  it('home never moves', () => {
    const end = tripEnd({ kind: 'home' }, HOME)
    expect(end?.stop.point).toEqual(end?.real.point)
  })
})

describe('ring landmarks are gated by the borough the game map draws them in (S04s)', () => {
  const nobody = 0

  it('the Statue of Liberty is open to a new player; an unmoved Manhattan landmark is not', () => {
    expect(placeGateBorough('statue-of-liberty', 'manhattan', engineConfig)).toBe('queens')
    expect(placeBoroughAccess('statue-of-liberty', 'manhattan', nobody, engineConfig)).toEqual({
      status: 'open',
    })
    expect(placeGateBorough('central-park', 'manhattan', engineConfig)).toBe('manhattan')
    expect(placeBoroughAccess('central-park', 'manhattan', nobody, engineConfig).status).toBe(
      'locked',
    )
  })

  it('venues keep their own borough lock', () => {
    for (const place of mapPlaces()) {
      if (place.kind === 'venue') expect(engineConfig.gates.has(place.id)).toBe(false)
    }
  })

  it('a new player can walk from the Queens home to the Statue of Liberty in minutes', () => {
    const world = buildTransitWorld({ subway, land }, transitConfig)
    const snapshot = initialSnapshot(engineConfig)
    const home = tripEnd({ kind: 'home' }, HOME)
    const options = tripOptions(
      snapshot,
      home!.stop.point,
      placeEnd('statue-of-liberty').stop,
      { world },
      engineConfig,
      transitConfig,
    )
    const walk = options.find((option) => option.mode === 'walk')
    expect(walk?.block).toBeNull()
    expect(walk?.durationMin).toBeLessThan(20)
    expect(walk?.route?.fare).toBe(0)
  }, 60_000)
})
