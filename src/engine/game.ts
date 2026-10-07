/**
 * The engine's view of one player: personal clock, cash, stats, clout, housing and items. Pure
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
import { initialCloutState, type CloutState } from './clout'
import type { EngineConfig, HomeId } from './config'
import { emptyInventory, type Inventory } from './items'
import { initialRent, settleRent, type RentEvent, type RentState } from './rent'
import { decayStats, initialStats, type Stats } from './stats'

export interface GameSnapshot {
  readonly clock: ClockState
  readonly player: {
    /** Whole in-game dollars, never negative. */
    readonly cash: number
    readonly stats: Stats
    /**
     * The clout ledger (src/engine/clout.ts). The player's clout is derived from it, their
     * wearables and the premium cap: read it with `totalClout`, never by summing it here.
     */
    readonly clout: CloutState
    /** Flex state (src/engine/flex.ts): the viral roll's generator and today's flexes. */
    readonly flex: FlexState
    readonly home: HomeId
    readonly rent: RentState
    /** Owned items and the outfit being worn (src/engine/items.ts). */
    readonly inventory: Inventory
    /**
     * The night each club last paid out clout, by club venue id (src/engine/placeActions.ts
     * `clubNightKey`): clout is earned at most once per club per game night.
     */
    readonly clubNights: ClubNights
  }
}

export type PlayerState = GameSnapshot['player']

/** Club venue id → the game day its last clout-paying night opened on. */
export type ClubNights = Readonly<Record<string, number>>

export interface FlexState {
  /** uint32 state of the viral-roll generator, saved so a reload cannot re-roll a flex. */
  readonly rngState: number
  /** Place id → the game day it was last flexed at (only today's flexes are kept). */
  readonly byPlace: Readonly<Record<string, number>>
}

export const initialFlexState: FlexState = { rngState: 0, byPlace: {} }

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
      clout: initialCloutState,
      flex: initialFlexState,
      home: config.startHome,
      rent: initialRent,
      inventory: emptyInventory,
      clubNights: {},
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
