import { afterEach, describe, expect, it } from 'vitest'
import { guestSessionStore } from '@/state/guestSession'
import { tripStore } from '@/state/trip'
import { currentAnnounce, presenceMode } from './presenceRuntime'

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
})

describe('currentAnnounce', () => {
  it('a place: its pin id and borough, nothing finer', () => {
    expect(
      currentAnnounce(
        boroughOf,
        { ...idle, spot: { kind: 'place', placeId: 'late-lantern-deli' } },
        'queens-room',
      ),
    ).toEqual({ spot: 'place', place: 'late-lantern-deli', borough: 'queens' })
  })

  it('home: only the home borough, never the home', () => {
    expect(currentAnnounce(boroughOf, { ...idle, spot: { kind: 'home' } }, 'brooklyn-1br')).toEqual(
      { spot: 'home', place: null, borough: 'brooklyn' },
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
    ).toEqual({ spot: 'travelling', place: null, borough: 'brooklyn' })
  })

  it('nothing before the save is read, or for a place with no known borough', () => {
    expect(currentAnnounce(boroughOf, { ...idle, spot: null }, 'queens-room')).toBeNull()
    expect(
      currentAnnounce(boroughOf, { ...idle, spot: { kind: 'place', placeId: 'nowhere' } }, null),
    ).toBeNull()
  })
})
