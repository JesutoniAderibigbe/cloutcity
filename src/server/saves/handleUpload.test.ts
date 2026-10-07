/**
 * POST /api/save's rules (S18c) against an in-memory backend: authentication, body and size
 * checks, the attestation, the save format, the revision, plausibility, and what reaches
 * commit_save and quarantine_save. tests/integration/save-sync.test.ts runs the real database.
 */
import { describe, expect, it, vi } from 'vitest'
import { engineConfig as config } from '@/engine/config'
import { syncGoals } from '@/engine/goals'
import { grant } from '@/engine/grants'
import { SAVE_VERSION, initialSave, type SaveState } from '@/engine/save'
import { playerWithClout } from '@/engine/test-support'
import { sync } from '@/lib/data/config'
import { createLogger } from '@/lib/log'
import { serverCeilings } from './ceilings'
import {
  handleUpload,
  type CommitArgs,
  type CommitOutcome,
  type PlayerRecord,
  type QuarantineArgs,
  type SaveBackend,
  type StoredSave,
} from './handleUpload'

const NOW = Date.parse('2026-10-07T12:00:00Z')
const USER = '00000000-0000-4000-8000-000000000001'
const DEVICE = '00000000-0000-4000-8000-0000000000d1'
const logger = createLogger({ sink: () => {} })

function fakeBackend(record: Partial<PlayerRecord> | null = {}) {
  const commits: CommitArgs[] = []
  const quarantined: QuarantineArgs[] = []
  let outcome: CommitOutcome | null = null
  const player: PlayerRecord | null =
    record === null
      ? null
      : {
          attested: true,
          createdAt: new Date(NOW - 24 * 3_600_000).toISOString(),
          save: null,
          grantKeys: [],
          entitledItemIds: [],
          ...record,
        }
  const backend: SaveBackend = {
    userIdFor: vi.fn(async (token: string) => (token === 'good' ? USER : null)),
    load: vi.fn(async () => player),
    commit: vi.fn(async (args: CommitArgs) => {
      commits.push(args)
      const accepted: CommitOutcome = {
        ok: true,
        revision: args.expectedRevision + 1,
        acceptedAt: 'now',
      }
      return outcome ?? accepted
    }),
    quarantine: vi.fn(async (args: QuarantineArgs) => {
      quarantined.push(args)
      return 'ok' as const
    }),
  }
  return {
    backend,
    commits,
    quarantined,
    failCommit: (next: CommitOutcome) => (outcome = next),
  }
}

const body = (save: unknown, patch: Record<string, unknown> = {}) =>
  JSON.stringify({
    saveVersion: SAVE_VERSION,
    baseRevision: 0,
    deviceId: DEVICE,
    clientSavedAt: NOW,
    save,
    ...patch,
  })

const upload = (backend: SaveBackend, text: string, authorization: string | null = 'Bearer good') =>
  handleUpload({ authorization, bodyText: text }, backend, serverCeilings(), NOW, logger)

const stored = (save: SaveState, patch: Partial<StoredSave> = {}): StoredSave => ({
  revision: 3,
  saveVersion: SAVE_VERSION,
  data: save,
  acceptedAt: new Date(NOW - 60_000).toISOString(),
  deviceId: DEVICE,
  burstCreditMinutes: sync.plausibility.burstRealMinutes,
  ...patch,
})

describe('POST /api/save', () => {
  const fresh = initialSave(config)

  it('needs a Bearer token for a real user', async () => {
    const { backend } = fakeBackend()
    expect((await upload(backend, body(fresh), null)).status).toBe(401)
    expect((await upload(backend, body(fresh), 'Bearer bad')).status).toBe(401)
    expect((await upload(backend, body(fresh), 'Basic good')).status).toBe(401)
  })

  it('refuses a malformed body and an oversized save', async () => {
    const { backend } = fakeBackend()
    expect((await upload(backend, '{')).body).toEqual({ ok: false, code: 'invalid' })
    expect((await upload(backend, body(fresh, { deviceId: 'phone' }))).status).toBe(400)
    expect((await upload(backend, body(fresh, { extra: 1 }))).status).toBe(400)
    const huge = { ...fresh, padding: 'x'.repeat(sync.maxSaveBytes) }
    expect((await upload(backend, body(huge))).status).toBe(413)
  })

  it('refuses an account without the 18+ attestation, or without a profile', async () => {
    expect((await upload(fakeBackend({ attested: false }).backend, body(fresh))).status).toBe(403)
    expect((await upload(fakeBackend(null).backend, body(fresh))).status).toBe(403)
  })

  it('refuses another save format', async () => {
    const { backend } = fakeBackend()
    const result = await upload(backend, body(fresh, { saveVersion: SAVE_VERSION + 1 }))
    expect(result).toEqual({
      status: 409,
      body: { ok: false, code: 'version', serverVersion: SAVE_VERSION },
    })
  })

  it('a first upload is stored at revision 1 with the public projection', async () => {
    const { backend, commits } = fakeBackend()
    const result = await upload(backend, body(fresh))
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ ok: true, revision: 1, repairs: [], syncedGrantKeys: [] })
    expect(commits[0]).toMatchObject({
      userId: USER,
      expectedRevision: 0,
      saveVersion: SAVE_VERSION,
      deviceId: DEVICE,
      publicLevel: 'nobody',
      careerPath: null,
      sameRun: false,
      avatar: { cosmetics: [] },
      grants: [],
      burstCreditMinutes: sync.plausibility.burstRealMinutes,
    })
  })

  it('an upload based on an older revision conflicts and gets the cloud copy', async () => {
    const { backend, commits } = fakeBackend({ save: stored(fresh) })
    const result = await upload(backend, body(fresh, { baseRevision: 2 }))
    expect(result.status).toBe(409)
    expect(result.body).toMatchObject({ ok: false, code: 'conflict', cloud: { revision: 3 } })
    expect(commits).toEqual([])
  })

  it('a tampered save is kept aside, not stored (422)', async () => {
    const { backend, commits, quarantined } = fakeBackend({ save: stored(fresh) })
    const rich = { ...fresh, player: { ...fresh.player, cash: 1_000_000 } }
    const result = await upload(backend, body(rich, { baseRevision: 3 }))
    expect(result).toEqual({ status: 422, body: { ok: false, code: 'rejected' } })
    expect(commits).toEqual([])
    expect(quarantined[0]).toMatchObject({ baseRevision: 3, findings: ['cash-flow'] })
  })

  it('a save that is not an object is quarantined wrapped', async () => {
    const { backend, quarantined } = fakeBackend({ save: stored(fresh) })
    const result = await upload(backend, body('nope', { baseRevision: 3 }))
    expect(result.status).toBe(422)
    expect(quarantined[0]?.data).toEqual({ upload: 'nope' })
  })

  it("commit_save's answers map to 409 and 429", async () => {
    const lost = fakeBackend()
    lost.failCommit({ ok: false, code: 'conflict' })
    expect((await upload(lost.backend, body(fresh))).body).toMatchObject({ code: 'conflict' })
    const busy = fakeBackend()
    busy.failCommit({ ok: false, code: 'rate-limited' })
    expect(await upload(busy.backend, body(fresh))).toEqual({
      status: 429,
      body: { ok: false, code: 'rate-limited', retryAfterMs: sync.minUploadIntervalMs },
    })
  })

  it('new grant records are inserted once and reported as synced', async () => {
    const base = initialSave(config)
    const reached = syncGoals(
      { ...base, player: playerWithClout(base.player, 150, config) },
      config,
    ).save
    const claimed = grant(
      reached,
      { kind: 'goal_reward', goalId: 'reach-local', reward: { cash: 50, clout: 15 } },
      NOW,
      config,
    )
    if (!claimed.ok) throw new Error(claimed.error.code)
    const save = { ...claimed.save, actions: 1 }
    const { backend, commits } = fakeBackend()
    const result = await upload(backend, body(save))
    expect(result.body).toMatchObject({ ok: true, syncedGrantKeys: ['goal:reach-local:r1'] })
    expect(commits[0]?.grants.map((row) => row.idempotency_key)).toEqual(['goal:reach-local:r1'])
    expect(commits[0]?.grants[0]?.user_id).toBe(USER)
  })

  it('an upload a minute after the last accept carries the burst credit forward', async () => {
    const { backend, commits } = fakeBackend({ save: stored(fresh, { burstCreditMinutes: 2 }) })
    const next = { ...fresh, clock: { ...fresh.clock, minute: fresh.clock.minute + 1 } }
    const result = await upload(backend, body(next, { baseRevision: 3 }))
    expect(result.status).toBe(200)
    expect(commits[0]).toMatchObject({ expectedRevision: 3, sameRun: true })
    // One real minute since the accept plus the two carried, less the twentieth of a minute
    // the clock's one game minute needs at the fastest speed.
    expect(commits[0]?.burstCreditMinutes).toBeCloseTo(
      3 - 1 / serverCeilings().passiveGameMinutesPerRealMinute,
    )
  })
})
