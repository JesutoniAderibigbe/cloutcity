/**
 * The "Make it you" creator (S16a): when it is offered, which steps it has, and its rolls.
 *
 * - Offer: a guest plays at once with a random look and never meets the creator first. After
 *   `offerAfterActions` state-changing actions the offer is due (`noteCreatorAction`, called by
 *   the store on every committed action); the UI shows it only while the S06 tour is not running
 *   (`creatorOfferShowing`), and it is not part of the GR-9 start. Skipping it closes the offer;
 *   the creator stays reachable from the HUD.
 * - Steps: data/config/creator.json lists every step in order; a disabled step (S44's `origin`
 *   seam) is left out (`creatorSteps`). The UI maps each id to a lazy component.
 * - Rolls: `commitRoll` draws once and writes the result to the save before anything is shown,
 *   so a reload during the reveal shows the same result and a second call replays it. A roll's
 *   scope (creator.json `rolls`) is the save (kept through prestige) or the run (prestige rolls
 *   again).
 * - Moving in: the Home step settles the player in the rolled neighborhood
 *   (`moveIntoNeighborhood`); the home's point then follows it (src/engine/neighborhoods.ts).
 */
import {
  CREATOR_STEP_IDS,
  ROLL_KINDS,
  type CreatorStepId,
  type RollKind,
  type RollScope,
} from '@/lib/data/avatarIds'
import type { EngineConfig, HomeId } from './config'
import type { GameSnapshot } from './game'
import { findNeighborhood } from './neighborhoods'
import type { Rng } from './rng'

export { CREATOR_STEP_IDS, ROLL_KINDS, type CreatorStepId, type RollKind, type RollScope }

export interface CreatorState {
  /** Actions committed before the offer was due, up to `offerAfterActions`. */
  readonly actions: number
  /** Personal-clock minute the offer became due, or null before that. */
  readonly offeredAt: number | null
  /** Minute the player closed the offer without opening the creator, or null. */
  readonly dismissedAt: number | null
  /** Minute the player finished the creator, or null. */
  readonly completedAt: number | null
  /** Steps the player skipped on their way through. */
  readonly skippedSteps: readonly CreatorStepId[]
}

export const initialCreatorState: CreatorState = {
  actions: 0,
  offeredAt: null,
  dismissedAt: null,
  completedAt: null,
  skippedSteps: [],
}

/** One committed roll: what came up, when, and in which run. */
export interface RollRecord {
  readonly result: string
  readonly at: number
  readonly run: number
}

export type Rolls = Readonly<Partial<Record<RollKind, RollRecord>>>

export const initialRolls: Rolls = {}

/** The creator's steps, in order, without the disabled ones. */
export function creatorSteps(config: EngineConfig): readonly CreatorStepId[] {
  return config.creator.steps.filter((step) => step.enabled !== false).map((step) => step.id)
}

/** Counts one committed action; the offer is due once `offerAfterActions` have been made. */
export function noteCreatorAction(
  creator: CreatorState,
  minute: number,
  config: EngineConfig,
): CreatorState {
  if (creator.offeredAt !== null) return creator
  const actions = Math.min(config.creator.offerAfterActions, creator.actions + 1)
  return {
    ...creator,
    actions,
    offeredAt: actions >= config.creator.offerAfterActions ? minute : null,
  }
}

/** True while the offer should show: due, not closed or finished, and (if set) after the tour. */
export function creatorOfferShowing(
  creator: CreatorState,
  status: { readonly tourActive: boolean },
  config: EngineConfig,
): boolean {
  if (creator.offeredAt === null || creator.dismissedAt !== null) return false
  if (creator.completedAt !== null) return false
  return !(config.creator.waitForTour && status.tourActive)
}

/** The player closed the offer ("Not now"); the HUD still opens the creator. */
export function dismissCreatorOffer(creator: CreatorState, minute: number): CreatorState {
  return creator.dismissedAt === null ? { ...creator, dismissedAt: minute } : creator
}

/** Records a step the player skipped (once). Unknown or disabled steps change nothing. */
export function skipCreatorStep(
  creator: CreatorState,
  step: string,
  config: EngineConfig,
): CreatorState {
  const known = creatorSteps(config).find((id) => id === step)
  if (known === undefined || creator.skippedSteps.includes(known)) return creator
  return { ...creator, skippedSteps: [...creator.skippedSteps, known] }
}

/** The player finished the creator (the first time counts). */
export function completeCreator(creator: CreatorState, minute: number): CreatorState {
  return creator.completedAt === null ? { ...creator, completedAt: minute } : creator
}

/** What a roll draws from. `origin` has no pool until S44 adds one. */
export function rollPool(kind: RollKind, config: EngineConfig): readonly string[] {
  return kind === 'neighborhood' ? config.neighborhoods.map((entry) => entry.id) : []
}

/** How long a roll holds, or undefined when the creator makes no such roll. */
export function rollScope(kind: RollKind, config: EngineConfig): RollScope | undefined {
  return config.creator.rolls[kind]?.scope
}

/** The parts of a save a roll reads and writes. */
export interface RollSave {
  readonly clock: { readonly minute: number }
  readonly goals: { readonly run: number }
  readonly rolls: Rolls
}

/** The roll that still holds for `kind` in this save, or undefined. */
export function heldRoll(save: RollSave, kind: RollKind, config: EngineConfig) {
  const record = save.rolls[kind]
  if (record === undefined) return undefined
  return rollScope(kind, config) === 'run' && record.run !== save.goals.run ? undefined : record
}

export type RollError =
  | { readonly code: 'ROLL_DISABLED'; readonly kind: string }
  | { readonly code: 'EMPTY_POOL'; readonly kind: RollKind }

export type RollResult<S extends RollSave> =
  | {
      readonly ok: true
      readonly save: S
      readonly roll: RollRecord
      /** True when the roll already held and nothing was drawn. */
      readonly replayed: boolean
    }
  | { readonly ok: false; readonly error: RollError }

/**
 * Draws `kind` once from its pool and writes it to the save, or replays the roll that already
 * holds (see the module comment). One draw from `rng`, only when nothing holds.
 */
export function commitRoll<S extends RollSave>(
  save: S,
  kind: string,
  rng: Rng,
  config: EngineConfig,
): RollResult<S> {
  const known = ROLL_KINDS.find((id) => id === kind)
  if (known === undefined || rollScope(known, config) === undefined) {
    return { ok: false, error: { code: 'ROLL_DISABLED', kind } }
  }
  const held = heldRoll(save, known, config)
  if (held !== undefined) return { ok: true, save, roll: held, replayed: true }
  const pool = rollPool(known, config)
  if (pool.length === 0) return { ok: false, error: { code: 'EMPTY_POOL', kind: known } }
  const result = pool[Math.min(pool.length - 1, Math.floor(rng.next() * pool.length))] ?? ''
  const roll: RollRecord = { result, at: save.clock.minute, run: save.goals.run }
  return {
    ok: true,
    save: { ...save, rolls: { ...save.rolls, [known]: roll } },
    roll,
    replayed: false,
  }
}

export type MoveInError =
  | { readonly code: 'NOT_ROLLED' }
  | { readonly code: 'HOME_NOT_HERE'; readonly home: string; readonly neighborhood: string }
  | { readonly code: 'NOT_YOUR_HOME'; readonly home: string }

export type MoveInResult<S extends RollSave & GameSnapshot> =
  { readonly ok: true; readonly save: S } | { readonly ok: false; readonly error: MoveInError }

/**
 * The Home step: settles the player in the rolled neighborhood with `home`, one of its
 * startable homes and the home they live in now (moving to another home is the housing flow's,
 * src/engine/home.ts `moveHome`). A player at home is still at home: their home just stands
 * at the neighborhood's point now.
 */
export function moveIntoNeighborhood<S extends RollSave & GameSnapshot>(
  save: S,
  home: string,
  config: EngineConfig,
): MoveInResult<S> {
  const roll = heldRoll(save, 'neighborhood', config)
  const neighborhood = roll === undefined ? undefined : findNeighborhood(roll.result, config)
  if (roll === undefined || neighborhood === undefined) {
    return { ok: false, error: { code: 'NOT_ROLLED' } }
  }
  if (!neighborhood.homes.includes(home as HomeId)) {
    return { ok: false, error: { code: 'HOME_NOT_HERE', home, neighborhood: neighborhood.id } }
  }
  if (save.player.home !== home) return { ok: false, error: { code: 'NOT_YOUR_HOME', home } }
  return { ok: true, save: { ...save, player: { ...save.player, neighborhood: neighborhood.id } } }
}
