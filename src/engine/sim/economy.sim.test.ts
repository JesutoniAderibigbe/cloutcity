/**
 * S12 economy simulation: the bot (economyBot.ts) plays 30 game days on each entry job with the
 * shipped balance.json, and the result must hit the CLAUDE.md target feel. The full result is
 * also the committed baseline data/sim/economy-baseline.derived.json (S18c's plausibility
 * ceilings), so any change to the economy fails here until the baseline is regenerated.
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { balance } from '@/lib/data/config'
import { engineConfig, type EngineConfig, type HomeId } from '../config'
import { initialSnapshot } from '../game'
import { jobIds, jobLock, shiftWage } from '../jobs'
import { homeIds, rentFor } from '../rent'
import { runEconomyBot, type BotReport } from './economyBot'

const DAYS = 30
/** Whole dollars: the target's band for the best job, and a sanity envelope for every job. */
const BEST_FINAL_CASH = { min: 800, max: 1250 }
const BEST_WEEKLY_SAVINGS = { min: 115, max: 185 }
const ANY_WEEKLY_SAVINGS = { min: 80, max: 230 }
const BASELINE = '../../../data/sim/economy-baseline.derived.json'
const DRIFT_HINT =
  'The economy changed. Re-run `npm run econ:update`, check the target block still passes, ' +
  'and log the change in progress.md Tuning log.'

// toMatchFileSnapshot would quietly write a missing baseline (no CI=true here), so a deleted
// fixture would pass: refuse to run without it.
if (!existsSync(new URL(BASELINE, import.meta.url))) {
  throw new Error(`${BASELINE} is missing: run \`npm run econ:update\` and commit it`)
}

const config = engineConfig
const { target } = balance
const start = initialSnapshot(config)
const entryJobs = jobIds(config).filter((id) => jobLock(start.player, id, config) === null)

/** The first apartment upgrade: the lowest-rent home above the starting one. */
function firstUpgrade(): HomeId {
  const startRent = rentFor(config.startHome, config)
  const [upgrade] = homeIds(config)
    .filter((id) => rentFor(id, config) > startRent)
    .sort((a, b) => rentFor(a, config) - rentFor(b, config))
  if (upgrade === undefined) throw new Error('rentPerWeek has no home above the start home')
  return upgrade
}

const upgradeTo = firstUpgrade()
const runAll = (engine: EngineConfig) =>
  entryJobs.map((jobId) => runEconomyBot({ jobId, days: DAYS, upgradeTo }, engine))
const bestOf = (all: readonly BotReport[]) =>
  all.reduce((a, b) => (b.finalCash > a.finalCash ? b : a))
const reports = runAll(config)
const best = bestOf(reports)
const byJob = reports.map((report) => [report.jobId, report] as const)

function baseline(all: readonly BotReport[]) {
  const max = (pick: (report: BotReport) => number) => Math.max(...all.map(pick))
  const sources: Record<string, number> = {}
  for (const report of all) {
    for (const [kind, gain] of Object.entries(report.cloutGainBySource)) {
      sources[kind] = Math.max(sources[kind] ?? 0, gain)
    }
  }
  return {
    version: 1,
    generatedBy: 'src/engine/sim/economy.sim.test.ts',
    days: DAYS,
    bestJob: bestOf(all).jobId,
    jobs: Object.fromEntries(
      all.map((report) => [
        report.jobId,
        {
          finalCash: report.finalCash,
          minCash: report.minCash,
          weeklySavings: report.weeklySavings,
          firstAffordableDay: report.firstAffordableDay,
        },
      ]),
    ),
    cash: {
      maxGainPerAction: max((report) => report.maxCashGainPerAction),
      maxGainPerGameDay: max((report) => report.maxCashGainPerGameDay),
      maxGainPerGameHour: max((report) => report.maxCashGainPerGameHour),
    },
    clout: {
      maxGainPerAction: max((report) => report.maxCloutGainPerAction),
      maxGainPerGameDay: max((report) => report.maxCloutGainPerGameDay),
      sources,
    },
    actions: { maxPerGameDay: max((report) => report.maxActionsPerGameDay) },
  }
}

describe('economy simulation: 30 game days solo', () => {
  it('plays every entry job, and only entry jobs, toward the first upgrade', () => {
    expect(entryJobs).toEqual(['barista', 'retail', 'delivery'])
    expect(upgradeTo).toBe('brooklyn-1br')
  })

  it.each(byJob)('%s never goes broke, misses rent or misses a shift', (_, report) => {
    expect(report.minCash).toBeGreaterThanOrEqual(0)
    expect(report.missedOrEvicted).toBe(0)
    expect(report.shiftsWorked).toBe(DAYS * target.shiftsPerDay)
    expect(report.shiftsMissed).toBe(0)
  })

  it.each(byJob)('%s saves a sane amount every week', (_, report) => {
    expect(report.weeklySavings).toHaveLength(3)
    for (const saved of report.weeklySavings) {
      expect(saved).toBeGreaterThanOrEqual(ANY_WEEKLY_SAVINGS.min)
      expect(saved).toBeLessThanOrEqual(ANY_WEEKLY_SAVINGS.max)
    }
  })

  it('the best job ends neither broke nor wildly rich', () => {
    expect(best.finalCash).toBeGreaterThanOrEqual(BEST_FINAL_CASH.min)
    expect(best.finalCash).toBeLessThanOrEqual(BEST_FINAL_CASH.max)
  })

  it('the best job saves roughly the target each week', () => {
    for (const saved of best.weeklySavings) {
      expect(saved).toBeGreaterThanOrEqual(BEST_WEEKLY_SAVINGS.min)
      expect(saved).toBeLessThanOrEqual(BEST_WEEKLY_SAVINGS.max)
    }
    expect(BEST_WEEKLY_SAVINGS.min).toBeLessThan(target.weeklySavings)
    expect(BEST_WEEKLY_SAVINGS.max).toBeGreaterThan(target.weeklySavings)
  })

  it('the best job can afford the first upgrade within the target days', () => {
    const { min, max } = target.firstUpgradeGameDay
    expect(best.firstAffordableDay).not.toBeNull()
    expect(best.firstAffordableDay).toBeGreaterThanOrEqual(min)
    expect(best.firstAffordableDay).toBeLessThanOrEqual(max)
  })

  it('matches the committed baseline (the balance has not drifted)', async () => {
    expect(existsSync(new URL(BASELINE, import.meta.url)), `${BASELINE} is missing`).toBe(true)
    const json = `${JSON.stringify(baseline(reports), null, 2)}\n`
    await expect(json).toMatchFileSnapshot(BASELINE, DRIFT_HINT)
  })
})

/** Every target and envelope check above, as labels of the ones a set of runs breaks. */
function targetViolations(all: readonly BotReport[]): string[] {
  const broken = new Set<string>()
  const within = (n: number, band: { min: number; max: number }) => n >= band.min && n <= band.max
  for (const report of all) {
    if (report.minCash < 0) broken.add('went broke')
    if (report.missedOrEvicted > 0) broken.add('missed rent')
    if (report.shiftsMissed > 0 || report.shiftsWorked !== DAYS * target.shiftsPerDay) {
      broken.add('missed a shift')
    }
    const sane = report.weeklySavings.every((saved) => within(saved, ANY_WEEKLY_SAVINGS))
    if (report.weeklySavings.length !== 3 || !sane) broken.add('envelope')
  }
  const top = bestOf(all)
  if (!within(top.finalCash, BEST_FINAL_CASH)) broken.add('final cash')
  if (!top.weeklySavings.every((saved) => within(saved, BEST_WEEKLY_SAVINGS))) {
    broken.add('weekly savings')
  }
  const day = top.firstAffordableDay
  if (day === null || !within(day, target.firstUpgradeGameDay)) broken.add('upgrade day')
  return [...broken]
}

const withCatalog = (actionId: string, patch: object): EngineConfig => {
  const def = config.actions.catalog[actionId]
  if (def === undefined) throw new Error(`no ${actionId} in the catalog`)
  const catalog = { ...config.actions.catalog, [actionId]: { ...def, ...patch } }
  return { ...config, actions: { ...config.actions, catalog } }
}
const withFare = (subwayFare: number): EngineConfig => ({
  ...config,
  costs: { ...config.costs, subwayFare },
})
const committedBaseline = readFileSync(new URL(BASELINE, import.meta.url), 'utf8')
const baselineJson = (all: readonly BotReport[]) => `${JSON.stringify(baseline(all), null, 2)}\n`

describe('economy simulation: the test catches drift', () => {
  it('the shipped balance breaks no target (the helper agrees with the tests above)', () => {
    expect(targetViolations(reports)).toEqual([])
  })

  const sleepEffects = config.actions.catalog.sleep?.statEffects ?? {}
  it.each<[string, EngineConfig, string[]]>([
    [
      'deli coffee at $8',
      withCatalog('deli-coffee', { cashCost: 8 }),
      ['weekly savings', 'upgrade day'],
    ],
    [
      'sleep restoring 70 energy',
      withCatalog('sleep', { statEffects: { ...sleepEffects, energy: 70 } }),
      ['weekly savings', 'upgrade day'],
    ],
    [
      'the start home at $320 a week',
      { ...config, rentPerWeek: { ...config.rentPerWeek, [config.startHome]: 320 } },
      ['final cash', 'weekly savings'],
    ],
    ['$300 start cash', { ...config, startCash: 300 }, ['upgrade day']],
  ])('%s breaks the target layer', (_label, tuned, expected) => {
    const broken = targetViolations(runAll(tuned))
    for (const label of expected) expect(broken).toContain(label)
  })

  it('a $3 to $5 fare change is caught by the fixture layer (and the target)', () => {
    const all = runAll(withFare(5))
    expect(baselineJson(reports)).toBe(committedBaseline)
    expect(baselineJson(all)).not.toBe(committedBaseline)
    expect(targetViolations(all)).toContain('final cash')
  })

  it('a $1 fare rise passes every target band, so only the fixture layer catches it', () => {
    const all = runAll(withFare(config.costs.subwayFare + 1))
    expect(targetViolations(all)).toEqual([])
    expect(baselineJson(all)).not.toBe(committedBaseline)
  })
})

describe('economy simulation: how much the result leans on mood hitting 0', () => {
  // The bot ignores mood, so on the shipped balance mood reaches 0 and every action (shifts and
  // sleep included) takes 1.25x as long. Holding mood up (no mood decay; mood at 0 has no extra
  // decay, so this is the same as a 1x multiplier) gave, on the S12 tuning:
  //   (numbers are produced by the run below; see data/sim/economy-baseline.derived.json for the shipped ones)
  // The target still holds, so the tuning does not depend on mood hitting 0.
  const moodHeld: EngineConfig = {
    ...config,
    stats: { ...config.stats, decayPerGameHour: { ...config.stats.decayPerGameHour, mood: 0 } },
  }
  const held = runAll(moodHeld)

  it('mood at 0 does change the result (the dependency is real)', () => {
    expect(held.map((report) => report.finalCash)).not.toEqual(
      reports.map((report) => report.finalCash),
    )
  })

  it('with mood held above 0 every target and envelope still holds', () => {
    expect(targetViolations(held)).toEqual([])
  })
})

describe('economy baseline fixture (read by S18c)', () => {
  const file = JSON.parse(committedBaseline) as ReturnType<typeof baseline>
  const topWage = Math.max(...entryJobs.map((id) => shiftWage(id, config)))

  it('is stable two-space JSON with a trailing newline, as econ:update writes it', () => {
    expect(committedBaseline).toBe(`${JSON.stringify(file, null, 2)}\n`)
  })

  it('covers exactly the entry jobs over the simulated days, best job included', () => {
    expect(Object.keys(file.jobs)).toEqual(entryJobs)
    expect(file.days).toBe(DAYS)
    expect(file.bestJob).toBe(best.jobId)
  })

  it('its cash maxima are the top entry wage: per shift, per day of shifts and per hour', () => {
    expect(file.cash.maxGainPerAction).toBe(topWage)
    expect(file.cash.maxGainPerGameDay).toBe(target.shiftsPerDay * topWage)
    const topHourly = Math.max(...entryJobs.map((id) => config.jobs.hourlyWage[id]))
    expect(file.cash.maxGainPerGameHour).toBe(topHourly)
    expect(file.actions.maxPerGameDay).toBe(Math.max(...reports.map((r) => r.maxActionsPerGameDay)))
  })

  it('records no clout yet, in the shape S13 fills in', () => {
    expect(file.clout).toEqual({ maxGainPerAction: 0, maxGainPerGameDay: 0, sources: {} })
  })
})

describe('economy simulation: the bot copes with every tuned key moved by one', () => {
  // S12 tuned these keys; a nudge of 1 either way must never make the routine fall off its
  // schedule (crash on the day guard) or lose track of a shift.
  const TUNED: readonly (readonly string[])[] = [
    ['stats', 'decayPerGameHour', 'energy'],
    ['stats', 'decayPerGameHour', 'hunger'],
    ['actions', 'catalog', 'home-meal', 'cashCost'],
    ['actions', 'catalog', 'bodega-breakfast', 'cashCost'],
    ['actions', 'catalog', 'deli-coffee', 'cashCost'],
    ['actions', 'catalog', 'deli-coffee', 'statEffects', 'energy'],
    ['actions', 'catalog', 'sleep', 'statEffects', 'energy'],
    ['actions', 'catalog', 'nap', 'statEffects', 'energy'],
    ['jobs', 'energyCostPerShift', 'retail'],
    ['jobs', 'energyCostPerShift', 'delivery'],
    ['housing', 'moveInCost', 'brooklyn-1br'],
  ]

  /** A copy of the shipped config with the number at `path` moved by `delta`. */
  function nudged(path: readonly string[], delta: number): EngineConfig {
    const copy = structuredClone(config) as unknown as Record<string, unknown>
    let node = copy
    for (const key of path.slice(0, -1)) node = node[key] as Record<string, unknown>
    const leaf = path.at(-1) ?? ''
    const value = node[leaf]
    if (typeof value !== 'number') throw new Error(`${path.join('.')} is not a number`)
    node[leaf] = value + delta
    return copy as unknown as EngineConfig
  }

  const cases = TUNED.flatMap((path) =>
    [-1, 1].map((delta) => [`${path.join('.')} ${delta > 0 ? '+1' : '-1'}`, path, delta] as const),
  )

  it.each(cases)('%s: every entry job plays every day', (_label, path, delta) => {
    const tuned = nudged(path, delta)
    for (const jobId of entryJobs) {
      const report = runEconomyBot({ jobId, days: DAYS, upgradeTo }, tuned)
      expect(report.cashByDay, jobId).toHaveLength(DAYS)
      expect(report.shiftsWorked + report.shiftsMissed, jobId).toBe(DAYS * target.shiftsPerDay)
      expect(report.minCash, jobId).toBeGreaterThanOrEqual(0)
    }
  })
})
