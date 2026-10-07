/**
 * S16a economy matrix (A1.4): the S12 bot plays every career path with the best and the worst
 * trait pair, on every entry job and as the flex bot, and every run must hold the same target
 * bands as the plain simulation (economy.sim.test.ts): never broke, no missed rent or shift,
 * weekly savings in the envelope, the best job in the target band, and the first upgrade
 * affordable between game day 10 and 14.
 *
 * The best and worst pairs are found, not chosen: every pair of traits plays every entry job,
 * and the pairs with the highest and lowest summed final cash are taken (ties keep the first in
 * traits.json order). The committed baseline (data/sim) stays the plain run: S18c's ceilings
 * already cover career bonuses (src/engine/clout.ts `cloutCeilings`).
 */
import { describe, expect, it } from 'vitest'
import { balance } from '@/lib/data/config'
import { landmarks } from '@/lib/data/content'
import { CAREER_PATHS } from '@/lib/data/avatarIds'
import { engineConfig as config, type JobId } from '../config'
import { initialSnapshot } from '../game'
import { jobIds, jobLock } from '../jobs'
import type { Place } from '../places'
import { runEconomyBot, type BotReport, type EconomyBotOptions } from './economyBot'
import { SIM_DAYS, targetViolations } from './targets'

const { target } = balance
const upgradeTo = 'brooklyn-1br'
const start = initialSnapshot(config)
const entryJobs = jobIds(config).filter((id) => jobLock(start.player, id, config) === null)
const flexPlace: Place = (() => {
  const found = landmarks.find((landmark) => landmark.id === 'queens-ballpark')
  if (found === undefined) throw new Error('no queens-ballpark')
  return found
})()

type Extra = Pick<EconomyBotOptions, 'traits' | 'careerPath'>
const runJobs = (extra: Extra) =>
  entryJobs.map((jobId) => runEconomyBot({ jobId, days: SIM_DAYS, upgradeTo, ...extra }, config))
const runFlex = (extra: Extra, jobId: JobId = 'barista') =>
  runEconomyBot({ jobId, days: SIM_DAYS, upgradeTo, flex: { place: flexPlace }, ...extra }, config)
const summed = (reports: readonly BotReport[]) => reports.reduce((sum, r) => sum + r.finalCash, 0)

const traitIds = config.traits.traits.map((trait) => trait.id)
const pairs = traitIds.flatMap((a, i) => traitIds.slice(i + 1).map((b) => [a, b] as const))
const scored = pairs.map((pair) => ({ pair, cash: summed(runJobs({ traits: pair })) }))
const best = scored.reduce((a, b) => (b.cash > a.cash ? b : a))
const worst = scored.reduce((a, b) => (b.cash < a.cash ? b : a))

describe('economy matrix: 4 career paths x the best and worst trait pair (S16a)', () => {
  it('plays every pair of the 8 traits, and the pairs really differ', () => {
    expect(pairs).toHaveLength(28)
    expect(best.cash).toBeGreaterThan(worst.cash)
  })

  const cases = CAREER_PATHS.flatMap((path) =>
    [
      ['best', best.pair],
      ['worst', worst.pair],
    ].map(
      ([label, pair]) =>
        [`${path}, ${String(label)} pair`, path, pair as readonly string[]] as const,
    ),
  )

  it.each(cases)('%s: every entry job meets the target bands', (_label, careerPath, traits) => {
    const reports = runJobs({ traits, careerPath })
    expect(targetViolations(reports, target)).toEqual([])
  })

  it.each(cases)(
    '%s: the flex bot pays its way and reaches Local in time',
    (_l, careerPath, traits) => {
      const report = runFlex({ traits, careerPath })
      expect(report.minCash).toBeGreaterThanOrEqual(0)
      expect(report.missedOrEvicted).toBe(0)
      expect(report.shiftsMissed).toBe(0)
      expect(report.levelReachedDay.local).toBeGreaterThanOrEqual(8)
      expect(report.levelReachedDay.local).toBeLessThanOrEqual(20)
    },
  )

  it('only the influencer flexes to more clout; no path changes the money', () => {
    const plain = runFlex({})
    for (const careerPath of CAREER_PATHS) {
      const report = runFlex({ careerPath })
      expect(report.finalCash, careerPath).toBe(plain.finalCash)
      if (careerPath === 'influencer') expect(report.finalClout).toBeGreaterThan(plain.finalClout)
      else expect(report.finalClout, careerPath).toBe(plain.finalClout)
    }
  })
})
