/**
 * The player's look (S16a): option ids only (data/avatar/options.json; the engine reads their ids from data/avatar/engine.derived.json), never models, colours or
 * free text, so a model can change without breaking a save and other players only ever receive
 * enums (D13).
 *
 * - `randomLook`: a guest's starting look, the same for the same seed and always valid.
 * - `repairLook`: an untrusted saved look with every unknown id replaced by the default.
 * What is drawn (`effectiveLook`) and the creator's own choice (`chooseLook`) live in
 * src/engine/avatarLook.ts and src/engine/creatorFlow.ts, off the playable path (PERF-6).
 * - `publicAvatar`: what another player may see of it: the look ids and the worn item ids.
 */
import { LOOK_FIELDS, lookFieldIds, lookIssue, type LookField } from '@/lib/data/avatarIds'
import type { EngineConfig } from './config'
import type { PlayerState } from './game'
import { ITEM_SLOTS } from './items'
import { createRng, type Rng } from './rng'

/** A saved look: one option id per field. */
export type Look = Readonly<Record<LookField, string>>

export { LOOK_FIELDS, type LookField }

/** Why a look does not fit the options (the first bad field), or null. */
export function lookProblem(look: Look, config: EngineConfig): LookField | null {
  return lookIssue(look, config.avatar)
}

function pick<T>(list: readonly T[], rng: Rng): T {
  const value = list[Math.floor(rng.next() * list.length)]
  if (value === undefined) throw new Error('appearance: an option list is empty')
  return value
}

/** One of the non-`none` options of a category, or `none` when the chance roll misses. */
function maybe(ids: readonly string[], chance: number, rng: Rng): string {
  // Always two draws, so the fields after this one do not shift with the outcome.
  const hit = rng.next() < chance
  const choice = pick(
    ids.filter((id) => id !== 'none'),
    rng,
  )
  return hit ? choice : 'none'
}

/**
 * A random, valid look for `seed` (a guest's start, and the migration's seeded look). Every
 * field is drawn with a fixed number of draws, in a fixed order, so a seed always gives the same
 * look. Extras (facial hair, eyewear, a head covering, a hearing aid) land on their own chance
 * from `random`.
 */
export function randomLook(seed: number, config: EngineConfig): Look {
  const options = config.avatar
  const rng = createRng(seed)
  const ids = (field: LookField, hairStyle?: string) => lookFieldIds(field, options, hairStyle)
  const hairStyle = pick(ids('hairStyle'), rng)
  return {
    skin: pick(ids('skin'), rng),
    hairStyle,
    hairColor: pick(ids('hairColor', hairStyle), rng),
    facialHair: maybe(ids('facialHair'), options.random.facialHair, rng),
    headwear: maybe(ids('headwear'), options.random.headwear, rng),
    eyewear: maybe(ids('eyewear'), options.random.eyewear, rng),
    ears: maybe(ids('ears'), options.random.hearingAid, rng),
    outfit: pick(ids('outfit'), rng),
    top: pick(ids('top'), rng),
    bottom: pick(ids('bottom'), rng),
    shoes: pick(ids('shoes'), rng),
    height: pick(ids('height'), rng),
  }
}

/**
 * A look from an untrusted save: each field that is not a string naming an option of its
 * category becomes the default (a hair colour the hairstyle does not offer becomes the default
 * when the style offers it, else the style's first colour), and unknown keys are dropped.
 * `repaired` is false when the look was already valid.
 */
export function repairLook(
  raw: unknown,
  config: EngineConfig,
): { readonly look: Look; readonly repaired: boolean } {
  const source =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  const { defaults } = config.avatar
  let repaired = Object.keys(source).some(
    (key) => !(LOOK_FIELDS as readonly string[]).includes(key),
  )
  const look: Record<LookField, string> = { ...defaults }
  // hairStyle comes before hairColor in LOOK_FIELDS, so the colour is checked against the
  // style already kept.
  for (const field of LOOK_FIELDS) {
    const value = Object.hasOwn(source, field) ? source[field] : undefined
    const allowed = lookFieldIds(field, config.avatar, look.hairStyle)
    if (typeof value === 'string' && allowed.includes(value)) {
      look[field] = value
      continue
    }
    const fallback = allowed.includes(defaults[field]) ? defaults[field] : allowed[0]
    if (fallback === undefined) throw new Error(`appearance: no option for ${field}`)
    look[field] = fallback
    repaired = true
  }
  return { look, repaired }
}

/** What another player may see of the avatar (D13): enums only, never cash or inventory. */
export interface PublicAvatar {
  readonly look: Look
  /** Ids of the wearables worn, in outfit slot order. */
  readonly worn: readonly string[]
}

/**
 * The public part of a player's avatar. The server (S18c) recomputes the effective look from the
 * items it knows the player owns; S31 draws it.
 */
export function publicAvatar(player: Pick<PlayerState, 'look' | 'inventory'>): PublicAvatar {
  const worn = ITEM_SLOTS.flatMap((slot) => {
    const itemId = player.inventory.outfit[slot]
    return itemId === undefined ? [] : [itemId]
  })
  return { look: { ...player.look }, worn }
}

/** 32-bit FNV-1a of a string: a stable seed from save facts (the migration's look). */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * A seed made from facts an older save already holds, so loading the same old save always gives
 * the same look (D14): the clock, cash, stats, home and the generator states.
 */
export function lookSeedFromFacts(facts: {
  readonly minute: number
  readonly cash: number
  readonly stats: unknown
  readonly home: unknown
  readonly generators: readonly unknown[]
}): number {
  return fnv1a(
    JSON.stringify([facts.minute, facts.cash, facts.stats, facts.home, ...facts.generators]),
  )
}
