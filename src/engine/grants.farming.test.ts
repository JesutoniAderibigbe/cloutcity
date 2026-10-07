/**
 * Farming probes (S15, ECON-1): repeated prestige plus re-claiming never pays more than the
 * per-run ceilings and never carries value into the next run; a tampered grant log over its
 * limit loads with the current run's claims still claimed.
 */
import { describe, expect, it } from 'vitest'
import { appendClout, cloutSums, totalClout } from './clout'
import { engineConfig as config } from './config'
import { claimableCount, goalClout, syncGoals } from './goals'
import { claimedGrantKeys, goalGrantKey, grant, grantCeilings, type GrantRecord } from './grants'
import { emptyInventory } from './items'
import { prestige } from './prestige'
import { initialRent } from './rent'
import { createSaveSchema, initialSave, loadSave, type SaveState } from './save'

const schema = createSaveSchema(config)
const MS = 1_760_000_000_000
const club = Object.keys(config.place.clubs)[0] ?? ''
const landmark = [...config.places].find(([, category]) => category !== 'memorial')?.[0] ?? ''

/** Earned (event) clout until goal clout reaches `target`. */
function earnTo(save: SaveState, target: number): SaveState {
  const missing = target - goalClout(save.player, config)
  if (missing <= 0) return save
  const clout = appendClout(
    save.player.clout,
    { source: 'event', amount: missing, ref: { eventId: 'probe', choiceId: 'probe' } },
    save.clock.minute,
    config,
  ).state
  return { ...save, player: { ...save.player, clout } }
}

/** Claims every reward ready to claim; returns the save and what the claims applied. */
function claimAll(save: SaveState) {
  let out = save
  const applied = { cash: 0, clout: 0 }
  for (const goal of config.goals) {
    const result = grant(
      out,
      { kind: 'goal_reward', goalId: goal.id, reward: goal.reward },
      MS,
      config,
    )
    if (!result.ok || result.replayed) continue
    out = result.save
    applied.cash += result.record.applied.cash
    applied.clout += result.record.applied.clout
  }
  return { save: out, applied }
}

describe('prestige farming (ECON-1)', () => {
  it('six runs of reach-everything, claim-everything, prestige: each run within its ceilings, nothing carried', () => {
    const ceilings = grantCeilings(config)
    const premium = 150
    let save: SaveState = {
      ...initialSave(config),
      clock: { minute: 10_000, remainderMs: 0 },
    }
    save = {
      ...save,
      player: {
        ...save.player,
        clout: appendClout(
          save.player.clout,
          { source: 'premium', amount: premium, ref: { itemId: 'probe', op: 'grant' } },
          0,
          config,
        ).state,
      },
    }
    const levels = config.clout.levels.map((level) => level.minClout).filter((min) => min > 0)
    for (let run = 1; run <= 6; run++) {
      expect(save.goals.run).toBe(run)
      const runApplied = { cash: 0, clout: 0 }
      save = {
        ...save,
        clock: { minute: save.clock.minute + 100, remainderMs: 0 },
        player: {
          ...save.player,
          clout: { ...save.player.clout, firstPaycheckPaid: true },
          visited: { [landmark]: save.clock.minute },
          clubNights: { [club]: 1 },
        },
      }
      // Claim at every rung (when the caps are widest), then try a second sweep: no more.
      for (const target of levels) {
        save = syncGoals(earnTo(save, target), config).save
        const swept = claimAll(save)
        save = swept.save
        runApplied.cash += swept.applied.cash
        runApplied.clout += swept.applied.clout
        expect(claimAll(save).applied).toEqual({ cash: 0, clout: 0 })
      }
      expect(save.goals.icon.reachedAt).not.toBeNull()
      expect(runApplied.cash).toBeLessThanOrEqual(ceilings.perRun.cash)
      expect(runApplied.clout).toBeLessThanOrEqual(ceilings.perRun.clout)

      const next = prestige(save, MS + run, config)
      if (!next.ok) throw new Error(next.error.code)
      save = next.save
      // A second prestige in a row is refused: the new run has not reached Icon.
      expect(prestige(save, MS + run, config)).toEqual({ ok: false, error: { code: 'NOT_YET' } })

      // Nothing of the run's value carries over, only premium clout, badges and the audit log.
      const sums = cloutSums(save.player.clout)
      expect(save.player.cash).toBe(config.startCash)
      expect(sums.earned).toBe(0)
      expect(sums.premium).toBe(premium)
      expect(totalClout(save.player, config)).toBe(
        Math.min(premium, config.clout.caps.byCurrency.usd),
      )
      expect(goalClout(save.player, config)).toBe(0)
      expect(save.player.inventory).toEqual(emptyInventory)
      expect(save.player.rent).toEqual(initialRent)
      expect(save.player.flex.byPlace).toEqual({})
      expect(save.player.visited).toEqual({})
      expect(save.player.clubNights).toEqual({})
      expect(save.goals.achieved).toEqual({})
      expect(claimableCount(save, config)).toBe(0)
      expect(save.prestige.count).toBe(run)
      expect(save.prestige.badges).toEqual(config.prestige.badgeIds.slice(0, Math.min(run, 3)))
      // The previous run's keys stay claimed in the log; the new run's are fresh.
      const claimed = claimedGrantKeys(save)
      expect(claimed.has(goalGrantKey('first-paycheck', run))).toBe(true)
      expect(claimed.has(goalGrantKey('first-paycheck', run + 1))).toBe(false)
      expect(schema.safeParse(save).success).toBe(true)
    }
  })
})

describe('a tampered grant log over its limit', () => {
  it('loads with the newest records kept, so the current run stays claimed', () => {
    const max = config.grants.log.maxEntries
    const run = max + 5
    // Old runs' badge records (one per run), then the current run's paycheck claim.
    const old: GrantRecord[] = Array.from({ length: max + 3 }, (_, i) => ({
      seq: i + 1,
      key: goalGrantKey('reach-icon', i + 1),
      kind: 'goal_reward',
      eligibility: { rule: 'goal-achieved', goalId: 'reach-icon', run: i + 1 },
      reason: 'Goal reward: reach-icon',
      requested: { cash: 0, clout: 0, badge: 'prestige-3' },
      cap: { cash: 0, clout: 0 },
      applied: { cash: 0, clout: 0, badge: 'prestige-3' },
      at: 0,
      issuedAtMs: MS,
      issuedBy: 'system',
      campaignId: null,
      sync: 'local',
    }))
    const current: GrantRecord = {
      ...old[0]!,
      seq: max + 4,
      key: goalGrantKey('first-paycheck', run),
      eligibility: { rule: 'goal-achieved', goalId: 'first-paycheck', run },
      reason: 'Goal reward: first-paycheck',
      requested: { cash: 25, clout: 5, badge: null },
      cap: { cash: 25, clout: 0 },
      applied: { cash: 25, clout: 0, badge: null },
    }
    const base = initialSave(config)
    const raw = JSON.parse(
      JSON.stringify({
        ...base,
        clock: { minute: 100, remainderMs: 0 },
        player: { ...base.player, clout: { ...base.player.clout, firstPaycheckPaid: true } },
        goals: { run, achieved: { 'first-paycheck': 50 }, icon: base.goals.icon },
        grants: { log: [...old, current], nextSeq: max + 5 },
      }),
    ) as unknown
    const loaded = loadSave(raw, config)
    if (!loaded.ok) throw new Error(loaded.issues.join(', '))
    expect(loaded.repaired).toContain('grants')
    expect(loaded.save.grants.log).toHaveLength(max)
    expect(loaded.save.grants.log.at(-1)?.key).toBe(current.key)
    expect(loaded.save.goals.run).toBe(run)
    const again = grant(
      loaded.save,
      { kind: 'goal_reward', goalId: 'first-paycheck', reward: { cash: 25, clout: 5 } },
      MS,
      config,
    )
    expect(again.ok && again.replayed).toBe(true)
    expect(again.ok && again.save.player.cash).toBe(loaded.save.player.cash)
  })
})
