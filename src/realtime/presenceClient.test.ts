import realtimeJson from '@data/config/realtime.json'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RealtimeConfig } from '@/lib/data/schemas/config'
import { createFakePresence, type FakePresence } from './fakePresence'
import { createPresenceClient, type PresenceMode } from './presenceClient'
import type { Announce, PresencePlayer } from './types'

const config = realtimeJson.presence as RealtimeConfig['presence']
const deli: Announce = { spot: 'place', place: 'late-lantern-deli', borough: 'queens' }
const home: Announce = { spot: 'home', place: null, borough: 'queens' }
const other: PresencePlayer = {
  id: '00000000-0000-4000-8000-000000000001',
  handle: 'BodegaCat42',
  level: 'local',
  career: null,
  look: null,
  spot: 'place',
  place: 'late-lantern-deli',
  borough: 'queens',
}

let fake: FakePresence
let mode: PresenceMode
let where: Announce | null
let snapshots: number[]
let publics: number[]
let failures: number[]

function client() {
  return createPresenceClient({
    transport: fake,
    config,
    mode: () => mode,
    announce: () => where,
    onSnapshot: (s) => snapshots.push(s.online),
    onPublic: (s) => publics.push(s.online),
    onFailures: (n) => failures.push(n),
  })
}

/** Lets the client's awaited transport calls settle at the current fake time. */
const settle = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  fake = createFakePresence([other])
  mode = 'announce'
  where = deli
  snapshots = []
  publics = []
  failures = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('presence client', () => {
  it('an account beats and reads at once, then on their intervals', async () => {
    const c = client()
    c.start()
    await settle()
    expect(fake.beats).toEqual([deli])
    expect(snapshots).toEqual([2])
    await vi.advanceTimersByTimeAsync(config.snapshotIntervalMs)
    expect(snapshots).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(config.beatIntervalMs)
    expect(fake.beats.length).toBeGreaterThanOrEqual(2)
    c.stop()
  })

  it('announces a spot change no sooner than the rate limit allows', async () => {
    const c = client()
    c.start()
    await settle()
    where = home
    c.kick()
    await settle()
    expect(fake.beats).toEqual([deli])
    await vi.advanceTimersByTimeAsync(Math.ceil(60_000 / config.beatsPerMinute))
    expect(fake.beats).toEqual([deli, home])
    // The same spot again is not re-announced early.
    c.kick()
    await vi.advanceTimersByTimeAsync(Math.ceil(60_000 / config.beatsPerMinute))
    expect(fake.beats).toEqual([deli, home])
    c.stop()
  })

  it('a guest reads but never beats; a signed-out visitor reads the public view', async () => {
    mode = 'view'
    const guest = client()
    guest.start()
    await vi.advanceTimersByTimeAsync(config.beatIntervalMs * 2)
    expect(fake.beats).toEqual([])
    expect(snapshots.length).toBeGreaterThan(0)
    guest.stop()
    expect(fake.leaves).toBe(0)

    mode = 'public'
    fake.figures = [{ place: 'late-lantern-deli', borough: 'queens', look: null }]
    const visitor = client()
    visitor.start()
    await settle()
    expect(publics).toEqual([1])
    expect(fake.beats).toEqual([])
    visitor.stop()
  })

  it('makes no calls while hidden, and catches up when shown again', async () => {
    const c = client()
    c.setVisible(false)
    c.start()
    await vi.advanceTimersByTimeAsync(config.beatIntervalMs * 3)
    expect(fake.beats).toEqual([])
    expect(fake.snapshots).toBe(0)
    c.setVisible(true)
    await settle()
    expect(fake.beats).toEqual([deli])
    expect(fake.snapshots).toBe(1)
    c.stop()
  })

  it('backs off after failures, up to the cap, and recovers', async () => {
    const c = client()
    fake.failWith = 'unknown'
    c.start()
    await settle()
    expect(failures).toEqual([1])
    await vi.advanceTimersByTimeAsync(config.snapshotIntervalMs)
    expect(failures).toEqual([1, 2])
    // The third read waits twice the interval.
    await vi.advanceTimersByTimeAsync(config.snapshotIntervalMs)
    expect(failures).toEqual([1, 2])
    await vi.advanceTimersByTimeAsync(config.snapshotIntervalMs)
    expect(failures).toEqual([1, 2, 3])
    await vi.advanceTimersByTimeAsync(config.backoffMaxMs * 4)
    const reads = failures.length
    await vi.advanceTimersByTimeAsync(config.backoffMaxMs)
    expect(failures.length).toBeLessThanOrEqual(reads + 1)
    fake.failWith = null
    await vi.advanceTimersByTimeAsync(config.backoffMaxMs)
    expect(failures.at(-1)).toBe(0)
    c.stop()
  })

  it('waits for the save before announcing', async () => {
    where = null
    const c = client()
    c.start()
    await settle()
    expect(fake.beats).toEqual([])
    where = deli
    c.kick()
    await vi.advanceTimersByTimeAsync(Math.ceil(60_000 / config.beatsPerMinute))
    expect(fake.beats).toEqual([deli])
    c.stop()
  })

  it('leaves on stop after announcing, and on signing out', async () => {
    const c = client()
    c.start()
    await settle()
    mode = 'public'
    c.kick()
    await settle()
    expect(fake.leaves).toBe(1)
    c.stop()
    expect(fake.leaves).toBe(1)

    mode = 'announce'
    const d = client()
    d.start()
    await settle()
    d.stop()
    expect(fake.leaves).toBe(2)
    // Stopped: nothing more happens.
    await vi.advanceTimersByTimeAsync(config.beatIntervalMs * 2)
    expect(fake.beats).toHaveLength(2)
  })
})
