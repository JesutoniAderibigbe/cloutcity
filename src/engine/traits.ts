/**
 * Traits (S16a, D16): the player picks `traits.pick` (creator.json) of data/avatar/traits.json.
 * Each trait carries small modifiers on systems that exist today, never more than
 * `maxModifierPct` per kind however the traits add up:
 *
 * - `energy-cost`: the energy an action costs up front (shifts, flexes, place actions, meals).
 * - `mood-gain`: positive mood effects of actions (losses are untouched).
 * - `shop-price`: what shop items cost.
 * - `travel-time`: how long a trip takes.
 *
 * Every adjusted number is rounded to a whole value, and a cost or a duration that was above 0
 * stays above 0. The effects are data (`effects[]`), so S36 (needs) and S39 (skills) add kinds
 * without touching the save. Changing a chosen pair waits for the creator's change cooldown,
 * like the career path (src/engine/career.ts).
 */
import type { TraitEffectKind } from '@/lib/data/avatarIds'
import type { ActionDef } from './actions'
import { changeAvailableAt } from './career'
import type { EngineConfig } from './config'
import type { GameSnapshot, PlayerState } from './game'

export type { TraitEffectKind }

/** The number of traits the creator asks for. */
export function traitPickCount(config: EngineConfig): number {
  const step = config.creator.steps.find((entry) => entry.id === 'traits')
  return step !== undefined && 'pick' in step ? step.pick : 0
}

export function isTraitId(id: unknown, config: EngineConfig): id is string {
  return typeof id === 'string' && config.traits.traits.some((trait) => trait.id === id)
}

/** The summed percent the player's traits change `kind` by, capped at ±maxModifierPct. */
export function traitPct(
  player: Pick<PlayerState, 'traits'>,
  kind: TraitEffectKind,
  config: EngineConfig,
): number {
  let sum = 0
  for (const id of player.traits) {
    const trait = config.traits.traits.find((entry) => entry.id === id)
    for (const effect of trait?.effects ?? []) if (effect.kind === kind) sum += effect.pct
  }
  const cap = config.traits.maxModifierPct
  return Math.min(cap, Math.max(-cap, sum))
}

/** `value` changed by `pct` percent, whole; a value above 0 never drops to 0. */
export function scaleByPct(value: number, pct: number): number {
  if (pct === 0 || value === 0) return value
  const scaled = Math.round((value * (100 + pct)) / 100)
  return value > 0 ? Math.max(1, scaled) : scaled
}

/** An action's up-front energy cost and positive mood effect with the player's traits applied. */
export function traitAdjustedAction(
  def: ActionDef,
  player: Pick<PlayerState, 'traits'>,
  config: EngineConfig,
): ActionDef {
  const energyPct = traitPct(player, 'energy-cost', config)
  const moodPct = traitPct(player, 'mood-gain', config)
  const mood = def.statEffects.mood
  if (
    (energyPct === 0 || def.energyCost === 0) &&
    (moodPct === 0 || mood === undefined || mood <= 0)
  ) {
    return def
  }
  return {
    ...def,
    energyCost: Math.min(config.stats.max, scaleByPct(def.energyCost, energyPct)),
    statEffects:
      mood !== undefined && mood > 0
        ? { ...def.statEffects, mood: Math.min(config.stats.max, scaleByPct(mood, moodPct)) }
        : def.statEffects,
  }
}

/** A trip's action with the player's travel-time trait applied to its duration. */
export function traitAdjustedTrip(
  def: ActionDef,
  player: Pick<PlayerState, 'traits'>,
  config: EngineConfig,
): ActionDef {
  const pct = traitPct(player, 'travel-time', config)
  return pct === 0 ? def : { ...def, durationMin: scaleByPct(def.durationMin, pct) }
}

/** What a shop item costs this player (its price with the shop-price trait applied). */
export function traitAdjustedPrice(
  price: number,
  player: Pick<PlayerState, 'traits'>,
  config: EngineConfig,
): number {
  return scaleByPct(price, traitPct(player, 'shop-price', config))
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
