/**
 * The economy bot (S12): plays the solo game for a number of game days with one entry job and
 * a sensible daily routine, through the engine's public functions only, and reports how the
 * money went. src/engine/sim/economy.sim.test.ts checks the report against the CLAUDE.md
 * target feel and writes the plausibility baseline S18c reads.
 *
 * Daily routine (the clock starts on day 1 at `time.startMinuteOfDay`):
 * - get up when sleep ends, waiting for 07:00 only if that is earlier (on the shipped balance
 *   sleep ends between about 06:30 and 08:30: going to bed with mood at 0 stretches it by
 *   `stats.atZero.mood.durationMultiplier`); eat if hungry;
 * - ride to work (unless no shift fits the day any more), fuel up, work shift 1; buy lunch if
 *   hungry; fuel up, work shift 2;
 * - ride home and eat if hungry; nap while tired, as long as the nap ends by 21:00;
 * - wait until 22:00 (if it is earlier), eat if hungry, top up energy if it is at 0, sleep.
 *
 * Every time check is against absolute minutes of the routine's own game day, never a wrapped
 * minute of the day. A day that runs late drops what does not fit: a shift that would not end
 * by 22:00 is skipped (counted in `shiftsMissed`), naps that would end after 21:00 and waits
 * for a time already past are skipped. So a day's routine never overruns into the next day;
 * if it still does (sleep, say, that ends after the next day's end), the bot throws rather than
 * skip a day.
 *
 * Bedtime top-up: an action's at-zero slowdown is judged on the stats it starts with, so going
 * to bed at 0 energy would stretch sleep by `stats.atZero.energy.durationMultiplier` and push
 * the next day late. At 0 energy the bot buys a deli coffee when its cash, after the rent
 * reserve, covers the price; otherwise it naps once (free) first.
 *
 * "Hungry" is hunger at or below HUNGRY. Meals are a home meal, or bodega breakfast when the
 * home meal's energy cost would leave too little for the next shift (lunch at work is from the
 * bodega). "Fuel up" buys deli coffee until energy covers the shift's cost plus its passive
 * decay, with one point to spare, so energy never hits 0 mid-shift; with no cash for coffee the
 * bot naps once instead. The bot ignores mood. Each working day has two subway rides at
 * `costs.subwayFare` (a fixed ride until S08's transit replaces it).
 *
 * Clout (S13): every bot earns the first paycheck's clout. With the `flex` option the bot also
 * flexes once a day at that place, after the second shift, when it has the energy for it and
 * the flex ends by bedtime; it goes through `performPlaceAction`, so every place rule applies.
 * Clout is measured as the player's total (src/engine/clout.ts `totalClout`), and gains are
 * attributed to the ledger sources of the entries each step wrote.
 *
 * Goals (S15): with the `claimAll` option the bot records goals after every step and claims
 * every reward it has reached at once, through the grant function (src/engine/grants.ts), so
 * the sim shows what goal rewards do to the economy. Claims are not steps: their cash and clout
 * are not counted as gains per action or per day (the baseline measures play, not grants).
 */
import {
  applyAction,
  effectiveDuration,
  findAction,
  performAction,
  type ActionDef,
} from '../actions'
import { calendar, minutesPerDay } from '../clock'
import { playerLevel, totalClout } from '../clout'
import type { EngineConfig, HomeId, JobId } from '../config'
import { flexAction } from '../flex'
import { initialEventsState } from '../events'
import { advanceMinutes, initialSnapshot, type GameSnapshot } from '../game'
import { initialGoalsState, syncGoals, type GoalsState } from '../goals'
import { grant, initialGrantsState, type GrantsState } from '../grants'
import { canAffordMove, rentReserve } from '../housing'
import { shiftAction, workShift } from '../jobs'
import { performPlaceAction } from '../placeActions'
import type { Place } from '../places'
import { initialPrestigeState, type PrestigeState } from '../prestige'
import type { RentEvent } from '../rent'

/** Hunger at or below this sends the bot to eat. */
const HUNGRY = 60
/** The bot naps (after work, before NAP_UNTIL_HOUR) while energy is below this. */
const TIRED = 70
const WAKE_HOUR = 7
const NAP_UNTIL_HOUR = 21
const BED_HOUR = 22
/** Coffee or meals bought for one shift, at most: a guard against a config that never fuels. */
const MAX_FUEL_STEPS = 20
const RIDE_MINUTES = 30
const MINUTES_PER_HOUR = 60

export interface EconomyBotOptions {
  /** An entry job (no clout level needed); the bot never switches jobs. */
  readonly jobId: JobId
  /** Game days to play: day 1 to day `days`, ending with that day's sleep. */
  readonly days: number
  /** The home whose move the bot measures affordability for (src/engine/housing.ts). */
  readonly upgradeTo: HomeId
  /** Flex once a day at this place (a landmark or venue that allows it). */
  readonly flex?: { readonly place: Place }
  /** Claim every goal reward as soon as it is reached (S15). Off by default. */
  readonly claimAll?: boolean
  /**
   * Called after every step (and the claims it led to) with the state it left: S18c replays
   * these as uploads to prove save plausibility accepts normal play.
   */
  readonly onStep?: (step: BotStep) => void
}

/** The state one step left (see `EconomyBotOptions.onStep`). */
export interface BotStep {
  readonly snapshot: GameSnapshot
  readonly goals: GoalsState
  readonly grants: GrantsState
  readonly prestige: PrestigeState
  /** False for waiting (passive time), true for an action, shift or ride. */
  readonly counted: boolean
}

export interface BotReport {
  readonly jobId: JobId
  /** Cash after the last day's sleep. */
  readonly finalCash: number
  /** Lowest cash held after any step. */
  readonly minCash: number
  readonly shiftsWorked: number
  /**
   * Shifts the routine called for but did not work: the engine refused (no energy, for example)
   * or the day ran too late for the shift to end by bedtime.
   */
  readonly shiftsMissed: number
  /** Every rent charge, collection, miss and eviction, in order. */
  readonly rentEvents: readonly RentEvent[]
  /** Rent misses plus evictions. */
  readonly missedOrEvicted: number
  /**
   * Cash saved from one paid rent day to the next (rent to rent, so each week has paid its own
   * rent): with rent on days 8, 15, 22 and 29, these are weeks 2, 3 and 4.
   */
  readonly weeklySavings: readonly number[]
  /** The first game day the player could afford to move to `upgradeTo`, or null. */
  readonly firstAffordableDay: number | null
  /** Cash at bedtime on each day, day 1 first. */
  readonly cashByDay: readonly number[]
  /** Largest cash gained by one step. */
  readonly maxCashGainPerAction: number
  /** Largest cash gained in one game day (the sum of that day's gains; spending not netted). */
  readonly maxCashGainPerGameDay: number
  /** Highest earning rate of any step: its cash gain per game hour of clock it moved. */
  readonly maxCashGainPerGameHour: number
  /** Most steps (actions, shifts and rides; not waiting) started in one game day. */
  readonly maxActionsPerGameDay: number
  readonly maxCloutGainPerAction: number
  readonly maxCloutGainPerGameDay: number
  /**
   * Largest clout gain from one step, by clout ledger source (only sources that gave clout):
   * `paycheck`, `flex` and so on.
   */
  readonly cloutGainBySource: Readonly<Record<string, number>>
  /** Total clout after the last day's sleep. */
  readonly finalClout: number
  /** The first game day each clout level was reached (the starting level on day 1). */
  readonly levelReachedDay: Readonly<Record<string, number>>
  readonly flexes: number
  readonly viralFlexes: number
  /** Goal rewards claimed (`claimAll` only): how many, and the cash and clout they applied. */
  readonly grants: { readonly count: number; readonly cash: number; readonly clout: number }
  /** Goals reached, by id, with the game day each was reached on (`claimAll` only). */
  readonly goalsReachedDay: Readonly<Record<string, number>>
}

interface Step {
  readonly snapshot: GameSnapshot
  readonly rent: readonly RentEvent[]
}

function hourMinute(hour: number): number {
  return hour * MINUTES_PER_HOUR
}

/** Plays `options.days` game days and reports the money (see the module comment). */
export function runEconomyBot(options: EconomyBotOptions, config: EngineConfig): BotReport {
  const { jobId, days, upgradeTo } = options
  const perDay = minutesPerDay(config)
  const homeMeal = requireAction('home-meal', config)
  const coffee = requireAction('deli-coffee', config)
  const nap = requireAction('nap', config)
  const ride: ActionDef = {
    durationMin: RIDE_MINUTES,
    cashCost: config.costs.subwayFare,
    energyCost: 0,
    statEffects: {},
  }

  let snapshot = initialSnapshot(config)
  let minCash = snapshot.player.cash
  let flexes = 0
  let viralFlexes = 0
  const levelReachedDay: Record<string, number> = {
    [playerLevel(snapshot.player, config).id]: 1,
  }
  let shiftsWorked = 0
  let shiftsMissed = 0
  let firstAffordableDay: number | null = null
  let maxCashGainPerAction = 0
  let maxCashGainPerGameHour = 0
  let maxCloutGainPerAction = 0
  const rentEvents: RentEvent[] = []
  const paidCash: number[] = []
  const cashByDay: number[] = []
  const cashGainByDay = new Map<number, number>()
  const cloutGainByDay = new Map<number, number>()
  const actionsByDay = new Map<number, number>()
  const cloutGainBySource: Record<string, number> = {}
  let progress: {
    goals: GoalsState
    grants: GrantsState
    prestige: PrestigeState
  } = { goals: initialGoalsState, grants: initialGrantsState, prestige: initialPrestigeState }
  const granted = { count: 0, cash: 0, clout: 0 }
  const goalsReachedDay: Record<string, number> = {}

  const dayOf = (minute: number) => calendar(minute, config).day
  const now = () => snapshot.clock.minute
  /** Start of the game day whose routine is running (absolute minutes). */
  let dayStart = 0
  const at = (hour: number) => dayStart + hourMinute(hour)
  const fitsBefore = (def: ActionDef, deadline: number) =>
    now() + effectiveDuration(def, snapshot, config) <= deadline
  const add = (map: Map<number, number>, day: number, amount: number) =>
    map.set(day, (map.get(day) ?? 0) + amount)

  function record(step: Step, counts: boolean): void {
    const before = snapshot
    const after = step.snapshot
    const startDay = dayOf(before.clock.minute)
    const endDay = dayOf(after.clock.minute)
    const cashGain = Math.max(0, after.player.cash - before.player.cash)
    const cloutAfter = totalClout(after.player, config)
    const cloutGain = Math.max(0, cloutAfter - totalClout(before.player, config))
    const hours = (after.clock.minute - before.clock.minute) / MINUTES_PER_HOUR

    maxCashGainPerAction = Math.max(maxCashGainPerAction, cashGain)
    if (hours > 0) maxCashGainPerGameHour = Math.max(maxCashGainPerGameHour, cashGain / hours)
    add(cashGainByDay, endDay, cashGain)
    maxCloutGainPerAction = Math.max(maxCloutGainPerAction, cloutGain)
    add(cloutGainByDay, endDay, cloutGain)
    const bySource = new Map<string, number>()
    for (const entry of after.player.clout.ledger) {
      if (entry.seq < before.player.clout.nextSeq || entry.amount <= 0) continue
      bySource.set(entry.source, (bySource.get(entry.source) ?? 0) + entry.amount)
    }
    for (const [source, gain] of bySource) {
      cloutGainBySource[source] = Math.max(cloutGainBySource[source] ?? 0, gain)
    }
    const level = playerLevel(after.player, config).id
    if (!Object.hasOwn(levelReachedDay, level)) levelReachedDay[level] = endDay
    if (counts) add(actionsByDay, startDay, 1)

    rentEvents.push(...step.rent)
    if (step.rent.some((event) => event.kind === 'paid')) paidCash.push(after.player.cash)
    minCash = Math.min(minCash, after.player.cash)
    snapshot = after
    if (options.claimAll === true) claimRewards(endDay)
    if (firstAffordableDay === null && canAffordMove(snapshot.player, upgradeTo, config)) {
      firstAffordableDay = endDay
    }
    options.onStep?.({ snapshot, ...progress, counted: counts })
  }

  /** See "Goals" in the module comment. */
  function claimRewards(day: number): void {
    const synced = syncGoals({ ...snapshot, ...progress }, config)
    for (const id of synced.newlyAchieved) goalsReachedDay[id] = day
    let save = { ...synced.save, events: initialEventsState() }
    for (const goal of config.goals) {
      // The real time a claim is issued only goes into the audit record: the minute will do.
      const result = grant(
        save,
        { kind: 'goal_reward', goalId: goal.id, reward: goal.reward },
        snapshot.clock.minute,
        config,
      )
      if (!result.ok || result.replayed) continue
      save = result.save
      granted.count += 1
      granted.cash += result.record.applied.cash
      granted.clout += result.record.applied.clout
    }
    snapshot = { clock: save.clock, player: save.player }
    progress = { goals: save.goals, grants: save.grants, prestige: save.prestige }
  }

  /** Performs a catalog action; returns false (changing nothing) when the engine refuses. */
  function act(actionId: string): boolean {
    const result = performAction(snapshot, actionId, config)
    if (!result.ok) return false
    record(result, true)
    return true
  }

  function rideSubway(): void {
    const result = applyAction(snapshot, ride, config)
    if (result.ok) record(result, true)
  }

  /** Waits until absolute minute `minute`; does nothing if it has already passed. */
  function waitUntil(minute: number): void {
    if (minute > now()) record(advanceMinutes(snapshot, minute - now(), config), false)
  }

  /** Energy the next shift needs: its cost plus its passive decay, plus one point to spare. */
  function shiftEnergyNeed(): number {
    const shift = shiftAction(jobId, config)
    const hours = Math.ceil(effectiveDuration(shift, snapshot, config) / MINUTES_PER_HOUR)
    return shift.energyCost + hours * config.stats.decayPerGameHour.energy + 1
  }

  function eatIfHungry(options: { readonly beforeShift: boolean; readonly atHome: boolean }) {
    if (snapshot.player.stats.hunger > HUNGRY) return
    const energyAfterMeal = snapshot.player.stats.energy - homeMeal.energyCost
    const homeMealFits = !options.beforeShift || energyAfterMeal >= shiftEnergyNeed()
    if (options.atHome && homeMealFits && act('home-meal')) return
    act('bodega-breakfast')
  }

  function fuelUp(): void {
    for (let i = 0; i < MAX_FUEL_STEPS && snapshot.player.stats.energy < shiftEnergyNeed(); i++) {
      if (snapshot.player.cash >= coffee.cashCost) {
        act('deli-coffee')
      } else {
        act('nap')
        return
      }
    }
  }

  /** See "Bedtime top-up" in the module comment. */
  function topUpBeforeBed(): void {
    if (snapshot.player.stats.energy > 0) return
    const spare = snapshot.player.cash - rentReserve(snapshot.player, config)
    if (spare >= coffee.cashCost && act('deli-coffee')) return
    act('nap')
  }

  /** See "Clout" in the module comment. */
  function flex(place: Place): void {
    const def = flexAction(config)
    if (snapshot.player.stats.energy < def.energyCost || !fitsBefore(def, at(BED_HOUR))) return
    const result = performPlaceAction(snapshot, place, 'flex', config)
    if (!result.ok) return
    record(result, true)
    flexes += 1
    if (result.flex?.viral === true) viralFlexes += 1
  }

  function shift(): void {
    const def = shiftAction(jobId, config)
    if (!fitsBefore(def, at(BED_HOUR))) {
      shiftsMissed += 1
      return
    }
    fuelUp()
    // Fuelling takes time (and a nap at 0 energy is slow): check again.
    if (!fitsBefore(def, at(BED_HOUR))) {
      shiftsMissed += 1
      return
    }
    const result = workShift(snapshot, jobId, config)
    if (!result.ok) {
      shiftsMissed += 1
      return
    }
    record(result, true)
    shiftsWorked += 1
  }

  for (let day = 1; day <= days; day++) {
    // A routine that overran a whole day would silently skip one: fail loudly instead.
    if (dayOf(snapshot.clock.minute) !== day) {
      throw new Error(
        `economy bot: day ${day}'s routine started on day ${dayOf(snapshot.clock.minute)}`,
      )
    }
    dayStart = (day - 1) * perDay
    waitUntil(at(WAKE_HOUR))
    eatIfHungry({ beforeShift: true, atHome: true })
    // No point riding in if not even the first shift would end by bedtime.
    const commutes = fitsBefore(shiftAction(jobId, config), at(BED_HOUR) - RIDE_MINUTES)
    if (commutes) rideSubway()
    shift()
    eatIfHungry({ beforeShift: true, atHome: !commutes })
    shift()
    if (options.flex !== undefined) flex(options.flex.place)
    if (commutes) rideSubway()
    eatIfHungry({ beforeShift: false, atHome: true })
    while (snapshot.player.stats.energy < TIRED && fitsBefore(nap, at(NAP_UNTIL_HOUR))) {
      if (!act('nap')) break
    }
    waitUntil(at(BED_HOUR))
    eatIfHungry({ beforeShift: false, atHome: true })
    topUpBeforeBed()
    cashByDay.push(snapshot.player.cash)
    act('sleep')
  }

  return {
    jobId,
    finalCash: snapshot.player.cash,
    minCash,
    shiftsWorked,
    shiftsMissed,
    rentEvents,
    missedOrEvicted: rentEvents.filter((e) => e.kind === 'missed' || e.kind === 'evicted').length,
    weeklySavings: paidCash.slice(1).map((cash, i) => cash - (paidCash[i] ?? cash)),
    firstAffordableDay,
    cashByDay,
    maxCashGainPerAction,
    maxCashGainPerGameDay: Math.max(0, ...cashGainByDay.values()),
    maxCashGainPerGameHour,
    maxActionsPerGameDay: Math.max(0, ...actionsByDay.values()),
    maxCloutGainPerAction,
    maxCloutGainPerGameDay: Math.max(0, ...cloutGainByDay.values()),
    cloutGainBySource,
    finalClout: totalClout(snapshot.player, config),
    levelReachedDay,
    flexes,
    viralFlexes,
    grants: granted,
    goalsReachedDay,
  }
}

function requireAction(actionId: string, config: EngineConfig): ActionDef {
  const def = findAction(actionId, config)
  if (def === undefined) throw new Error(`actions.catalog has no "${actionId}" (the bot needs it)`)
  return def
}
