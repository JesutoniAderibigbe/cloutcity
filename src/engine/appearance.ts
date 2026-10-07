/**
 * The player's look (S16a): option ids only (data/avatar/options.json), never models, colours or
 * free text, so a model can change without breaking a save and other players only ever receive
 * enums (D13).
 *
 * - `randomLook`: a guest's starting look, the same for the same seed and always valid.
 * - `repairLook`: an untrusted saved look with every unknown id replaced by the default.
 * - `effectiveLook`: what is drawn: the creator's look with worn items over it (a worn item
 *   always wins), the head swapped to the bald base under a covering that hides hair, and the
 *   attachments in priority order, capped (D8).
 * - `publicAvatar`: what another player may see of it: the look ids and the worn item ids.
 */
import { LOOK_FIELDS, lookFieldIds, lookIssue, type LookField } from '@/lib/data/avatarIds'
import type { ItemLook } from '@/lib/data/schemas/content'
import type { EngineConfig } from './config'
import type { GameSnapshot, PlayerState } from './game'
import { findItem, ITEM_SLOTS } from './items'
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

/** What the avatar shows: models and the attachments, by catalog model id (A2 resolves colours). */
export interface EffectiveLook {
  /** The creator's look with worn items over it (outfit, top, bottom and shoes). */
  readonly look: Look
  /** Head model: the hairstyle's head, or the bald base when the style or a covering needs it. */
  readonly head: string
  /** Body model: the outfit's body. */
  readonly body: string
  /** Attachment model ids, in priority order, at most `attachments.max`. */
  readonly attachments: readonly string[]
  /** True when a head covering hides the hair (the hairstyle is kept for when it comes off). */
  readonly hairHidden: boolean
  /** Root scale of the rig (the height option). */
  readonly scale: number
}

function optionOf<T extends { readonly id: string }>(list: readonly T[], id: string): T {
  const option = list.find((entry) => entry.id === id)
  if (option === undefined) throw new Error(`appearance: unknown option "${id}"`)
  return option
}

/** The `look` of every worn wearable, in outfit slot order. */
function wornLooks(player: Pick<PlayerState, 'inventory'>, config: EngineConfig): ItemLook[] {
  const looks: ItemLook[] = []
  for (const slot of ITEM_SLOTS) {
    const itemId = player.inventory.outfit[slot]
    if (itemId === undefined) continue
    const item = findItem(itemId, config)
    if (item !== undefined && 'look' in item && item.look !== undefined) looks.push(item.look)
  }
  return looks
}

/**
 * The look as drawn: worn items override the creator's base choice (a top sets the outfit and
 * its top colour, bottoms and shoes their colour, an accessory adds an attachment); a covering
 * marked `hidesHair` puts the bald base head on and hides the hair piece; attachments are kept
 * in `attachments.priority` order up to `attachments.max`.
 */
export function effectiveLook(
  player: Pick<PlayerState, 'look' | 'inventory'>,
  config: EngineConfig,
): EffectiveLook {
  const options = config.avatar
  let look: Look = player.look
  const items: string[] = []
  for (const worn of wornLooks(player, config)) {
    if (worn.part === 'outfit') look = { ...look, outfit: worn.outfit, top: worn.top }
    else if (worn.part === 'bottom') look = { ...look, bottom: worn.color }
    else if (worn.part === 'shoes') look = { ...look, shoes: worn.color }
    else if (worn.part === 'attachment') items.push(worn.model)
  }
  const style = optionOf(options.hairStyles, look.hairStyle)
  const headwear = optionOf(options.headwear, look.headwear)
  const hairHidden = headwear.hidesHair === true
  const byKind: Record<string, readonly string[]> = {
    headwear: headwear.model === undefined ? [] : [headwear.model],
    hairPiece: hairHidden || style.piece === undefined ? [] : [style.piece],
    facialHair: modelOf(options.facialHair, look.facialHair),
    eyewear: modelOf(options.eyewear, look.eyewear),
    ears: modelOf(options.ears, look.ears),
    item: items,
  }
  const attachments = options.attachments.priority
    .flatMap((kind) => byKind[kind] ?? [])
    .slice(0, options.attachments.max)
  return {
    look,
    head: hairHidden ? baseHead(options) : style.head,
    body: optionOf(options.outfits, look.outfit).body,
    attachments,
    hairHidden,
    scale: optionOf(options.heights, look.height).scale,
  }
}

function modelOf(
  list: readonly { readonly id: string; readonly model?: string }[],
  id: string,
): readonly string[] {
  const model = optionOf(list, id).model
  return model === undefined ? [] : [model]
}

/** The bald head the hair pieces sit on: the head of the first hairstyle that has a piece. */
function baseHead(options: EngineConfig['avatar']): string {
  const withPiece = options.hairStyles.find((style) => style.piece !== undefined)
  if (withPiece === undefined) throw new Error('appearance: no hairstyle uses a base head')
  return withPiece.head
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
