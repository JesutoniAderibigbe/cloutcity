/**
 * Schemas for /data/avatar (S16a): the look options (options.json) and the traits (traits.json).
 *
 * A look is option ids only. Each option maps to catalog model ids (data/assets/catalog.json) and
 * model palette tokens (data/config/theme.json `models`), so swapping a model later never breaks
 * a save. Cross-file references (model ids, tokens, copy keys) are checked in
 * src/lib/data/avatar-data.test.ts; the engine narrows the same files without classic zod
 * (src/engine/config.ts).
 */
import { z } from 'zod'
import { ATTACHMENT_KINDS, LOOK_FIELDS, TRAIT_EFFECT_KINDS, lookIssue } from '../avatarIds'
import { CopyKeyRefSchema, IdSchema } from './content'

export { ATTACHMENT_KINDS, LOOK_FIELDS, TRAIT_EFFECT_KINDS, lookIssue }

/**
 * A model palette token. Wider than theme.json's `<family>-<n>` because the dyed hair colours
 * (`hair-pink-400`, `hair-blue-500`, DEC-28/D6) name a family and a shade.
 */
export const AvatarTokenSchema = z.string().regex(/^[a-z]+(?:-[a-z]+)*-\d{2,3}$/)

/** A colour name lives in the shared `colors` namespace (A11Y-1): one place to review them. */
const ColorNameKeySchema = CopyKeyRefSchema.refine((key) => key.startsWith('colors.'), {
  error: 'a colour name lives in the colors copy namespace',
})
const AvatarNameKeySchema = CopyKeyRefSchema.refine((key) => key.startsWith('avatar.'), {
  error: 'an option name lives in the avatar copy namespace',
})

const SwatchSchema = z.strictObject({ id: IdSchema, token: AvatarTokenSchema })
const SkinToneSchema = SwatchSchema.extend({ nameKey: AvatarNameKeySchema })
const ColorSchema = SwatchSchema.extend({ nameKey: ColorNameKeySchema })

/**
 * A hairstyle: a head model, plus a hair piece for the styles Kenney's heads do not have (they
 * sit on the bald `head-base`). `hairColors`, when set, is the only hair colours the style offers
 * (SLOT-1 fallback (c): a head whose features cannot be kept off the hair slot offers only dark
 * colours).
 */
const HairStyleSchema = z.strictObject({
  id: IdSchema,
  head: IdSchema,
  piece: IdSchema.optional(),
  nameKey: AvatarNameKeySchema,
  hairColors: z.array(IdSchema).min(1).optional(),
})

/** An attachment option; `none` has no model. */
const AttachmentOptionSchema = z
  .strictObject({ id: IdSchema, model: IdSchema.optional(), nameKey: AvatarNameKeySchema })
  .refine((option) => (option.id === 'none') === (option.model === undefined), {
    error: 'only the "none" option has no model',
    path: ['model'],
  })

/**
 * A head covering. `hidesHair` swaps the head to the bald base and hides any hair piece while it
 * is worn (the chosen hairstyle is kept for when it comes off). `colorSlot` is the model slot the
 * covering's fabric colour goes to.
 */
const HeadwearSchema = z
  .strictObject({
    id: IdSchema,
    model: IdSchema.optional(),
    hidesHair: z.boolean().optional(),
    colorSlot: IdSchema.optional(),
    nameKey: AvatarNameKeySchema,
  })
  .refine((option) => (option.id === 'none') === (option.model === undefined), {
    error: 'only the "none" option has no model',
    path: ['model'],
  })

const OutfitSchema = z.strictObject({ id: IdSchema, body: IdSchema, nameKey: AvatarNameKeySchema })

/** Root scale of the rig: heights stay within a few percent so the avatar fits every reserve. */
const HeightSchema = z.strictObject({
  id: IdSchema,
  scale: z.number().min(0.9).max(1.1),
  nameKey: AvatarNameKeySchema,
})

/** A saved look: one option id per field (src/engine/appearance.ts). */
export const LookIdsSchema = z.strictObject(
  Object.fromEntries(LOOK_FIELDS.map((field) => [field, IdSchema])) as Record<
    (typeof LOOK_FIELDS)[number],
    typeof IdSchema
  >,
)

const probability = z.number().min(0).max(1)
const unique = <T extends { readonly id: string }>(list: readonly T[]) =>
  new Set(list.map((entry) => entry.id)).size === list.length

const listOf = <T extends z.ZodType<{ readonly id: string }>>(schema: T) =>
  z.array(schema).min(1).refine(unique, { error: 'ids must be unique' })

export const AvatarOptionsSchema = z
  .strictObject({
    version: z.literal(1),
    skinTones: listOf(SkinToneSchema),
    hairColors: listOf(ColorSchema),
    hairStyles: listOf(HairStyleSchema),
    facialHair: listOf(AttachmentOptionSchema),
    headwear: listOf(HeadwearSchema),
    eyewear: listOf(AttachmentOptionSchema),
    ears: listOf(AttachmentOptionSchema),
    outfits: listOf(OutfitSchema),
    /** Top and bottom colours. */
    garmentColors: listOf(ColorSchema),
    /** Shoe colours: ids of `garmentColors`. */
    shoeColors: z.array(IdSchema).min(1),
    heights: listOf(HeightSchema),
    /** What a repaired field falls back to, and a new save's look before any seed. */
    defaults: LookIdsSchema,
    /** Chance (0..1) a random look gets each optional extra (TUNE-11 placeholders). */
    random: z.strictObject({
      facialHair: probability,
      eyewear: probability,
      headwear: probability,
      hearingAid: probability,
    }),
    /** At most `max` attachments per look; the first kinds in `priority` win (D8). */
    attachments: z.strictObject({
      max: z.int().min(1).max(6),
      priority: z
        .array(z.enum(ATTACHMENT_KINDS))
        .length(ATTACHMENT_KINDS.length)
        .refine((kinds) => new Set(kinds).size === kinds.length, { error: 'kinds repeat' }),
    }),
  })
  .refine(
    (options) =>
      ['facialHair', 'headwear', 'eyewear', 'ears'].every((list) =>
        (options[list as 'facialHair'] as readonly { id: string }[]).some((o) => o.id === 'none'),
      ),
    { error: 'every optional category offers "none"' },
  )
  .refine(
    (options) => options.shoeColors.every((id) => options.garmentColors.some((c) => c.id === id)),
    {
      error: 'shoeColors must name garmentColors',
      path: ['shoeColors'],
    },
  )
  .refine(
    (options) =>
      options.hairStyles.every(
        (style) =>
          style.hairColors === undefined ||
          style.hairColors.every((id) => options.hairColors.some((color) => color.id === id)),
      ),
    { error: 'a hairstyle limits hair colours to ones that exist', path: ['hairStyles'] },
  )
  .refine((options) => lookIssue(options.defaults, options) === null, {
    error: 'defaults must name an option in every field',
    path: ['defaults'],
  })
export type AvatarOptions = z.infer<typeof AvatarOptionsSchema>

const TraitEffectSchema = z.strictObject({
  kind: z.enum(TRAIT_EFFECT_KINDS),
  /** Whole percent, never 0. */
  pct: z.int().refine((pct) => pct !== 0, { error: 'an effect changes something' }),
})

const TraitSchema = z
  .strictObject({
    id: IdSchema,
    nameKey: CopyKeyRefSchema.refine((key) => key.startsWith('creator.trait.')),
    flavorKey: CopyKeyRefSchema.refine((key) => key.startsWith('creator.trait.')),
    effects: z.array(TraitEffectSchema).min(1),
  })
  .refine((trait) => new Set(trait.effects.map((e) => e.kind)).size === trait.effects.length, {
    error: 'a trait names each effect kind once',
    path: ['effects'],
  })

export const TraitsFileSchema = z
  .strictObject({
    version: z.literal(1),
    /**
     * Cap on the summed modifier of one kind, whatever traits are held (±10%, D16): every
     * effect sits within it too.
     */
    maxModifierPct: z.int().min(1).max(10),
    traits: z.array(TraitSchema).min(2).refine(unique, { error: 'trait ids must be unique' }),
  })
  .refine(
    (file) =>
      file.traits.every((trait) =>
        trait.effects.every((effect) => Math.abs(effect.pct) <= file.maxModifierPct),
      ),
    { error: 'an effect is above maxModifierPct', path: ['traits'] },
  )
export type TraitsFile = z.infer<typeof TraitsFileSchema>
