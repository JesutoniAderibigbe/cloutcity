/**
 * S42 phase 1: real players on the map. The heartbeat (presence_beat), the signed-in view
 * (presence_snapshot) with every safety filter, leaving, and the signed-out view
 * (presence_public_snapshot, service role only), against the local stack. S42c: real place ids
 * only, the announced activity, and ghost mode (presence_set_ghost).
 */
import realtimeJson from '@data/config/realtime.json'
import landmarksJson from '@data/landmarks/landmarks.json'
import venuesJson from '@data/venues/venues.json'
import { beforeAll, describe, expect, it } from 'vitest'
import { PRESENCE_ACTIVITY_IDS } from '@/lib/data/presenceActivities'
import {
  anonClient,
  expectRpcError,
  newAttestedGuest,
  newGuest,
  newPermanentUser,
  serviceClient,
  sql,
  type Guest,
} from './helpers'

const config = realtimeJson.presence

interface SnapshotRow {
  id: string
  handle: string
  level: string
  career: string | null
  avatar: Record<string, unknown>
  spot: string
  place: string | null
  borough: string
  activity: string | null
}

interface Snapshot {
  online: number
  ghost: boolean
  players: SnapshotRow[]
}

async function beat(
  player: Guest,
  spot = 'place',
  place: string | null = 'late-lantern-deli',
  borough = 'queens',
  activity: string | null = null,
) {
  // The generated types know no nullable arguments; the function takes a null place.
  const args = {
    p_spot: spot,
    p_place: place as string,
    p_borough: borough,
    ...(activity !== null && { p_activity: activity }),
  }
  return player.client.rpc('presence_beat', args)
}

const ghost = (player: Guest, on: boolean) =>
  player.client.rpc('presence_set_ghost', { p_ghost: on })

async function snapshot(player: Guest): Promise<Snapshot> {
  const { data, error } = await player.client.rpc('presence_snapshot')
  expect(error).toBeNull()
  return data as unknown as Snapshot
}

const ids = (snap: Snapshot) => snap.players.map((row) => row.id)

async function sanction(player: Guest, kind: 'restriction' | 'suspension' | 'ban') {
  await sql`
    insert into private.sanctions (user_id, kind, reason, ends_at, created_by)
    values (${player.id}, ${kind}, 'harassment',
      ${kind === 'ban' ? null : new Date(Date.now() + 3 * 86_400_000)}, gen_random_uuid())
  `
}

/** Two signed-in players, both on the map. */
async function pair(): Promise<[Guest, Guest]> {
  const [a, b] = await Promise.all([newPermanentUser(), newPermanentUser()])
  expect((await beat(a)).error).toBeNull()
  expect((await beat(b)).error).toBeNull()
  return [a, b]
}

beforeAll(async () => {
  // Rows left by an earlier run stay "online" for onlineTtlS; start from an empty map so the
  // snapshot's limit never hides this run's players.
  await sql`delete from private.player_presence`
})

describe('settings', () => {
  it('match data/config/realtime.json presence', async () => {
    const [row] = await sql<Record<string, number>[]>`
      select online_ttl_s, snapshot_max, beats_per_minute,
        snapshots_per_minute, ghost_toggles_per_minute
      from private.presence_settings
    `
    expect(row).toEqual({
      online_ttl_s: config.onlineTtlS,
      snapshot_max: config.snapshotMax,
      beats_per_minute: config.beatsPerMinute,
      snapshots_per_minute: config.snapshotsPerMinute,
      ghost_toggles_per_minute: config.ghostTogglesPerMinute,
    })
  })

  it('the place list matches data/venues and data/landmarks, boroughs included', async () => {
    const rows = await sql<{ id: string; borough: string }[]>`
      select id, borough from private.presence_places order by id
    `
    const places = [...venuesJson.venues, ...landmarksJson.landmarks]
      .map((place) => ({ id: place.id, borough: place.borough }))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
    expect(rows).toEqual(places)
  })

  it('the activity list matches src/lib/data/presenceActivities.ts (S43c)', async () => {
    const rows = await sql<{ id: string }[]>`select id from private.presence_activities order by id`
    expect(rows.map((row) => row.id)).toEqual([...PRESENCE_ACTIVITY_IDS].sort())
  })
})

describe('presence_beat and presence_snapshot', () => {
  it('two signed-in players see each other with their public profile only', async () => {
    const [a, b] = await pair()
    const snap = await snapshot(a)
    expect(snap.online).toBeGreaterThanOrEqual(2)
    const row = snap.players.find((r) => r.id === b.id)
    expect(row).toBeDefined()
    expect(Object.keys(row ?? {}).sort()).toEqual(
      ['activity', 'avatar', 'borough', 'career', 'handle', 'id', 'level', 'place', 'spot'].sort(),
    )
    expect(row).toMatchObject({
      spot: 'place',
      place: 'late-lantern-deli',
      borough: 'queens',
      activity: null,
    })
    expect(snap.ghost).toBe(false)
    expect(row?.handle).toMatch(/\S/)
    expect(ids(snap)).not.toContain(a.id)
  })

  it('home and travelling are announced without a place', async () => {
    const [a, b] = await pair()
    expect((await beat(b, 'home', 'late-lantern-deli', 'brooklyn')).error).toBeNull()
    let row = (await snapshot(a)).players.find((r) => r.id === b.id)
    expect(row).toMatchObject({ spot: 'home', place: null, borough: 'brooklyn' })
    expect((await beat(b, 'travelling', null, 'brooklyn')).error).toBeNull()
    row = (await snapshot(a)).players.find((r) => r.id === b.id)
    expect(row).toMatchObject({ spot: 'travelling', place: null })
  })

  it('a player at a place announces what they are doing; elsewhere it is dropped', async () => {
    const [a, b] = await pair()
    expect((await beat(b, 'place', 'glowmatic', 'queens', 'dance')).error).toBeNull()
    let row = (await snapshot(a)).players.find((r) => r.id === b.id)
    expect(row).toMatchObject({ place: 'glowmatic', activity: 'dance' })
    expect((await beat(b, 'home', null, 'brooklyn', 'dance')).error).toBeNull()
    row = (await snapshot(a)).players.find((r) => r.id === b.id)
    expect(row).toMatchObject({ spot: 'home', activity: null })
    // S43c: the everyday places' activities too (a workout at the gym).
    expect((await beat(b, 'place', 'rep-count-gym', 'queens', 'workout')).error).toBeNull()
    row = (await snapshot(a)).players.find((r) => r.id === b.id)
    expect(row).toMatchObject({ place: 'rep-count-gym', activity: 'workout' })
    expectRpcError(
      (await beat(b, 'place', 'glowmatic', 'queens', 'karaoke')).error,
      'invalid_argument',
    )
  })

  it('refuses a bad spot, place or borough', async () => {
    const a = await newPermanentUser()
    expectRpcError((await beat(a, 'roof')).error, 'invalid_argument')
    expectRpcError((await beat(a, 'place', null)).error, 'invalid_argument')
    expectRpcError((await beat(a, 'place', 'Not A Pin')).error, 'invalid_argument')
    expectRpcError((await beat(a, 'place', 'x'.repeat(65))).error, 'invalid_argument')
    // Well formed, but not a real place pin; a real pin in another borough.
    expectRpcError((await beat(a, 'place', 'not-a-real-place')).error, 'invalid_argument')
    expectRpcError((await beat(a, 'place', 'glowmatic', 'manhattan')).error, 'invalid_argument')
    expectRpcError(
      (await beat(a, 'place', 'late-lantern-deli', 'jersey')).error,
      'invalid_argument',
    )
    const [row] = await sql`select 1 from private.player_presence where user_id = ${a.id}`
    expect(row).toBeUndefined()
  })

  it('a visitor with no session can call neither', async () => {
    const anon = anonClient()
    const beatResult = await anon.rpc('presence_beat', {
      p_spot: 'home',
      p_place: null as unknown as string,
      p_borough: 'queens',
    })
    expect(beatResult.error).not.toBeNull()
    expect((await anon.rpc('presence_snapshot')).error).not.toBeNull()
    expect((await anon.rpc('presence_public_snapshot')).error).not.toBeNull()
  })

  it('an unattested session is refused', async () => {
    const guest = await newGuest()
    expectRpcError((await beat(guest)).error, 'attestation_required')
  })

  it('a guest (anonymous session) sees others but never announces', async () => {
    const [, b] = await pair()
    const guest = await newAttestedGuest()
    expectRpcError((await beat(guest)).error, 'guest_not_announced', 'PT403')
    expect(ids(await snapshot(guest))).toContain(b.id)
  })

  it('a stale beat is no longer online', async () => {
    const [a, b] = await pair()
    await sql`
      update private.player_presence
      set last_seen = now() - make_interval(secs => ${config.onlineTtlS + 1})
      where user_id = ${b.id}
    `
    expect(ids(await snapshot(a))).not.toContain(b.id)
    expect((await beat(b)).error).toBeNull()
    expect(ids(await snapshot(a))).toContain(b.id)
  })

  it('leaving takes the player off the map at once', async () => {
    const [a, b] = await pair()
    expect((await b.client.rpc('presence_leave')).error).toBeNull()
    expect(ids(await snapshot(a))).not.toContain(b.id)
  })

  it('rate-limits beats', async () => {
    const a = await newPermanentUser()
    for (let i = 0; i < config.beatsPerMinute; i++) expect((await beat(a)).error).toBeNull()
    expectRpcError((await beat(a)).error, 'rate_limited', 'PT429')
  })

  it('rate-limits snapshots', async () => {
    const a = await newPermanentUser()
    for (let i = 0; i < config.snapshotsPerMinute; i++) {
      expect((await a.client.rpc('presence_snapshot')).error).toBeNull()
    }
    expectRpcError((await a.client.rpc('presence_snapshot')).error, 'rate_limited', 'PT429')
  })
})

describe('safety filters', () => {
  it('a block hides both players from each other', async () => {
    const [a, b] = await pair()
    expect((await a.client.rpc('block_player', { p_target: b.id })).error).toBeNull()
    expect(ids(await snapshot(a))).not.toContain(b.id)
    expect(ids(await snapshot(b))).not.toContain(a.id)
  })

  it('a mute hides the muted player for the muter only', async () => {
    const [a, b] = await pair()
    expect((await a.client.rpc('mute_player', { p_target: b.id })).error).toBeNull()
    expect(ids(await snapshot(a))).not.toContain(b.id)
    expect(ids(await snapshot(b))).toContain(a.id)
  })

  it('banned and suspended players vanish and cannot announce; restricted ones still show', async () => {
    const [a, banned] = await pair()
    const [suspended, restricted] = await pair()
    await sanction(banned, 'ban')
    await sanction(suspended, 'suspension')
    await sanction(restricted, 'restriction')
    const seen = ids(await snapshot(a))
    expect(seen).not.toContain(banned.id)
    expect(seen).not.toContain(suspended.id)
    expect(seen).toContain(restricted.id)
    expectRpcError((await beat(banned)).error, 'account_banned', 'PT403')
    expectRpcError((await beat(suspended)).error, 'account_suspended', 'PT403')
    const pub = (await serviceClient().rpc('presence_public_snapshot')).data as unknown as {
      online: number
    }
    const [{ n } = { n: -1 }] = await sql<{ n: number }[]>`
      select count(*)::int as n from private.player_presence pp
      where pp.user_id in (${banned.id}, ${suspended.id})
    `
    expect(n).toBe(2)
    // The online total never counts them either.
    const [{ online } = { online: -1 }] = await sql<{ online: number }[]>`
      select count(*)::int as online from private.presence_online()
      where user_id in (${banned.id}, ${suspended.id})
    `
    expect(online).toBe(0)
    expect(pub.online).toBeGreaterThanOrEqual(2)
  })

  it('a held handle shows as the placeholder', async () => {
    const [a, b] = await pair()
    await sql`
      insert into private.content_holds (target_id, kind, content_key, source)
      select p.id, 'handle', private.handle_key(p.handle), 'auto'
      from public.profiles p where p.id = ${b.id}
    `
    const row = (await snapshot(a)).players.find((r) => r.id === b.id)
    expect(row?.handle).toBe('Player')
  })
})

describe('presence_public_snapshot (signed-out view)', () => {
  it('is the service role only', async () => {
    const a = await newPermanentUser()
    expect((await a.client.rpc('presence_public_snapshot')).error).not.toBeNull()
  })

  it('answers the online count and nothing else (S42b)', async () => {
    const [a, b] = await pair()
    const { data, error } = await serviceClient().rpc('presence_public_snapshot')
    expect(error).toBeNull()
    const pub = data as unknown as { online: number }
    expect(Object.keys(pub)).toEqual(['online'])
    expect(pub.online).toBeGreaterThanOrEqual(2)
    const text = JSON.stringify(pub)
    expect(text).not.toContain(a.id)
    expect(text).not.toContain(b.id)
    expect(text).not.toContain('late-lantern-deli')
  })
})

describe('ghost mode (S42c)', () => {
  it('a ghost leaves every snapshot and the online count at once, and still sees others', async () => {
    const [a, b] = await pair()
    const before = (await snapshot(a)).online
    expect((await ghost(b, true)).error).toBeNull()
    const seen = await snapshot(a)
    expect(ids(seen)).not.toContain(b.id)
    expect(seen.online).toBe(before - 1)
    const own = await snapshot(b)
    expect(own.ghost).toBe(true)
    expect(ids(own)).toContain(a.id)
    const [row] = await sql`select 1 from private.player_presence where user_id = ${b.id}`
    expect(row).toBeUndefined()
  })

  it("a ghost's beat announces nothing; off, the next beat shows them again", async () => {
    const [a, b] = await pair()
    expect((await ghost(b, true)).error).toBeNull()
    expect((await beat(b)).error).toBeNull()
    expect(ids(await snapshot(a))).not.toContain(b.id)
    const [row] = await sql`select 1 from private.player_presence where user_id = ${b.id}`
    expect(row).toBeUndefined()
    expect((await ghost(b, false)).error).toBeNull()
    expect((await snapshot(b)).ghost).toBe(false)
    expect((await beat(b)).error).toBeNull()
    expect(ids(await snapshot(a))).toContain(b.id)
  })

  it('needs an attested session and a yes or no, and is rate-limited', async () => {
    expectRpcError((await ghost(await newGuest(), true)).error, 'attestation_required')
    expect((await anonClient().rpc('presence_set_ghost', { p_ghost: true })).error).not.toBeNull()
    const a = await newPermanentUser()
    const nullArg = { p_ghost: null as unknown as boolean }
    expectRpcError((await a.client.rpc('presence_set_ghost', nullArg)).error, 'invalid_argument')
    for (let i = 0; i < config.ghostTogglesPerMinute; i++) {
      expect((await ghost(a, i % 2 === 0)).error).toBeNull()
    }
    expectRpcError((await ghost(a, true)).error, 'rate_limited', 'PT429')
  })

  it('other players never see the flag', async () => {
    const [a, b] = await pair()
    const text = JSON.stringify((await snapshot(a)).players.find((r) => r.id === b.id))
    expect(text).not.toContain('ghost')
  })
})
