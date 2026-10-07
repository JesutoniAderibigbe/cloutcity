/**
 * S18c save plausibility (src/engine/plausibility.ts): normal play is always accepted (the
 * economy and flex bots replayed as uploads at a real pace), and each tampering is repaired or
 * rejected as the module comment rules.
 */
import { describe, expect, it } from 'vitest'
import baselineJson from '@data/sim/economy-baseline.derived.json'
import { sync } from '@/lib/data/config'
import { landmarks } from '@/lib/data/content'
import { EconomyBaselineSchema } from '@/lib/data/schemas/sim'
import { realMsPerGameMinute } from './clock'
import { cloutCeilings, findCloutLevel, playerLevel } from './clout'
import { engineConfig as config } from './config'
import { initialEventsState } from './events'
import { syncGoals } from './goals'
import { goalGrantKey, grant, grantCeilings, type GrantRecord } from './grants'
import { buyItem, isWearable, shopItems } from './items'
import {
  applyRepairs,
  cashCeilings,
  checkUpload,
  plausibilityCeilings,
  type Repair,
  type UploadContext,
  type Verdict,
} from './plausibility'
import { prestige } from './prestige'
import { createSaveSchema, initialSave, type SaveState } from './save'
import { runEconomyBot, type BotStep } from './sim/economyBot'
import { playerWithClout } from './test-support'

const baseline = EconomyBaselineSchema.parse(baselineJson)
const ceilings = plausibilityCeilings(config, baseline, sync)
const schema = createSaveSchema(config)
const MS = 1_760_000_000_000
const DAYS = 30
/** Real milliseconds a person takes per tap: 15 a minute, well under the ceiling. */
const TAP_MS = 4000

const ctx = (patch: Partial<UploadContext> = {}): UploadContext => ({
  realMinutesSinceAccept: 1,
  accountAgeMinutes: 24 * 60,
  serverGrantKeys: [],
  entitledItemIds: [],
  firstUpload: false,
  ...patch,
})

const check = (prev: SaveState | null, next: unknown, patch: Partial<UploadContext> = {}) =>
  checkUpload(prev, next, ctx(patch), ceilings, config)

/** A writable deep copy, for tampering. */
type Draft<T> = T extends readonly (infer U)[]
  ? Draft<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Draft<T[K]> }
    : T
const clone = (save: SaveState): Draft<SaveState> => structuredClone(save) as Draft<SaveState>

/** A bot step as the save the store would hold. */
function asSave(step: BotStep): SaveState {
  return {
    ...step.snapshot,
    speed: 1,
    events: initialEventsState(),
    goals: step.goals,
    grants: step.grants,
    prestige: step.prestige,
  }
}

interface Played {
  readonly save: SaveState
  /** Real milliseconds the step took a person: a tap, or the passive time it waited. */
  readonly realMs: number
}

const queensBallpark = (() => {
  const found = landmarks.find((landmark) => landmark.id === 'queens-ballpark')
  if (found === undefined) throw new Error('no queens-ballpark')
  return found
})()

function play(flex: boolean): Played[] {
  const steps: Played[] = []
  let minute = initialSave(config).clock.minute
  runEconomyBot(
    {
      jobId: flex ? 'barista' : 'retail',
      days: DAYS,
      upgradeTo: 'brooklyn-1br',
      claimAll: true,
      ...(flex ? { flex: { place: queensBallpark } } : {}),
      onStep: (step) => {
        const moved = step.snapshot.clock.minute - minute
        minute = step.snapshot.clock.minute
        steps.push({
          save: asSave(step),
          realMs: step.counted ? TAP_MS : moved * realMsPerGameMinute(config),
        })
      },
    },
    config,
  )
  return steps
}

const economySteps = play(false)
const flexSteps = play(true)

/**
 * Uploads `steps` as the client would: the initial save first, then one upload per `every`
 * steps, each with the real time since the last accept and the grant keys the server holds.
 */
function replay(steps: readonly Played[], every: number) {
  let prev: SaveState | null = null
  const server = new Set<string>()
  let sinceAccept = 0
  let age = 0
  const verdicts: { verdict: Verdict; upload: SaveState }[] = []
  const upload = (save: SaveState, first: boolean) => {
    const verdict = check(prev, save, {
      realMinutesSinceAccept: sinceAccept / 60_000,
      accountAgeMinutes: age / 60_000,
      serverGrantKeys: [...server],
      firstUpload: first,
    })
    verdicts.push({ verdict, upload: save })
    if (verdict.save !== null) {
      prev = verdict.save
      sinceAccept = 0
      for (const record of verdict.grantsToInsert) server.add(record.key)
    }
  }
  upload(initialSave(config), true)
  steps.forEach((step, i) => {
    sinceAccept += step.realMs
    age += step.realMs
    if ((i + 1) % every === 0 || i === steps.length - 1) upload(step.save, false)
  })
  return { verdicts, server }
}

describe('normal play is never flagged (false-positive guard)', () => {
  it.each([
    ['economy bot (retail), every step', economySteps, 1],
    ['economy bot (retail), every 15 steps', economySteps, 15],
    ['flex bot (barista), every step', flexSteps, 1],
    ['flex bot (barista), every 15 steps', flexSteps, 15],
  ])('%s: every upload is accepted unchanged', (_label, steps, every) => {
    const { verdicts, server } = replay(steps, every)
    expect(verdicts.length).toBeGreaterThan(steps.length / every)
    for (const { verdict, upload } of verdicts) {
      const where = `day ${Math.floor(upload.clock.minute / 1440) + 1}: ${verdict.findings.join(', ')}`
      expect(verdict.outcome, where).toBe('accept')
      expect(verdict.findings, where).toEqual([])
      expect(verdict.save, where).toEqual(upload)
      expect(verdict.publicView?.level_index, where).toBe(playerLevel(upload.player, config).index)
    }
    // Every goal reward the bot claimed reached the server exactly once.
    const last = verdicts.at(-1)?.upload
    expect([...server].sort()).toEqual(last?.grants.log.map((record) => record.key).sort())
  })

  it('the bots really do earn what the checks look at: grants, flexes, a level', () => {
    const last = flexSteps.at(-1)?.save
    if (last === undefined) throw new Error('no steps')
    expect(last.grants.log.length).toBeGreaterThanOrEqual(2)
    expect(playerLevel(last.player, config).id).toBe('local')
    expect(last.player.clout.ledger.some((entry) => entry.source === 'flex')).toBe(true)
  })

  it('the public view carries the first paycheck job and the outfit', () => {
    const last = economySteps.at(-1)?.save
    if (last === undefined) throw new Error('no steps')
    const verdict = check(null, last, { firstUpload: true })
    expect(verdict.publicView).toEqual({
      level_id: 'nobody',
      level_index: 0,
      career_path: 'retail',
      cosmetics: [],
    })
  })
})

/** The flex bot's state around its first goal claim: before it, and with it. */
function aroundClaim(): { readonly prev: SaveState; readonly next: SaveState } {
  const index = flexSteps.findIndex((step) => step.save.grants.log.length > 0)
  const prev = flexSteps[index - 1]?.save
  const next = flexSteps[index]?.save
  if (prev === undefined || next === undefined) throw new Error('the bot claimed nothing')
  return { prev, next }
}

/** The flex bot's last day, accepted, and an upload a minute later. */
function lateRun(): SaveState {
  const last = flexSteps.at(-1)?.save
  if (last === undefined) throw new Error('no steps')
  return last
}

const later = (save: SaveState, minutes = 1): Draft<SaveState> => {
  const next = clone(save)
  next.clock.minute += minutes
  return next
}

const serverKeys = (save: SaveState) => save.grants.log.map((record) => record.key)

describe('tampering', () => {
  const prev = lateRun()
  const keys = serverKeys(prev)

  it('an unchanged upload a minute later is accepted', () => {
    const verdict = check(prev, later(prev), { serverGrantKeys: keys })
    expect(verdict.outcome).toBe('accept')
  })

  it('a previous save read back from jsonb (keys reordered) compares the same', () => {
    const reorder = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(reorder)
        : typeof value === 'object' && value !== null
          ? Object.fromEntries(
              Object.entries(value)
                .reverse()
                .map(([k, v]) => [k, reorder(v)]),
            )
          : value
    const stored = reorder(prev) as SaveState
    expect(JSON.stringify(stored)).not.toBe(JSON.stringify(prev))
    const verdict = check(stored, later(prev), { serverGrantKeys: keys })
    expect(verdict.outcome).toBe('accept')
  })

  it('a forged goal is dropped (SEC-9), and claiming it rejects', () => {
    const next = later(prev)
    expect(Object.keys(next.player.clubNights)).toEqual([])
    next.goals = { ...next.goals, achieved: { ...next.goals.achieved, 'first-club-night': 1 } }
    const verdict = check(prev, next, { serverGrantKeys: keys })
    expect(verdict.outcome).toBe('repair')
    expect(verdict.findings).toEqual(['goal-without-fact'])
    expect(verdict.repairs).toEqual([
      { kind: 'drop-goal', goalId: 'first-club-night', victory: false },
    ])
    expect(verdict.save?.goals.achieved).toEqual(prev.goals.achieved)

    const claimed = grant(
      { ...next, events: initialEventsState() },
      { kind: 'goal_reward', goalId: 'first-club-night', reward: { cash: 20, clout: 10 } },
      MS,
      config,
    )
    if (!claimed.ok) throw new Error(claimed.error.code)
    const rejected = check(prev, claimed.save, { serverGrantKeys: keys })
    expect(rejected.outcome).toBe('reject')
    expect(rejected.findings).toContain('grant-invalid')
    expect(rejected.save).toBeNull()
    expect(rejected.grantsToInsert).toEqual([])
  })

  it('a forged level goal is dropped when goal clout never reached the level', () => {
    const next = later(prev)
    next.goals = { ...next.goals, achieved: { ...next.goals.achieved, 'reach-known': 1 } }
    next.player = { ...next.player, clout: { ...next.player.clout, peakLevel: 3 } }
    const verdict = check(prev, next, { serverGrantKeys: keys })
    expect(verdict.findings).toContain('goal-without-fact')
    expect(verdict.findings).toContain('peak-above-reachable')
    expect(verdict.save?.player.clout.peakLevel).toBe(prev.player.clout.peakLevel)
  })

  it('a forged badge is dropped', () => {
    const next = later(prev)
    next.prestige = { ...next.prestige, badges: ['prestige-1'] }
    const verdict = check(prev, next, { serverGrantKeys: keys })
    expect(verdict.outcome).toBe('repair')
    expect(verdict.findings).toEqual(['badge-without-run'])
    expect(verdict.save?.prestige.badges).toEqual([])
  })

  it('a forged prestige history rejects', () => {
    const next = later(prev)
    next.prestige = {
      count: 1,
      badges: [],
      history: [{ run: 1, endedAt: 10, issuedAtMs: MS, badge: 'prestige-1' }],
    }
    expect(check(prev, next, { serverGrantKeys: keys }).findings).toContain('prestige-history')
  })

  it('a peak level at Icon without the goal clout for it is refused outright (DEC-13)', () => {
    const next = later(prev)
    const icon = findCloutLevel('icon', config)?.index ?? 0
    next.player = { ...next.player, clout: { ...next.player.clout, peakLevel: icon } }
    expect(check(prev, next, { serverGrantKeys: keys }).findings).toEqual(['structural'])
  })

  it('a peak level above anything the run reached drops back', () => {
    const next = later(prev)
    next.player = { ...next.player, clout: { ...next.player.clout, peakLevel: 4 } }
    const verdict = check(prev, next, { serverGrantKeys: keys })
    expect(verdict.outcome).toBe('repair')
    expect(verdict.findings).toEqual(['peak-above-reachable'])
    expect(verdict.save?.player.clout.peakLevel).toBe(prev.player.clout.peakLevel)
  })

  it('a peak level below the current level is lifted (NOTE-7)', () => {
    const next = later(prev)
    next.player = { ...next.player, clout: { ...next.player.clout, peakLevel: 0 } }
    const verdict = check(prev, next, { serverGrantKeys: keys })
    expect(verdict.findings).toEqual(['peak-below-level'])
    expect(verdict.save?.player.clout.peakLevel).toBe(playerLevel(prev.player, config).index)
  })

  const withPremium = (save: SaveState): Draft<SaveState> => {
    const next = later(save)
    const { clout } = next.player
    const entry = {
      seq: clout.nextSeq,
      at: next.clock.minute,
      amount: 1,
      currency: 'usd',
      source: 'premium',
      ref: { itemId: 'placeholder-badge', op: 'grant' },
    } as const
    next.player = {
      ...next.player,
      clout: { ...clout, ledger: [...clout.ledger.slice(1), entry], nextSeq: clout.nextSeq + 1 },
    }
    // Keep the folded sums whole: the dropped oldest entry moves into them.
    const oldest = clout.ledger[0]
    if (oldest !== undefined && clout.ledger.length === config.clout.ledger.maxEntries) {
      const bySource = { ...clout.compacted.bySource }
      bySource[oldest.source] = (bySource[oldest.source] ?? 0) + oldest.amount
      next.player.clout.compacted = { entries: clout.compacted.entries + 1, bySource }
    } else {
      next.player.clout.ledger = [...clout.ledger, entry]
    }
    return next
  }

  it('premium clout without an entitlement is dropped; with one it stays', () => {
    const next = withPremium(prev)
    const verdict = check(prev, next, { serverGrantKeys: keys })
    expect(verdict.outcome).toBe('repair')
    expect(verdict.findings).toEqual(['premium-without-entitlement'])
    expect(verdict.repairs).toEqual([{ kind: 'drop-premium', itemId: 'placeholder-badge' }])
    expect(verdict.save?.player.clout.ledger.some((e) => e.source === 'premium')).toBe(false)

    const entitled = check(prev, next, {
      serverGrantKeys: keys,
      entitledItemIds: ['placeholder-badge'],
    })
    expect(entitled.outcome).toBe('accept')
  })

  it('a claim the server already holds, made again, rejects', () => {
    const { prev: before, next: after } = aroundClaim()
    const accepted = check(before, after)
    expect(accepted.outcome).toBe('accept')
    expect(accepted.grantsToInsert.length).toBeGreaterThan(0)
    // The server took the claim (from this or another device) but the save it compares against
    // does not hold it: the record is a second payout.
    const verdict = check(before, after, { serverGrantKeys: serverKeys(after) })
    expect(verdict.outcome).toBe('reject')
    expect(verdict.findings).toContain('grant-replayed')
  })

  it.each<[string, (record: GrantRecord) => GrantRecord]>([
    ['a cap above the configured maximum', (r) => ({ ...r, cap: { ...r.cap, clout: 999 } })],
    [
      'a reward other than the configured one',
      (r) => ({
        ...r,
        requested: { ...r.requested, cash: 100 },
        cap: { ...r.cap, cash: 100 },
        applied: { ...r.applied, cash: 100 },
      }),
    ],
    [
      'a goal not reached this run',
      (r) => ({
        ...r,
        key: goalGrantKey('reach-famous', r.eligibility.run),
        eligibility: { ...r.eligibility, goalId: 'reach-famous' },
        reason: 'Goal reward: reach-famous',
        requested: { cash: 100, clout: 25, badge: null },
      }),
    ],
  ])('a grant with %s rejects', (_label, tamper) => {
    const { prev: before, next: after } = aroundClaim()
    const next = clone(after)
    const [record, ...rest] = next.grants.log
    if (record === undefined) throw new Error('no record')
    next.grants = { ...next.grants, log: [tamper(record), ...rest] }
    const verdict = check(before, next)
    expect(verdict.outcome).toBe('reject')
    expect(verdict.findings).toContain('grant-invalid')
  })

  it('grant clout the record does not show (a mismatched ledger) rejects', () => {
    const { prev: before, next: after } = aroundClaim()
    const next = clone(after)
    const ledger = next.player.clout.ledger.map((entry) =>
      entry.source === 'grant' ? { ...entry, amount: entry.amount + 50 } : entry,
    )
    next.player = { ...next.player, clout: { ...next.player.clout, ledger } }
    const verdict = check(before, next)
    expect(verdict.outcome).toBe('reject')
    expect(verdict.findings).toContain('grant-ledger-mismatch')
  })

  it('an older save after a newer one (clock and sequence back) rejects', () => {
    const older = flexSteps.at(-40)?.save
    if (older === undefined) throw new Error('no steps')
    const verdict = check(prev, older, { serverGrantKeys: keys })
    expect(verdict.outcome).toBe('reject')
    expect(verdict.findings).toContain('regressed')
  })

  it('a sequence number put back rejects', () => {
    const ahead = clone(prev)
    ahead.grants = { ...ahead.grants, nextSeq: ahead.grants.nextSeq + 3 }
    const verdict = check(ahead, later(prev), { serverGrantKeys: keys })
    expect(verdict.findings).toEqual(['regressed'])
  })

  it('a reset first paycheck or cleared club nights reject (they would pay again)', () => {
    const next = later(prev)
    next.player = { ...next.player, clout: { ...next.player.clout, firstPaycheckPaid: false } }
    next.goals = {
      ...next.goals,
      achieved: Object.fromEntries(
        Object.entries(next.goals.achieved).filter(([id]) => id !== 'first-paycheck'),
      ),
    }
    expect(check(prev, next, { serverGrantKeys: keys }).findings).toContain('regressed')
  })

  it('a clout spike rejects: one flex worth far more than any flex can give', () => {
    const next = later(prev)
    const { clout } = next.player
    const flex = clout.ledger.findLast((entry) => entry.source === 'flex')
    if (flex === undefined) throw new Error('no flex')
    const ledger = clout.ledger.map((entry) =>
      entry === flex ? { ...entry, amount: 5000 } : entry,
    )
    next.player = { ...next.player, clout: { ...clout, ledger } }
    // From the save before that flex, the spike is new in the window.
    const before = flexSteps.find((step) => step.save.player.clout.nextSeq === flex.seq)?.save
    if (before === undefined) throw new Error('no save before the flex')
    const verdict = check(before, next, { realMinutesSinceAccept: 2 })
    expect(verdict.outcome).toBe('reject')
    expect(verdict.findings).toContain('clout-rate')
  })

  it('folded legacy clout appearing mid-run rejects', () => {
    const next = later(prev)
    const { clout } = next.player
    next.player = {
      ...next.player,
      clout: {
        ...clout,
        compacted: {
          entries: clout.compacted.entries + 1,
          bySource: { ...clout.compacted.bySource, legacy: 1000 },
        },
      },
    }
    expect(check(prev, next, { serverGrantKeys: keys }).findings).toContain('clout-rate')
  })

  it('a cash spike rejects', () => {
    const next = later(prev)
    next.player = { ...next.player, cash: next.player.cash + 100_000 }
    const verdict = check(prev, next, { serverGrantKeys: keys })
    expect(verdict.outcome).toBe('reject')
    expect(verdict.findings).toEqual(['cash-flow'])
  })

  it('items that appear without being paid for reject', () => {
    const next = later(prev)
    const gifts = shopItems(config)
      .filter((item) => !isWearable(item))
      .map((item) => ({ itemId: item.id, count: config.items.maxGiftStack }))
    const value = gifts.reduce(
      (sum, stack) =>
        sum + stack.count * (shopItems(config).find((i) => i.id === stack.itemId)?.price ?? 0),
      0,
    )
    expect(value).toBeGreaterThan(ceilings.cash.perGameDay)
    next.player = { ...next.player, inventory: { ...next.player.inventory, gifts } }
    const verdict = check(prev, next, { serverGrantKeys: keys })
    expect(verdict.outcome).toBe('reject')
    expect(verdict.findings).toEqual(['cash-flow'])
  })

  it('a structurally broken upload rejects', () => {
    expect(check(prev, { ...prev, player: { cash: -1 } }).findings).toEqual(['structural'])
    expect(check(prev, null).outcome).toBe('reject')
  })
})

/** A run that reached Icon, bought a wearable, and prestiged: its look is kept. */
function prestiged(): { readonly before: SaveState; readonly after: SaveState } {
  const base = initialSave(config)
  const wearable = shopItems(config).find(isWearable)
  if (wearable === undefined) throw new Error('no wearable')
  const start = { ...base, clock: { minute: 40 * 1440, remainderMs: 0 } }
  const bought = buyItem({ ...start, player: { ...start.player, cash: 1000 } }, wearable.id, config)
  if (!bought.ok) throw new Error(bought.error.code)
  const atIcon = syncGoals(
    { ...start, player: playerWithClout(bought.snapshot.player, 5000, config) },
    config,
  ).save
  const later5 = { ...atIcon, clock: { ...atIcon.clock, minute: atIcon.clock.minute + 5 } }
  const done = prestige(later5, MS, config)
  if (!done.ok) throw new Error(done.error.code)
  return { before: atIcon, after: done.save }
}

describe('kept items (SEC-10)', () => {
  const { after } = prestiged()

  it('a prestiged run uploads cleanly as a first upload', () => {
    const verdict = check(null, after, { firstUpload: true })
    expect(verdict.findings).not.toContain('kept-item-unmarked')
    expect(verdict.findings).not.toContain('prestige-history')
  })

  it('a kept look with its mark removed is marked again (with or without a previous save)', () => {
    const next = later(after)
    next.player.inventory.wearables = next.player.inventory.wearables.map((owned) => ({
      itemId: owned.itemId,
      acquiredMinute: owned.acquiredMinute,
      worn: owned.worn,
    }))
    for (const verdict of [check(after, next), check(null, next, { firstUpload: true })]) {
      expect(verdict.findings).toContain('kept-item-unmarked')
      expect(verdict.save?.player.inventory.wearables.every((o) => o.prestigeKept === true)).toBe(
        true,
      )
    }
  })

  it('a finished run going missing from the history rejects', () => {
    const { before } = prestiged()
    const verdict = check(after, later(before, 10))
    expect(verdict.outcome).toBe('reject')
    expect(verdict.findings).toContain('regressed')
  })
})

describe('the first upload', () => {
  const last = lateRun()

  it('is never rejected for real time: a month of offline play on a new account', () => {
    const verdict = check(null, last, {
      firstUpload: true,
      realMinutesSinceAccept: 0,
      accountAgeMinutes: 0,
    })
    expect(verdict.outcome).toBe('accept')
    expect(verdict.grantsToInsert.map((r) => r.key).sort()).toEqual(serverKeys(last).sort())
  })

  it('real time binds only after it: more taps than a minute holds', () => {
    const next = later(last)
    next.player.clout.nextSeq += 1000
    expect(check(last, next, { firstUpload: true }).outcome).toBe('accept')
    const verdict = check(last, next, { realMinutesSinceAccept: 1 })
    expect(verdict.outcome).toBe('reject')
    expect(verdict.findings).toEqual(['action-rate'])
  })

  it('is still checked against game time: more cash than the days on the clock allow', () => {
    const next = clone(initialSave(config))
    next.player.cash = 1_000_000
    const verdict = check(null, next, { firstUpload: true })
    expect(verdict.outcome).toBe('reject')
    expect(verdict.findings).toEqual(['cash-flow'])
  })

  it("caps the public level by the account's age", () => {
    const known = findCloutLevel('known', config)
    if (known === undefined) throw new Error('no known level')
    const base = initialSave(config)
    // Known on legacy clout (an old save), ten game days in.
    const save = syncGoals(
      {
        ...base,
        clock: { minute: 10 * 1440, remainderMs: 0 },
        player: playerWithClout(base.player, known.minClout, config),
      },
      config,
    ).save
    const young = check(null, save, { firstUpload: true, accountAgeMinutes: 0 })
    expect(young.outcome).toBe('accept')
    expect(young.findings).toEqual(['public-level-capped'])
    expect(young.publicView?.level_index).toBeLessThan(known.index)
    const old = check(null, save, { firstUpload: true, accountAgeMinutes: 60 })
    expect(old.findings).toEqual([])
    expect(old.publicView).toMatchObject({ level_id: 'known', level_index: known.index })
  })
})

describe('applyRepairs', () => {
  const { after } = prestiged()
  const save = clone(after)
  save.player.inventory.wearables = save.player.inventory.wearables.map((owned) => ({
    itemId: owned.itemId,
    acquiredMinute: owned.acquiredMinute,
    worn: owned.worn,
  }))
  save.prestige = { ...save.prestige, badges: [...save.prestige.badges, 'prestige-2'] }
  save.goals = { ...save.goals, achieved: { 'first-outfit': save.clock.minute } }
  const repairs: Repair[] = [
    { kind: 'drop-goal', goalId: 'first-outfit', victory: false },
    { kind: 'drop-badge', badge: 'prestige-2' },
    { kind: 'mark-kept', itemId: save.player.inventory.wearables[0]?.itemId ?? '' },
    { kind: 'set-peak', peakLevel: 0 },
    { kind: 'drop-premium', itemId: null },
    { kind: 'drop-premium', itemId: 'premium-probe' },
  ]

  it('is idempotent and leaves a valid save', () => {
    const once = applyRepairs(save, repairs)
    expect(applyRepairs(once, repairs)).toEqual(once)
    expect(schema.safeParse(once).success).toBe(true)
    expect(once.goals.achieved).toEqual({})
    expect(once.prestige.badges).toEqual(after.prestige.badges)
    expect(once.player.inventory.wearables.every((owned) => owned.prestigeKept === true)).toBe(true)
  })

  it('does not change the save it is given', () => {
    const copy = clone(save)
    applyRepairs(save, repairs)
    expect(save).toEqual(copy)
  })

  it('dropping the victory goal ends the Icon moment with it', () => {
    const atIcon = prestiged().before
    expect(atIcon.goals.icon.reachedAt).not.toBeNull()
    const dropped = applyRepairs(atIcon, [
      { kind: 'drop-goal', goalId: 'reach-icon', victory: true },
    ])
    expect(dropped.goals.icon).toEqual({ reachedAt: null, acknowledged: false })
    expect(schema.safeParse(dropped).success).toBe(true)
  })
})

describe('ceilings', () => {
  it('cash: the top wage times the shifts a day holds, the best event cash, the largest grant', () => {
    expect(cashCeilings(config)).toEqual({
      shift: { perAction: 140, perGameDay: 840 },
      event: { perAction: 30, perGameDay: 60 },
      grant: { perGrant: 100 },
    })
  })

  it('every term is max(fixture x margin, theoretical), per real minute at the tap rate', () => {
    const { margin, maxActionsPerRealMinute } = sync.plausibility
    const theory = cloutCeilings(config)
    for (const source of ['paycheck', 'flex', 'club', 'event'] as const) {
      const ceiling = ceilings.clout[source]
      expect(ceiling.perAction).toBeGreaterThanOrEqual(theory.bySource[source]?.perAction ?? 0)
      expect(ceiling.perAction).toBeGreaterThanOrEqual(
        (baseline.clout.sources[source] ?? 0) * margin,
      )
      expect(ceiling.perRealMinute).toBe(ceiling.perAction * maxActionsPerRealMinute)
    }
    expect(ceilings.cash.perAction).toBe(Math.max(baseline.cash.maxGainPerAction * margin, 140, 30))
    expect(ceilings.cash.perGameDay).toBe(Math.max(baseline.cash.maxGainPerGameDay * margin, 900))
    expect(ceilings.grants).toEqual(grantCeilings(config))
  })

  it('a save at every list limit fits the upload size limit (grant log at 200)', () => {
    expect(config.grants.log.maxEntries).toBe(200)
    const base = initialSave(config)
    const record: GrantRecord = {
      seq: 1,
      key: goalGrantKey('reach-scene-regular', 999_999),
      kind: 'goal_reward',
      eligibility: { rule: 'goal-achieved', goalId: 'reach-scene-regular', run: 999_999 },
      reason: 'Goal reward: reach-scene-regular',
      requested: { cash: 100, clout: 25, badge: 'prestige-3' },
      cap: { cash: 100, clout: 25 },
      applied: { cash: 100, clout: 25, badge: 'prestige-3' },
      at: 999_999_999,
      issuedAtMs: MS,
      issuedBy: 'system',
      campaignId: null,
      sync: 'local',
    }
    const ledger = Array.from({ length: config.clout.ledger.maxEntries }, (_, i) => ({
      seq: 1_000_000 + i,
      at: 999_999_999,
      amount: 60,
      currency: 'cash' as const,
      source: 'flex' as const,
      ref: {
        placeId: 'coney-island-boardwalk',
        viral: true,
        placeMultiplier: 1.25,
        styleScore: 99,
        base: 20,
      },
    }))
    const big = {
      ...base,
      player: {
        ...base.player,
        clout: { ...base.player.clout, ledger },
        visited: Object.fromEntries(landmarks.map((landmark) => [landmark.id, 999_999_999])),
        inventory: {
          ...base.player.inventory,
          wearables: shopItems(config)
            .filter(isWearable)
            .map((item) => ({ itemId: item.id, acquiredMinute: 999_999_999, worn: true })),
        },
      },
      events: {
        ...base.events,
        history: Object.fromEntries(config.events.catalog.map((event) => [event.id, 999_999_999])),
      },
      grants: {
        log: Array.from({ length: config.grants.log.maxEntries }, (_, i) => ({
          ...record,
          seq: i + 1,
        })),
        nextSeq: 999_999,
      },
    }
    const bytes = new TextEncoder().encode(JSON.stringify(big)).length
    expect(bytes).toBeLessThan(sync.maxSaveBytes)
  })
})
