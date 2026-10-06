/**
 * The engine's view of one player: personal clock, cash, stats, clout and housing. Pure
 * functions only; the store (src/state) holds a snapshot and replaces it with what these return.
 */
import {
  fastForward,
  initialClock,
  rollovers,
  tickClock,
  type ClockState,
  type Rollovers,
  type TickOptions,
} from './clock'
import type { EngineConfig, HomeId } from './config'
import { initialRent, settleRent, type RentEvent, type RentState } from './rent'
import { decayStats, initialStats, type Stats } from './stats'

export interface GameSnapshot {
  readonly clock: ClockState
  readonly player: {
    /** Whole in-game dollars, never negative. */
    readonly cash: number
    readonly stats: Stats
    /** Whole clout points, never negative. Earning it arrives with S13. */
    readonly clout: number
    readonly home: HomeId
    readonly rent: RentState
  }
}

export type PlayerState = GameSnapshot['player']

export interface Advance {
  readonly snapshot: GameSnapshot
  readonly minutes: number
  readonly rollovers: Rollovers
  /** Rent charged, missed or collected on the way, in order. */
  readonly rent: readonly RentEvent[]
}

export function initialSnapshot(config: EngineConfig): GameSnapshot {
  return {
    clock: initialClock(config),
    player: {
      cash: config.startCash,
      stats: initialStats(config),
      clout: 0,
      home: config.startHome,
      rent: initialRent,
    },
  }
}

/**
 * Moves the personal clock forward by whole game minutes, charging passive decay and rent on
 * the way.
 */
export function advanceMinutes(
  snapshot: GameSnapshot,
  minutes: number,
  config: EngineConfig,
): Advance {
  const clock = fastForward(snapshot.clock, minutes)
  return withDecay(snapshot, clock, config)
}

/** Passive time: real elapsed milliseconds while the tab is visible, at the chosen speed. */
export function tick(
  snapshot: GameSnapshot,
  realElapsedMs: number,
  options: TickOptions,
  config: EngineConfig,
): Advance {
  const { clock } = tickClock(snapshot.clock, realElapsedMs, options, config)
  if (clock === snapshot.clock) {
    return { snapshot, minutes: 0, rollovers: { days: 0, weeks: 0 }, rent: [] }
  }
  return withDecay(snapshot, clock, config)
}

function withDecay(snapshot: GameSnapshot, clock: ClockState, config: EngineConfig): Advance {
  const from = snapshot.clock.minute
  const stats = decayStats(snapshot.player.stats, from, clock.minute, config)
  const settled = settleRent({ ...snapshot.player, stats }, from, clock.minute, config)
  return {
    snapshot: { clock, player: settled.player },
    minutes: clock.minute - from,
    rollovers: rollovers(from, clock.minute, config),
    rent: settled.events,
  }
}
