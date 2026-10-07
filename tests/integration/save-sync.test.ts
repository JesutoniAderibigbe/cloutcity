/**
 * S18c cloud save sync against the local stack: POST /api/save's handler with the real
 * service-role backend, commit_save and quarantine_save, the public projection (INT-10), the
 * hidden flag columns and set_audio_settings. Each test signs in fresh guests.
 */
import { describe, expect, it } from 'vitest'
import { engineConfig as config } from '@/engine/config'
import { syncGoals } from '@/engine/goals'
import { grant } from '@/engine/grants'
import { SAVE_VERSION, initialSave, type SaveState } from '@/engine/save'
import { playerWithClout } from '@/engine/test-support'
import { createLogger } from '@/lib/log'
import type { UploadReply } from '@/lib/sync/protocol'
import { serverCeilings } from '@/server/saves/ceilings'
import { handleUpload } from '@/server/saves/handleUpload'
import { supabaseSaveBackend } from '@/server/saves/supabaseBackend'
import {
  expectRpcError,
  newAttestedGuest,
  newGuest,
  serviceClient,
  sql,
  type Guest,
} from './helpers'

const logger = createLogger({ sink: () => {} })
const backend = supabaseSaveBackend(serviceClient())

async function tokenOf(guest: Guest): Promise<string> {
  const { data } = await guest.client.auth.getSession()
  const token = data.session?.access_token
  if (token === undefined) throw new Error('no session')
  return token
}

async function upload(
  guest: Guest,
  save: unknown,
  baseRevision: number,
  deviceId = crypto.randomUUID(),
): Promise<{ status: number; body: UploadReply }> {
  return handleUpload(
    {
      authorization: `Bearer ${await tokenOf(guest)}`,
      bodyText: JSON.stringify({
        saveVersion: SAVE_VERSION,
        baseRevision,
        deviceId,
        clientSavedAt: Date.now(),
        save,
      }),
    },
    backend,
    serverCeilings(),
    Date.now(),
    logger,
  )
}

async function profileOf(id: string) {
  const [row] = await sql<{ public_level: string; career_path: string | null; avatar: unknown }[]>`
    select public_level, career_path, avatar from public.profiles where id = ${id}
  `
  return row
}

/** A save with the Local goal reached and its reward claimed. */
function claimedSave(): SaveState {
  const base = initialSave(config)
  const reached = syncGoals(
    { ...base, player: playerWithClout(base.player, 150, config) },
    config,
  ).save
  const claimed = grant(
    reached,
    { kind: 'goal_reward', goalId: 'reach-local', reward: { cash: 50, clout: 15 } },
    Date.now(),
    config,
  )
  if (!claimed.ok) throw new Error(claimed.error.code)
  return { ...claimed.save, actions: 1 }
}

/** Pushes the save's last accept back, so the next upload is past the rate limit. */
async function ageAccept(guest: Guest, seconds = 30): Promise<void> {
  await sql`
    update public.saves
    set accepted_at = accepted_at - make_interval(secs => ${seconds}),
        rate_window_started_at = rate_window_started_at - make_interval(secs => ${seconds})
    where user_id = ${guest.id}
  `
}

describe('POST /api/save against the real database', () => {
  it('stores a first upload at revision 1 and projects the public profile', async () => {
    const guest = await newAttestedGuest()
    const result = await upload(guest, initialSave(config), 0)
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ ok: true, revision: 1 })
    const { data, error } = await guest.client
      .from('saves')
      .select('revision, save_version, accepted_at, last_device_id')
      .single()
    expect(error).toBeNull()
    expect(data).toMatchObject({ revision: 1, save_version: SAVE_VERSION })
    expect(await profileOf(guest.id)).toEqual({
      public_level: 'nobody',
      career_path: null,
      avatar: { cosmetics: [] },
    })
    const [history] = await sql<{ count: number }[]>`
      select count(*)::int as count from private.save_history where user_id = ${guest.id}
    `
    expect(history?.count).toBe(1)
  })

  it('CAS: two first uploads at once store exactly one; the other conflicts', async () => {
    const guest = await newAttestedGuest()
    const results = await Promise.all([
      upload(guest, initialSave(config), 0),
      upload(guest, initialSave(config), 0),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    const conflict = results.find((r) => r.status === 409)?.body
    expect(conflict).toMatchObject({ ok: false, code: 'conflict', cloud: { revision: 1 } })
  })

  it('an upload on a stale revision conflicts with the cloud copy', async () => {
    const guest = await newAttestedGuest()
    expect((await upload(guest, initialSave(config), 0)).status).toBe(200)
    const stale = await upload(guest, initialSave(config), 0)
    expect(stale.status).toBe(409)
  })

  it('a second accepted upload within minUploadIntervalMs is rate limited (429)', async () => {
    const guest = await newAttestedGuest()
    expect((await upload(guest, initialSave(config), 0)).status).toBe(200)
    const again = await upload(guest, initialSave(config), 1)
    expect(again).toMatchObject({ status: 429, body: { code: 'rate-limited' } })
    await ageAccept(guest)
    expect((await upload(guest, initialSave(config), 1)).status).toBe(200)
  })

  it('a tampered save is quarantined and flagged, and the public level does not move', async () => {
    const guest = await newAttestedGuest()
    expect((await upload(guest, initialSave(config), 0)).status).toBe(200)
    await ageAccept(guest)
    const fresh = initialSave(config)
    const famous = config.clout.levels.find((level) => level.id === 'famous')
    if (famous === undefined) throw new Error('no famous level')
    const tampered = syncGoals(
      { ...fresh, player: playerWithClout(fresh.player, famous.minClout, config) },
      config,
    ).save
    const result = await upload(guest, { ...tampered, actions: 1 }, 1)
    expect(result).toEqual({ status: 422, body: { ok: false, code: 'rejected' } })
    expect((await profileOf(guest.id))?.public_level).toBe('nobody')
    const [save] = await sql<{ revision: number; flagged: boolean; reason: string | null }[]>`
      select revision::int as revision, flagged_at is not null as flagged, flag_reason as reason
      from public.saves where user_id = ${guest.id}
    `
    expect(save).toMatchObject({ revision: 1, flagged: true })
    expect(save?.reason).toContain('clout-rate')
    const [kept] = await sql<{ count: number }[]>`
      select count(*)::int as count from private.save_quarantine where user_id = ${guest.id}
    `
    expect(kept?.count).toBe(1)
  })

  it('shows a premium cosmetic only once the server holds its entitlement', async () => {
    const guest = await newAttestedGuest()
    const base = initialSave(config)
    const premium = {
      ...base,
      player: {
        ...base.player,
        clout: {
          ...base.player.clout,
          ledger: [
            {
              seq: 1,
              at: 0,
              amount: 10,
              currency: 'usd',
              source: 'premium',
              ref: { itemId: 'premium-probe', op: 'grant' },
            },
          ],
          nextSeq: 2,
        },
      },
    }
    const first = await upload(guest, premium, 0)
    expect(first.status).toBe(200)
    expect((await profileOf(guest.id))?.avatar).toEqual({ cosmetics: [] })

    const service = serviceClient()
    const granted = await service
      .from('grants')
      .insert({
        user_id: guest.id,
        kind: 'compensation',
        idempotency_key: `test:${crypto.randomUUID()}`,
        cash_amount: 0,
        clout_amount: 0,
        cap_amount: 0,
        clout_cap: 0,
        eligibility: { test: true },
        reason: 'test entitlement',
        issued_by: 'system',
      })
      .select('id')
      .single()
    if (granted.error !== null) throw granted.error
    const entitled = await service.from('entitlements').insert({
      user_id: guest.id,
      item_id: 'premium-probe',
      source: 'grant',
      grant_id: granted.data.id,
    })
    expect(entitled.error).toBeNull()
    await ageAccept(guest)
    const second = await upload(guest, premium, 1)
    expect(second.status).toBe(200)
    expect((await profileOf(guest.id))?.avatar).toEqual({ cosmetics: ['premium-probe'] })
  })

  it('grants: inserted once with their caps, idempotent on re-upload, the same key for two users', async () => {
    const [a, b] = await Promise.all([newAttestedGuest(), newAttestedGuest()])
    const save = claimedSave()
    const first = await upload(a, save, 0)
    expect(first.body).toMatchObject({ ok: true, syncedGrantKeys: ['goal:reach-local:r1'] })
    await ageAccept(a)
    expect((await upload(a, save, 1)).status).toBe(200)
    expect((await upload(b, save, 0)).status).toBe(200)
    const rows = await sql<{ user_id: string; clout_cap: number; applied: boolean }[]>`
      select user_id, clout_cap, applied_at is not null as applied from public.grants
      where idempotency_key = 'goal:reach-local:r1' and user_id in (${a.id}, ${b.id})
      order by user_id
    `
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.applied).toBe(true)
      expect(row.clout_cap).toBe(save.grants.log[0]?.cap.clout)
    }
  })

  it('a guest without the attestation is refused (403), and so is commit_save for them', async () => {
    const guest = await newGuest()
    const result = await upload(guest, initialSave(config), 0)
    expect(result).toEqual({ status: 403, body: { ok: false, code: 'attestation-required' } })
    const { error } = await serviceClient().rpc('commit_save', {
      p_user_id: guest.id,
      p_expected_revision: 0,
      p_save_version: SAVE_VERSION,
      p_data: {},
      p_device_id: crypto.randomUUID(),
      p_client_saved_at: null as unknown as string,
      p_public_level: 'nobody',
      p_career_path: null as unknown as string,
      p_same_run: false,
      p_avatar: {},
      p_grants: [],
      p_burst_credit_minutes: 0,
      p_min_interval_ms: 0,
      p_max_per_minute: 10,
      p_history_keep: 5,
    })
    expectRpcError(error, 'attestation_required', 'PT403')
  })
})

describe('what clients can and cannot do', () => {
  it('cannot call commit_save or quarantine_save, nor write saves', async () => {
    const guest = await newAttestedGuest()
    const commit = await guest.client.rpc('commit_save', {
      p_user_id: guest.id,
      p_expected_revision: 0,
      p_save_version: SAVE_VERSION,
      p_data: {},
      p_device_id: crypto.randomUUID(),
      p_client_saved_at: null as unknown as string,
      p_public_level: 'icon',
      p_career_path: null as unknown as string,
      p_same_run: false,
      p_avatar: {},
      p_grants: [],
      p_burst_credit_minutes: 0,
      p_min_interval_ms: 0,
      p_max_per_minute: 10,
      p_history_keep: 5,
    })
    expect(commit.error).not.toBeNull()
    const quarantine = await guest.client.rpc('quarantine_save', {
      p_user_id: guest.id,
      p_base_revision: 0,
      p_save_version: SAVE_VERSION,
      p_data: {},
      p_findings: ['x'],
      p_device_id: crypto.randomUUID(),
      p_max_per_minute: 10,
      p_quarantine_keep: 5,
    })
    expect(quarantine.error).not.toBeNull()
    const insert = await guest.client
      .from('saves')
      .insert({ user_id: guest.id, save_version: SAVE_VERSION, data: {} })
    expect(insert.error).not.toBeNull()
    const update = await guest.client
      .from('profiles')
      .update({ public_level: 'icon' })
      .eq('id', guest.id)
    expect(update.error).not.toBeNull()
    expect((await profileOf(guest.id))?.public_level).toBe('nobody')
  })

  it('reads its own save but never the flag, rate or credit columns', async () => {
    const guest = await newAttestedGuest()
    expect((await upload(guest, initialSave(config), 0)).status).toBe(200)
    const own = await guest.client.from('saves').select('revision, data').single()
    expect(own.error).toBeNull()
    for (const column of [
      'flagged_at',
      'flag_reason',
      'rate_window_started_at',
      'rate_window_count',
      'burst_credit_minutes',
    ]) {
      const { error } = await guest.client.from('saves').select(column)
      expect(error?.code, column).toBe('42501')
    }
  })
})

describe('set_audio_settings', () => {
  const volumes = { master: 80, music: 60, sfx: 70, ambience: 50, voice: 90 }

  it('stores newer volumes and keeps them against an older change', async () => {
    const guest = await newAttestedGuest()
    const newer = new Date(Date.now() - 1000).toISOString()
    const older = new Date(Date.now() - 60_000).toISOString()
    const first = await guest.client.rpc('set_audio_settings', {
      p_volumes: volumes,
      p_updated_at: newer,
    })
    expect(first.error).toBeNull()
    expect(first.data?.[0]?.volumes).toEqual(volumes)
    const stale = await guest.client.rpc('set_audio_settings', {
      p_volumes: { ...volumes, music: 0 },
      p_updated_at: older,
    })
    expect(stale.data?.[0]?.volumes).toEqual(volumes)
    expect(Date.parse(stale.data?.[0]?.updated_at ?? '')).toBe(Date.parse(newer))
  })

  it('refuses malformed volumes and times', async () => {
    const guest = await newAttestedGuest()
    const now = new Date().toISOString()
    for (const bad of [
      { ...volumes, music: 101 },
      { ...volumes, music: 1.5 },
      { master: 1 },
      { ...volumes, extra: 1 },
    ]) {
      const { error } = await guest.client.rpc('set_audio_settings', {
        p_volumes: bad,
        p_updated_at: now,
      })
      expectRpcError(error, 'invalid_argument', 'PT400')
    }
    const future = new Date(Date.now() + 3_600_000).toISOString()
    const { error } = await guest.client.rpc('set_audio_settings', {
      p_volumes: volumes,
      p_updated_at: future,
    })
    expectRpcError(error, 'invalid_timestamp', 'PT400')
  })
})
