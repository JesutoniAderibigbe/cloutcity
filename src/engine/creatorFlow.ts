/**
 * The "Make it you" creator's flow (S16a). Only the creator's lazy chunk loads this module, so
 * none of it is on the playable path (PERF-6); src/engine/creator.ts holds the state every load
 * and action needs.
 *
 * - Steps: data/config/creator.json lists every step in order; a disabled step (S44's `origin`
 *   seam) is left out (`creatorSteps`). The UI maps each id to a lazy component.
 * - Choices: the look (`chooseLook`, complete and known options only), the traits
 *   (`chooseTraits`) and the Dream (`chooseCareer`); a changed pair or path waits for the change
 *   cooldown (src/engine/career.ts `changeAvailableAt`).
 * - Rolls: `commitRoll` draws once and writes the result to the save before anything is shown,
 *   so a reload during the reveal shows the same result and a second call replays it. A roll's
 *   scope (creator.json `rolls`) is the save (kept through prestige) or the run (prestige rolls
 *   again).
 * - Moving in: the Home step settles the player in the rolled neighborhood
 *   (`moveIntoNeighborhood`); the home's point then follows it (src/engine/neighborhoods.ts).
 */
import {
  LOOK_FIELDS,
  ROLL_KINDS,
  type CreatorStepId,
  type LookField,
  type RollKind,
} from '@/lib/data/avatarIds'
import { lookProblem, type Look } from './appearance'
import { changeAvailableAt, isCareerPath } from './career'
import { settleLevel, type LevelUp } from './clout'
import type { EngineConfig, HomeId } from './config'
import { rollPool, rollScope, type CreatorState, type RollRecord, type Rolls } from './creator'

export { dismissCreatorOffer } from './creator'
import type { CreatorEngineConfig } from './creatorConfig'
import type { GameSnapshot } from './game'
import type { Rng } from './rng'
import { isTraitId, traitPickCount } from './traits'

/** The creator's steps, in order, without the disabled ones. */
export function creatorSteps(creator: CreatorEngineConfig): readonly CreatorStepId[] {
  return creator.creator.steps.filter((step) => step.enabled !== false).map((step) => step.id)
}

/** Records a step the player skipped (once). Unknown or disabled steps change nothing. */
export function skipCreatorStep(
  creator: CreatorState,
  step: string,
  config: CreatorEngineConfig,
): CreatorState {
  const known = creatorSteps(config).find((id) => id === step)
  if (known === undefined || creator.skippedSteps.includes(known)) return creator
  return { ...creator, skippedSteps: [...creator.skippedSteps, known] }
}

/** The player finished the creator (the first time counts). */
export function completeCreator(creator: CreatorState, minute: number): CreatorState {
  return creator.completedAt === null ? { ...creator, completedAt: minute } : creator
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
  creator: CreatorEngineConfig,
): MoveInResult<S> {
  const roll = heldRoll(save, 'neighborhood', config)
  const neighborhood =
    roll === undefined ? undefined : creator.neighborhoods.find((n) => n.id === roll.result)
  if (roll === undefined || neighborhood === undefined) {
    return { ok: false, error: { code: 'NOT_ROLLED' } }
  }
  if (!neighborhood.homes.includes(home as HomeId)) {
    return { ok: false, error: { code: 'HOME_NOT_HERE', home, neighborhood: neighborhood.id } }
  }
  if (save.player.home !== home) return { ok: false, error: { code: 'NOT_YOUR_HOME', home } }
  return { ok: true, save: { ...save, player: { ...save.player, neighborhood: neighborhood.id } } }
}

export type LookError = { readonly code: 'INVALID_LOOK'; readonly field: LookField | 'shape' }

export type LookResult =
  | { readonly ok: true; readonly snapshot: GameSnapshot }
  | { readonly ok: false; readonly error: LookError }

/**
 * Sets the creator's look. Only a complete look naming known options is accepted (nothing is
 * repaired here: the creator only offers valid options, so anything else is refused).
 */
export function chooseLook(snapshot: GameSnapshot, raw: unknown, config: EngineConfig): LookResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: { code: 'INVALID_LOOK', field: 'shape' } }
  }
  const source = raw as Record<string, unknown>
  const keys = Object.keys(source)
  if (
    keys.length !== LOOK_FIELDS.length ||
    !LOOK_FIELDS.every((field) => typeof source[field] === 'string')
  ) {
    return { ok: false, error: { code: 'INVALID_LOOK', field: 'shape' } }
  }
  const look = Object.fromEntries(LOOK_FIELDS.map((field) => [field, source[field]])) as Look
  const field = lookProblem(look, config)
  if (field !== null) return { ok: false, error: { code: 'INVALID_LOOK', field } }
  return { ok: true, snapshot: { ...snapshot, player: { ...snapshot.player, look } } }
}

export type TraitsError =
  | { readonly code: 'UNKNOWN_TRAIT'; readonly traitId: string }
  | { readonly code: 'WRONG_TRAIT_COUNT'; readonly required: number; readonly given: number }
  | { readonly code: 'REPEATED_TRAIT'; readonly traitId: string }
  | { readonly code: 'CHANGE_COOLDOWN'; readonly availableAt: number }

export type TraitsResult =
  | { readonly ok: true; readonly snapshot: GameSnapshot; readonly changed: boolean }
  | { readonly ok: false; readonly error: TraitsError }

/**
 * Chooses the player's traits: exactly `traits.pick` known, different ids. The same set again
 * (in any order) changes nothing; a different set waits for the change cooldown.
 */
export function chooseTraits(
  snapshot: GameSnapshot,
  traitIds: readonly string[],
  config: EngineConfig,
): TraitsResult {
  const required = traitPickCount(config)
  if (traitIds.length !== required) {
    return { ok: false, error: { code: 'WRONG_TRAIT_COUNT', required, given: traitIds.length } }
  }
  for (const [i, id] of traitIds.entries()) {
    if (!isTraitId(id, config)) return { ok: false, error: { code: 'UNKNOWN_TRAIT', traitId: id } }
    if (traitIds.indexOf(id) !== i) {
      return { ok: false, error: { code: 'REPEATED_TRAIT', traitId: id } }
    }
  }
  const { player } = snapshot
  const same =
    player.traits.length === traitIds.length && traitIds.every((id) => player.traits.includes(id))
  if (same) return { ok: true, snapshot, changed: false }
  const now = snapshot.clock.minute
  const availableAt = changeAvailableAt(player.traitsChangedAt, now, config)
  if (availableAt !== null) return { ok: false, error: { code: 'CHANGE_COOLDOWN', availableAt } }
  return {
    ok: true,
    snapshot: {
      ...snapshot,
      player: { ...player, traits: [...traitIds], traitsChangedAt: now },
    },
    changed: true,
  }
}

export type CareerError =
  | { readonly code: 'UNKNOWN_CAREER'; readonly careerPath: string }
  | { readonly code: 'CHANGE_COOLDOWN'; readonly availableAt: number }

export type CareerResult =
  | {
      readonly ok: true
      readonly snapshot: GameSnapshot
      readonly changed: boolean
      /** An artist/DJ's home bonus can lift the level at once. */
      readonly levelUp: LevelUp | null
    }
  | { readonly ok: false; readonly error: CareerError }

/** Chooses (or changes) the Dream; see the module comment for the cooldown. */
export function chooseCareer(
  snapshot: GameSnapshot,
  careerPath: string,
  config: EngineConfig,
): CareerResult {
  if (!isCareerPath(careerPath)) {
    return { ok: false, error: { code: 'UNKNOWN_CAREER', careerPath } }
  }
  const { player } = snapshot
  if (player.careerPath === careerPath) {
    return { ok: true, snapshot, changed: false, levelUp: null }
  }
  const now = snapshot.clock.minute
  const availableAt = changeAvailableAt(player.careerChangedAt, now, config)
  if (availableAt !== null) return { ok: false, error: { code: 'CHANGE_COOLDOWN', availableAt } }
  const settled = settleLevel({ ...player, careerPath, careerChangedAt: now }, now, 'home', config)
  return {
    ok: true,
    snapshot: { ...snapshot, player: settled.player },
    changed: true,
    levelUp: settled.levelUp,
  }
}
