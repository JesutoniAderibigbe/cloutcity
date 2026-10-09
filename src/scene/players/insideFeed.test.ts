import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import realtimeJson from '@data/config/realtime.json'
import typesJson from '@data/interiors/types.json'
import venuesJson from '@data/venues/venues.json'
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest'
import type { PresenceActivity, PresencePlayer } from '@/realtime/types'
import { applySnapshot, resetPresence, setPlayerHidden } from '@/state/presence'
import { tripStore } from '@/state/trip'
import { interiorOccupants, type InteriorActivity } from '@/state/venueOccupants'
import { fallbackActivity, interiorOf, occupantsAt, startInsideFeed } from './insideFeed'

const inside = realtimeJson.presence.inside
const club = venuesJson.venues.find((venue) => venue.type === 'club')
const deli = venuesJson.venues.find((venue) => venue.type === 'bodega')
if (club === undefined || deli === undefined) throw new Error('test: no club or bodega venue')
// Every venue type has an interior now (S43b): the deli's pin stands in for a place without one
// (a landmark's category).
const NO_INTERIOR = 'landmark'
const categoryOf = new Map([
  [club.id, club.type],
  [deli.id, NO_INTERIOR],
])

const idle = {
  active: null,
  progress: 0,
  animator: false,
  arrival: null,
  arrivalEventsSuppressed: false,
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const player = (n: number, over: Partial<PresencePlayer> = {}): PresencePlayer => ({
  id: uuid(n),
  handle: `Player${n}`,
  level: 'local',
  career: null,
  look: { body: 'woman', top: 'teal' },
  worn: ['denim-jacket'],
  spot: 'place',
  place: club.id,
  borough: 'brooklyn',
  activity: null,
  ...over,
})

const standAt = (placeId: string | null) =>
  tripStore.setState({ ...idle, spot: placeId === null ? null : { kind: 'place', placeId } })

afterEach(() => {
  standAt(null)
  resetPresence()
  setPlayerHidden(uuid(2), false)
})

describe('activities', () => {
  it('the wire and the interior share one activity list', () => {
    expectTypeOf<PresenceActivity>().toEqualTypeOf<InteriorActivity>()
  })

  it('config names real interiors and real place actions', () => {
    const interiors = new Set([
      ...Object.values(typesJson.byVenueType),
      ...Object.values(typesJson.byVenue),
    ])
    for (const id of Object.keys(inside.byInterior)) expect(interiors).toContain(id)
    // Every interior has its own list (S43c): nobody inside falls back to standing around.
    for (const id of interiors) expect(Object.keys(inside.byInterior)).toContain(id)
    // The place actions an interior acts out (the Sim's actions there, one file each, S43b).
    const dir = join(import.meta.dirname, '../../../data/interiors/venues')
    const actions = new Set(
      readdirSync(dir)
        .filter((name) => name.endsWith('.json'))
        .flatMap((name) =>
          Object.keys(
            (JSON.parse(readFileSync(join(dir, name), 'utf8')) as { actions: object }).actions,
          ),
        ),
    )
    for (const id of Object.keys(inside.actions)) expect(actions).toContain(id)
  })

  it('a player who announced nothing does the same suitable thing every time', () => {
    for (let n = 0; n < 40; n++) {
      const a = fallbackActivity(uuid(n), 'club')
      expect(inside.byInterior.club).toContain(a)
      expect(fallbackActivity(uuid(n), 'club')).toBe(a)
      expect(inside.byInterior.lounge).toContain(fallbackActivity(uuid(n), 'lounge'))
    }
    const picks = new Set(Array.from({ length: 40 }, (_, n) => fallbackActivity(uuid(n), 'club')))
    expect(picks.size).toBeGreaterThan(1)
    expect(fallbackActivity(uuid(1), 'no-such-interior')).toBe('idle')
    expect(inside.byInterior.gym).toContain(fallbackActivity(uuid(1), 'gym'))
    expect(inside.byInterior.barber).toContain(fallbackActivity(uuid(1), 'barber'))
  })
})

describe('occupantsAt', () => {
  it('the players at the place, in order, with their look, handle and activity', () => {
    const players = [
      { ...player(1, { activity: 'bar' }), place: club.id },
      { ...player(2), place: deli.id },
      { ...player(3), look: null, worn: [] },
    ].map((p) => ({
      id: p.id,
      place: p.place ?? '',
      look: p.look,
      handle: p.handle,
      level: p.level,
      worn: p.worn,
      activity: p.activity,
    }))
    const occupants = occupantsAt(players, club.id, 'club')
    expect(occupants.map((o) => o.handle)).toEqual(['Player1', 'Player3'])
    expect(occupants[0]).toEqual({
      id: uuid(1),
      handle: 'Player1',
      avatar: { look: { body: 'woman', top: 'teal' }, worn: ['denim-jacket'] },
      activity: 'bar',
    })
    // No synced look yet: the default look (the avatar repairs an empty one).
    expect(occupants[1]?.avatar).toEqual({ look: {}, worn: [] })
    expect(occupants[1]?.activity).toBe(fallbackActivity(uuid(3), 'club'))
  })

  it('knows which places have an interior', () => {
    expect(interiorOf('club')).toBe('club')
    expect(interiorOf('bodega')).toBe('bodega')
    // A single venue can open its own (S43b): the boxing gym.
    expect(interiorOf('gym', 'southpaw-social')).toBe('boxing')
    expect(interiorOf(NO_INTERIOR)).toBeNull()
    expect(interiorOf(undefined)).toBeNull()
  })
})

describe('startInsideFeed', () => {
  it('fills the interior of the place the player stands at, and only that one', () => {
    const stop = startInsideFeed(categoryOf)
    applySnapshot({
      online: 4,
      ghost: false,
      players: [player(1, { activity: 'dance' }), player(2), player(3, { place: deli.id })],
    })
    expect(interiorOccupants(club.id)).toEqual([])
    standAt(club.id)
    expect(interiorOccupants(club.id).map((o) => o.id)).toEqual([uuid(1), uuid(2)])
    expect(interiorOccupants(club.id)[0]?.activity).toBe('dance')
    // A place with no interior: nothing is fed.
    standAt(deli.id)
    expect(interiorOccupants(club.id)).toEqual([])
    expect(interiorOccupants(deli.id)).toEqual([])
    stop()
  })

  it('a player blocked or muted here leaves at once; one who left the place goes too', () => {
    standAt(club.id)
    const stop = startInsideFeed(categoryOf)
    applySnapshot({ online: 3, ghost: false, players: [player(1), player(2)] })
    setPlayerHidden(uuid(2), true)
    expect(interiorOccupants(club.id).map((o) => o.id)).toEqual([uuid(1)])
    applySnapshot({ online: 3, ghost: false, players: [player(1, { spot: 'home', place: null })] })
    expect(interiorOccupants(club.id)).toEqual([])
    stop()
  })

  it('the stop empties the interior', () => {
    standAt(club.id)
    const stop = startInsideFeed(categoryOf)
    applySnapshot({ online: 2, ghost: false, players: [player(1)] })
    expect(interiorOccupants(club.id)).toHaveLength(1)
    stop()
    expect(interiorOccupants(club.id)).toEqual([])
  })
})
