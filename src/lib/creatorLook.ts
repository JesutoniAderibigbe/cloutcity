/**
 * The creator's Look step as data (S16a, GR-12): its categories (Body, Hair, Facial hair,
 * Accessories, Skin, Outfit), the look fields each one holds, and every field's choices straight
 * from data/avatar/options.json, so the step offers exactly what the engine accepts (less the
 * options still pending their model, S16b). Pure: the step renders these, and
 * src/lib/creatorLook.test.ts holds them to the options.
 */
import type { Look, LookField } from '@/engine/appearance'
import compatJson from '@data/avatar/compat.json'
import type { AvatarOptions } from '@/lib/data/schemas/avatar'
import type { CopyKey } from './copy'

export const LOOK_CATEGORIES = [
  { id: 'body', titleKey: 'creator.look.category.body', fields: ['body'] },
  { id: 'hair', titleKey: 'creator.look.category.hair', fields: ['hairStyle', 'hairColor'] },
  { id: 'facialHair', titleKey: 'creator.look.category.facialHair', fields: ['facialHair'] },
  {
    id: 'accessories',
    titleKey: 'creator.look.category.accessories',
    fields: ['headwear', 'eyewear', 'ears'],
  },
  { id: 'skin', titleKey: 'creator.look.category.skin', fields: ['skin'] },
  {
    id: 'outfit',
    titleKey: 'creator.look.category.outfit',
    fields: ['outfit', 'top', 'bottom', 'shoes', 'height'],
  },
] as const satisfies readonly {
  id: string
  titleKey: CopyKey
  fields: readonly LookField[]
}[]

export type LookCategoryId = (typeof LOOK_CATEGORIES)[number]['id']

/** Each field's legend. */
export const FIELD_LEGEND: Readonly<Record<LookField, CopyKey>> = {
  body: 'creator.look.body',
  skin: 'creator.look.skin',
  hairStyle: 'creator.look.hairStyle',
  hairColor: 'creator.look.hairColor',
  facialHair: 'creator.look.facialHair',
  headwear: 'creator.look.headwear',
  eyewear: 'creator.look.eyewear',
  ears: 'creator.look.ears',
  outfit: 'creator.look.outfit',
  top: 'creator.look.top',
  bottom: 'creator.look.bottom',
  shoes: 'creator.look.shoes',
  height: 'creator.look.height',
}

/** One choice: its id, the copy key of its name, and its palette token when it is a swatch. */
export interface LookChoice {
  readonly id: string
  readonly nameKey: string
  readonly token?: string
}

const plain = (list: readonly { id: string; nameKey: string }[]): LookChoice[] =>
  list.map(({ id, nameKey }) => ({ id, nameKey }))

/** Options whose model is still pending its refit (S16b, data/avatar/compat.json) are not offered. */
const pending: readonly string[] = compatJson.pending
const drawn = (list: readonly { id: string; nameKey: string; model?: string; piece?: string }[]) =>
  plain(
    list.filter((option) => {
      const model = option.model ?? option.piece
      return model === undefined || !pending.includes(model)
    }),
  )

const swatches = (list: readonly { id: string; nameKey: string; token: string }[]) =>
  list.map(({ id, nameKey, token }): LookChoice => ({ id, nameKey, token }))

/** The choices for `field` in `look` (a body offers only its outfits). */
export function lookChoices(field: LookField, look: Look, options: AvatarOptions): LookChoice[] {
  switch (field) {
    case 'body':
      return plain(options.bodies)
    case 'skin':
      return swatches(options.skinTones)
    case 'hairStyle':
      return drawn(options.hairStyles)
    case 'hairColor':
      return swatches(options.hairColors)
    case 'facialHair':
      return drawn(options.facialHair)
    case 'headwear':
      return drawn(options.headwear)
    case 'eyewear':
      return drawn(options.eyewear)
    case 'ears':
      return drawn(options.ears)
    case 'outfit':
      // Only the outfits the body frame has (S16b).
      return plain(options.outfits.filter((outfit) => outfit.variants[look.body] !== undefined))
    case 'top':
    case 'bottom':
      return swatches(options.garmentColors)
    case 'shoes':
      // In shoeColors' order: the garment colours shoes come in.
      return swatches(
        options.shoeColors.flatMap((id) => options.garmentColors.filter((c) => c.id === id)),
      )
    case 'height':
      return plain(options.heights)
  }
}

/**
 * The look with `field` set to `value`. A new body without the current outfit takes its first
 * outfit, so the draft is always a look the engine accepts.
 */
export function withChoice(look: Look, field: LookField, value: string, options: AvatarOptions) {
  const next: Look = { ...look, [field]: value }
  if (field !== 'body') return next
  const outfits = lookChoices('outfit', next, options)
  return outfits.some((outfit) => outfit.id === next.outfit)
    ? next
    : { ...next, outfit: outfits[0]?.id ?? next.outfit }
}

/** The covering that hides the hair in `look`, or undefined. */
export function hairHiddenBy(look: Look, options: AvatarOptions) {
  const headwear = options.headwear.find((option) => option.id === look.headwear)
  return headwear?.hidesHair === true ? headwear : undefined
}
