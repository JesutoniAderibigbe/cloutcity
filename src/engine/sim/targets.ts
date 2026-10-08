/**
 * The CLAUDE.md "target feel" as checks on economy bot runs (S12), shared by the economy
 * simulation (economy.sim.test.ts) and the S16a career-path and trait matrix
 * (economy.matrix.test.ts), so both hold every run to the same bands.
 */
import type { BotReport } from './economyBot'

/** Game days every simulation plays. */
export const SIM_DAYS = 30
/** Whole dollars: the target's band for the best job, and a sanity envelope for every job. */
export const BEST_FINAL_CASH = { min: 800, max: 1250 }
export const BEST_WEEKLY_SAVINGS = { min: 115, max: 185 }
export const ANY_WEEKLY_SAVINGS = { min: 80, max: 230 }

/** balance.json `target`. */
export interface TargetFeel {
  readonly shiftsPerDay: number
  readonly firstUpgradeGameDay: { readonly min: number; readonly max: number }
}

/** The run that ended with the most cash. */
export function bestOf(all: readonly BotReport[]): BotReport {
  return all.reduce((a, b) => (b.finalCash > a.finalCash ? b : a))
}

/** Every target and envelope check, as labels of the ones a set of job runs breaks. */
export function targetViolations(all: readonly BotReport[], target: TargetFeel): string[] {
  const broken = new Set<string>()
  const within = (n: number, band: { min: number; max: number }) => n >= band.min && n <= band.max
  for (const report of all) {
    if (report.minCash < 0) broken.add('went broke')
    if (report.missedOrEvicted > 0) broken.add('missed rent')
    if (report.shiftsMissed > 0 || report.shiftsWorked !== SIM_DAYS * target.shiftsPerDay) {
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
