/**
 * The creator state every load and action needs (S16a): the offer's progress and the committed
 * rolls. The creator's flow itself (steps, rolls, moving in, choices) is
 * src/engine/creatorFlow.ts, which only the creator's lazy chunk loads (PERF-6).
 *
 * The offer: a guest plays at once with a random look and never meets the creator first. After
 * `offerAfterActions` state-changing actions the offer is due (`noteCreatorAction`, called by
 * the store on every committed action); the UI shows it only while the S06 tour is not running
 * (`creatorOfferShowing`), and it is not part of the GR-9 start.
 */
import {
  CREATOR_STEP_IDS,
  ROLL_KINDS,
  type CreatorStepId,
  type RollKind,
  type RollScope,
} from '@/lib/data/avatarIds'
import type { EngineConfig } from './config'

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
  config: { readonly creator: Pick<EngineConfig['creator'], 'waitForTour'> },
): boolean {
  if (creator.offeredAt === null || creator.dismissedAt !== null) return false
  if (creator.completedAt !== null) return false
  return !(config.creator.waitForTour && status.tourActive)
}

/** The player closed the offer ("Not now") or opened the creator from it; the HUD still opens it. */
export function dismissCreatorOffer(creator: CreatorState, minute: number): CreatorState {
  return creator.dismissedAt === null ? { ...creator, dismissedAt: minute } : creator
}

/** What a roll draws from. `origin` has no pool until S44 adds one. */
export function rollPool(kind: RollKind, config: EngineConfig): readonly string[] {
  return kind === 'neighborhood' ? config.neighborhoods : []
}

/** How long a roll holds, or undefined when the creator makes no such roll. */
export function rollScope(kind: RollKind, config: EngineConfig): RollScope | undefined {
  return config.creator.rolls[kind]
}
