/**
 * S18c (bug-hunter fix cycle 3, F1 and F2): "keep this device" is never a way around the
 * real-time and honest-pace checks. A shared save the history no longer keeps does not switch
 * them off, and a branch starts from the shared save's stored credits, never a full bucket.
 */
import { describe, expect, it, vi } from 'vitest'
import { engineConfig as config } from '@/engine/config'
import { findCloutLevel } from '@/engine/clout'
import { SAVE_VERSION, initialSave, type SaveState } from '@/engine/save'
import { sync } from '@/lib/data/config'
import { createLogger } from '@/lib/log'
import { serverCeilings } from './ceilings'
import {
  handleUpload,
  type CommitArgs,
  type HistorySave,
  type PlayerRecord,
  type SaveBackend,
  type StoredSave,
} from './handleUpload'

const NOW = Date.parse('2026-10-07T12:00:00Z')
const USER = '00000000-0000-4000-8000-000000000001'
const DEVICE = '00000000-0000-4000-8000-0000000000d1'
const logger = createLogger({ sink: () => {} })

/** A backend that behaves like commit_save: it stores what it accepts, credits included. */
function liveBackend(start: StoredSave, ageMinutes: number) {
  let save: StoredSave = start
  let now = NOW
  const history = new Map<number, HistorySave>()
  history.set(start.revision, {
    saveVersion: start.saveVersion,
    data: start.data,
    acceptedAt: start.acceptedAt ?? new Date(NOW).toISOString(),
    burstCreditMinutes: start.burstCreditMinutes,
    paceCredit: start.paceCredit,
  })
  const commits: CommitArgs[] = []
  const backend: SaveBackend = {
    userIdFor: vi.fn(async () => USER),
    load: vi.fn(async (): Promise<PlayerRecord> => ({
      attested: true,
      createdAt: new Date(NOW - ageMinutes * 60_000).toISOString(),
      save,
      grantKeys: [],
      entitledItemIds: [],
    })),
    saveAt: vi.fn(async (_u: string, revision: number) => history.get(revision) ?? null),
    consumeOverride: vi.fn(async () => 'ok' as const),
    commit: vi.fn(async (args: CommitArgs) => {
      commits.push(args)
      const acceptedAt = new Date(now).toISOString()
      save = {
        revision: args.expectedRevision + 1,
        saveVersion: args.saveVersion,
        data: args.data,
        acceptedAt,
        deviceId: args.deviceId,
        burstCreditMinutes: args.burstCreditMinutes,
        paceCredit: args.paceCredit,
      }
      // Like commit_save, the history row keeps the credits the save was stored with (F2).
      history.set(save.revision, {
        saveVersion: args.saveVersion,
        data: args.data,
        acceptedAt,
        burstCreditMinutes: args.burstCreditMinutes,
        paceCredit: args.paceCredit,
      })
      return { ok: true as const, revision: save.revision, acceptedAt }
    }),
    quarantine: vi.fn(async () => 'ok' as const),
  }
  return {
    backend,
    commits,
    head: () => save,
    tick: (ms: number) => (now += ms),
    now: () => now,
  }
}

const body = (save: unknown, patch: Record<string, unknown>) =>
  JSON.stringify({
    saveVersion: SAVE_VERSION,
    deviceId: DEVICE,
    clientSavedAt: NOW,
    save,
    ...patch,
  })

/** An account mid-run: the pace credit used up, accepted 10 seconds ago. */
function midRun(): StoredSave {
  const base = initialSave(config)
  const save: SaveState = { ...base, clock: { minute: 2 * 1440, remainderMs: 0 }, actions: 50 }
  return {
    revision: 10,
    saveVersion: SAVE_VERSION,
    data: save,
    acceptedAt: new Date(NOW - 10_000).toISOString(),
    deviceId: DEVICE,
    burstCreditMinutes: 0,
    paceCredit: { cash: 0, clout: 0 },
  }
}

/** Ten game days of cash in one tap, ten seconds after the last accept. */
function forged(from: SaveState): SaveState {
  return {
    ...from,
    actions: from.actions + 1,
    clock: { ...from.clock, minute: from.clock.minute + 10 * 1440 },
    player: { ...from.player, cash: from.player.cash + 5000 },
  }
}

describe('keep this device is no bypass (F1, F2)', () => {
  it('baseline: the forged window is rejected as a plain upload', async () => {
    const live = liveBackend(midRun(), 24 * 60)
    const save = live.head().data as SaveState
    const result = await handleUpload(
      { authorization: 'Bearer x', bodyText: body(forged(save), { baseRevision: 10 }) },
      live.backend,
      serverCeilings(),
      live.now(),
      logger,
    )
    expect(result.status).toBe(422)
  })

  it('overrideFromRevision: 0 (never in the history) must not switch off real-time checks', async () => {
    const live = liveBackend(midRun(), 24 * 60)
    const save = live.head().data as SaveState
    const result = await handleUpload(
      {
        authorization: 'Bearer x',
        bodyText: body(forged(save), { baseRevision: 10, overrideFromRevision: 0 }),
      },
      live.backend,
      serverCeilings(),
      live.now(),
      logger,
    )
    expect(result.status).toBe(422)
  })

  it('the pace credit is refilled only by taps, never by an upload pattern', async () => {
    // A no-op upload, then a "keep this device" branching off the save before it: full credit.
    const live = liveBackend(midRun(), 24 * 60)
    const start = live.head().data as SaveState
    live.tick(6_000)
    const dummy = await handleUpload(
      {
        authorization: 'Bearer x',
        bodyText: body(
          { ...start, clock: { ...start.clock, minute: start.clock.minute + 1 } },
          {
            baseRevision: 10,
          },
        ),
      },
      live.backend,
      serverCeilings(),
      live.now(),
      logger,
    )
    expect(dummy.status).toBe(200)
    expect(live.head().paceCredit).toEqual({ cash: 0, clout: 0 })
    live.tick(6_000)
    // Six top-wage shifts (within every per-tap and per-day ceiling), far above honest pace.
    const taps = 6
    const gain = 140 * taps
    const greedy: SaveState = {
      ...start,
      actions: start.actions + taps,
      clock: { ...start.clock, minute: start.clock.minute + 600 },
      player: { ...start.player, cash: start.player.cash + gain },
    }
    const branched = await handleUpload(
      {
        authorization: 'Bearer x',
        bodyText: body(greedy, { baseRevision: 11, overrideFromRevision: 10 }),
      },
      live.backend,
      serverCeilings(),
      live.now(),
      logger,
    )
    // Control: the same upload as a plain one (no branch) is refused on the empty credit.
    expect(branched.status).toBe(422)
  })

  it('control: six top-wage shifts on an empty credit, plain upload, is refused', async () => {
    const live = liveBackend(midRun(), 24 * 60)
    const start = live.head().data as SaveState
    live.tick(12_000)
    const greedy: SaveState = {
      ...start,
      actions: start.actions + 6,
      clock: { ...start.clock, minute: start.clock.minute + 600 },
      player: { ...start.player, cash: start.player.cash + 840 },
    }
    const plain = await handleUpload(
      { authorization: 'Bearer x', bodyText: body(greedy, { baseRevision: 10 }) },
      live.backend,
      serverCeilings(),
      live.now(),
      logger,
    )
    expect(plain.status).toBe(422)
  })

  it('the public Icon floor stays at least an hour (publicCloutPerRealMinute)', () => {
    const c = serverCeilings()
    const icon = findCloutLevel('icon', config)
    if (icon === undefined) throw new Error('no icon')
    const perMinute = sync.plausibility.publicCloutPerRealMinute
    expect((icon.minClout - c.itemCloutMax) / perMinute).toBeGreaterThanOrEqual(60)
  })
})
