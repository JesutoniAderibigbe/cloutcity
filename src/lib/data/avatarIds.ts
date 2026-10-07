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

interface Option {
  readonly id: string
}

/** The option lists a look is checked against (data/avatar/options.json). */
export interface LookOptionLists {
  readonly skinTones: readonly Option[]
  readonly hairStyles: readonly (Option & { readonly hairColors?: readonly string[] })[]
  readonly hairColors: readonly Option[]
  readonly facialHair: readonly Option[]
  readonly headwear: readonly Option[]
  readonly eyewear: readonly Option[]
  readonly ears: readonly Option[]
  readonly outfits: readonly Option[]
  readonly garmentColors: readonly Option[]
  readonly shoeColors: readonly string[]
  readonly heights: readonly Option[]
}

/** The ids `field` may hold. A hairstyle may limit the hair colours (SLOT-1 fallback (c)). */
export function lookFieldIds(
  field: LookField,
  options: LookOptionLists,
  hairStyle?: string,
): readonly string[] {
  const ids = (list: readonly Option[]) => list.map((option) => option.id)
  switch (field) {
    case 'skin':
      return ids(options.skinTones)
    case 'hairStyle':
      return ids(options.hairStyles)
    case 'hairColor': {
      const limit = options.hairStyles.find((style) => style.id === hairStyle)?.hairColors
      return limit ?? ids(options.hairColors)
    }
    case 'facialHair':
      return ids(options.facialHair)
    case 'headwear':
      return ids(options.headwear)
    case 'eyewear':
      return ids(options.eyewear)
    case 'ears':
      return ids(options.ears)
    case 'outfit':
      return ids(options.outfits)
    case 'top':
    case 'bottom':
      return ids(options.garmentColors)
    case 'shoes':
      return options.shoeColors
    case 'height':
      return ids(options.heights)
  }
}

/** The first field of `look` that names no option (or a hair colour its style does not offer), or null. */
export function lookIssue(
  look: Readonly<Record<LookField, string>>,
  options: LookOptionLists,
): LookField | null {
  for (const field of LOOK_FIELDS) {
    if (!lookFieldIds(field, options, look.hairStyle).includes(look[field])) return field
  }
  return null
}
