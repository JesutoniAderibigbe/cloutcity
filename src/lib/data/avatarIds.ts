/**
 * Ids and rules shared by the S16a schemas (schemas/avatar.ts, schemas/creator.ts,
 * schemas/config.ts) and the engine (src/engine/appearance.ts, career.ts, creator.ts, traits.ts).
 * No imports, so the engine and client code can use them without pulling classic zod in
 * (src/lib/client-imports.test.ts), and Node can load it from scripts/.
 */

/** The fields of a saved look, one option id each (data/avatar/options.json). */
export const LOOK_FIELDS = [
  'skin',
  'hairStyle',
  'hairColor',
  'facialHair',
  'headwear',
  'eyewear',
  'ears',
  'outfit',
  'top',
  'bottom',
  'shoes',
  'height',
] as const
export type LookField = (typeof LOOK_FIELDS)[number]

/** What an attachment is, for the attachment cap's priority order (D8). */
export const ATTACHMENT_KINDS = [
  'headwear',
  'hairPiece',
  'facialHair',
  'eyewear',
  'ears',
  'item',
] as const
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]

/** The systems a trait may nudge in S16a (D16); S36 needs and S39 skills add kinds later. */
export const TRAIT_EFFECT_KINDS = ['energy-cost', 'mood-gain', 'shop-price', 'travel-time'] as const
export type TraitEffectKind = (typeof TRAIT_EFFECT_KINDS)[number]

/** The four career paths (DEC-20): the "Dream" the creator asks for. */
export const CAREER_PATHS = ['influencer', 'streamer', 'artist-dj', 'founder-hustler'] as const
export type CareerPathId = (typeof CAREER_PATHS)[number]

/** Every creator step, in the order Lagos and SF use (D18). `origin` is S44's seam. */
export const CREATOR_STEP_IDS = [
  'look',
  'traits',
  'dream',
  'origin',
  'neighborhood',
  'home',
] as const
export type CreatorStepId = (typeof CREATOR_STEP_IDS)[number]

/** Rolls the creator makes. `origin` is S44's birth lottery. */
export const ROLL_KINDS = ['neighborhood', 'origin'] as const
export type RollKind = (typeof ROLL_KINDS)[number]

/** How long a roll holds: once per save (kept through prestige), or once per run. */
export const ROLL_SCOPES = ['save', 'run'] as const
export type RollScope = (typeof ROLL_SCOPES)[number]

/**
 * What the engine needs of the look options on the playable path: the ids each field may hold,
 * the hairstyles that limit their hair colours, the defaults and the random chances. Models,
 * tokens and copy keys stay in data/avatar/options.json, which only the creator and the avatar
 * chunks load (PERF-6).
 */
export interface AvatarIdTables {
  readonly look: Readonly<Record<LookField, readonly string[]>>
  readonly hairColorLimits: Readonly<Record<string, readonly string[]>>
  readonly defaults: Readonly<Record<LookField, string>>
  readonly random: {
    readonly facialHair: number
    readonly eyewear: number
    readonly headwear: number
    readonly hearingAid: number
  }
}

/** Each trait's summed modifier per kind, the cap and the pick count (data/avatar/traits.json). */
export interface TraitTables {
  readonly maxModifierPct: number
  readonly pick: number
  readonly effects: Readonly<Record<string, Readonly<Partial<Record<TraitEffectKind, number>>>>>
}

/** The creator rules every action needs (data/config/creator.json). */
export interface CreatorTables {
  readonly offerAfterActions: number
  /** The offer waits until the S06 tour is over. */
  readonly waitForTour: boolean
  readonly changeCooldownGameDays: number
  readonly rolls: Readonly<Partial<Record<RollKind, RollScope>>>
}

/**
 * data/avatar/engine.derived.json: the compact tables the engine reads on every load and
 * action, derived from the S16a source files by `deriveAvatarEngineTables`
 * (src/lib/data/avatar-derived.test.ts keeps the file in step; `npm run avatar:update`).
 */
export interface AvatarEngineTables {
  readonly version: 1
  readonly avatar: AvatarIdTables
  readonly traits: TraitTables
  readonly creator: CreatorTables
  /** Start neighborhood ids, in data order (the neighborhood roll's pool). */
  readonly neighborhoods: readonly string[]
}

/** The ids `field` may hold. A hairstyle may limit the hair colours (SLOT-1 fallback (c)). */
export function lookFieldIds(
  field: LookField,
  tables: AvatarIdTables,
  hairStyle?: string,
): readonly string[] {
  if (
    field === 'hairColor' &&
    hairStyle !== undefined &&
    Object.hasOwn(tables.hairColorLimits, hairStyle)
  ) {
    return tables.hairColorLimits[hairStyle] ?? []
  }
  return tables.look[field]
}

/** The first field of `look` that names no option (or a hair colour its style does not offer), or null. */
export function lookIssue(
  look: Readonly<Record<LookField, string>>,
  tables: AvatarIdTables,
): LookField | null {
  for (const field of LOOK_FIELDS) {
    if (!lookFieldIds(field, tables, look.hairStyle).includes(look[field])) return field
  }
  return null
}
