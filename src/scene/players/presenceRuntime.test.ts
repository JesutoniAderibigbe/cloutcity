import { afterEach, describe, expect, it } from 'vitest'
import { guestSessionStore } from '@/state/guestSession'
import { tripStore } from '@/state/trip'
import { activityFor, currentAnnounce, presenceMode } from './presenceRuntime'

const boroughOf = new Map([
  ['late-lantern-deli', 'queens'],
  ['bridge-walk', 'brooklyn'],
])
const idle = {
  active: null,
  progress: 0,
  animator: false,
  arrival: null,
  arrivalEventsSuppressed: false,
}

afterEach(() => {
  tripStore.setState({ ...idle, spot: null })
})

describe('presenceMode', () => {
  it('only an account announces; a guest watches; anyone else sees the public view', () => {
    expect(presenceMode('permanent')).toBe('announce')
    expect(presenceMode('anonymous')).toBe('view')
    for (const status of ['idle', 'refused', 'local', 'connecting'] as const) {
      expect(presenceMode(status)).toBe('public')
    }
    expect(presenceMode()).toBe(presenceMode(guestSessionStore.getState().status))
  })

  it('an account in ghost mode only watches', () => {
    expect(presenceMode('permanent', true)).toBe('view')
    expect(presenceMode('permanent', false)).toBe('announce')
    // Unknown until the first read: the server drops a ghost's beat anyway.
    expect(presenceMode('permanent', null)).toBe('announce')
    expect(presenceMode('anonymous', true)).toBe('view')
  })
})

describe('activityFor', () => {
  it('a place action announces what the player does there; a flex announces nothing', () => {
    expect(activityFor('glowmatic', 'club-night')).toEqual({
      placeId: 'glowmatic',
      activity: 'dance',
    })
    expect(activityFor('golden-hour-roof', 'rooftop-hang')?.activity).toBe('lounge')
    expect(activityFor('glowmatic', 'flex')).toBeNull()
  })
})

describe('currentAnnounce', () => {
  it('a place: its pin id and borough, nothing finer', () => {
    expect(
      currentAnnounce(
        boroughOf,
        { ...idle, spot: { kind: 'place', placeId: 'late-lantern-deli' } },
        'queens-room',
      ),
    ).toEqual({ spot: 'place', place: 'late-lantern-deli', borough: 'queens', activity: null })
  })

  it('home: only the home borough, never the home', () => {
    expect(currentAnnounce(boroughOf, { ...idle, spot: { kind: 'home' } }, 'brooklyn-1br')).toEqual(
      { spot: 'home', place: null, borough: 'brooklyn', activity: null },
    )
  })

  it('travelling: the destination borough', () => {
    const active = {
      id: 1,
      destination: { kind: 'place' as const, placeId: 'bridge-walk' },
      mode: 'walk' as const,
      route: { legs: [] } as never,
      realRoute: { legs: [] } as never,
      departMinute: 0,
      arriveMinute: 10,
      durationMs: 1000,
      startedAtMs: 0,
    }
    expect(
      currentAnnounce(boroughOf, { ...idle, active, spot: { kind: 'home' } }, 'queens-room'),
    ).toEqual({ spot: 'travelling', place: null, borough: 'brooklyn', activity: null })
  })

  it('the last place action at the place the player stands at, never at another', () => {
    const at = { ...idle, spot: { kind: 'place' as const, placeId: 'late-lantern-deli' } }
    expect(
      currentAnnounce(boroughOf, at, null, { placeId: 'late-lantern-deli', activity: 'chat' })
        ?.activity,
    ).toBe('chat')
    expect(
      currentAnnounce(boroughOf, at, null, { placeId: 'bridge-walk', activity: 'dance' })?.activity,
    ).toBeNull()
  })

  it('nothing before the save is read, or for a place with no known borough', () => {
    expect(currentAnnounce(boroughOf, { ...idle, spot: null }, 'queens-room')).toBeNull()
    expect(
      currentAnnounce(boroughOf, { ...idle, spot: { kind: 'place', placeId: 'nowhere' } }, null),
    ).toBeNull()
  })
})
