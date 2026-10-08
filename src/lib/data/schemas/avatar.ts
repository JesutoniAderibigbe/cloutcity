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
import {
  ATTACHMENT_KINDS,
  LOOK_FIELDS,
  ROLL_KINDS,
  ROLL_SCOPES,
  TRAIT_EFFECT_KINDS,
  lookIssue,
} from '../avatarIds'
import { deriveAvatarIds } from '../avatarDerive'
import { ModelRefSchema } from './assets'
import { CopyKeyRefSchema, IdSchema } from './content'
import { SceneConfigSchema } from './scene'

export { ATTACHMENT_KINDS, LOOK_FIELDS, TRAIT_EFFECT_KINDS, lookIssue }

/** A model palette token (theme.json `models`). */
export const AvatarTokenSchema = z.string().regex(/^[a-z]+-\d{2,3}$/)

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
  .refine((options) => lookIssue(options.defaults, deriveAvatarIds(options)) === null, {
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

const idList = z.array(IdSchema)

/**
 * data/avatar/engine.derived.json: the compact tables the engine reads on the playable path
 * (src/lib/data/avatarIds.ts `AvatarEngineTables`), derived from options.json, traits.json,
 * creator.json and neighborhoods.json. src/lib/data/avatar-derived.test.ts checks it is in step.
 */
export const AvatarEngineTablesSchema = z.strictObject({
  version: z.literal(1),
  avatar: z.strictObject({
    look: z.strictObject(
      Object.fromEntries(LOOK_FIELDS.map((field) => [field, idList.min(1)])) as Record<
        (typeof LOOK_FIELDS)[number],
        typeof idList
      >,
    ),
    hairColorLimits: z.record(IdSchema, idList.min(1)),
    defaults: LookIdsSchema,
    random: z.strictObject({
      facialHair: probability,
      eyewear: probability,
      headwear: probability,
      hearingAid: probability,
    }),
  }),
  traits: z.strictObject({
    maxModifierPct: z.int().min(1).max(10),
    pick: z.int().min(1),
    effects: z.record(IdSchema, z.partialRecord(z.enum(TRAIT_EFFECT_KINDS), z.int())),
  }),
  creator: z.strictObject({
    offerAfterActions: z.int().min(1),
    waitForTour: z.boolean(),
    changeCooldownGameDays: z.int().min(1),
    rolls: z.partialRecord(z.enum(ROLL_KINDS), z.enum(ROLL_SCOPES)),
  }),
  neighborhoods: idList.min(1),
})

/**
 * data/avatar/scene.derived.json (src/scene/avatar/types.ts `AvatarSceneRefs`): what the look
 * runtime reads in its lazy chunk, derived by src/lib/data/avatarScene.ts.
 */
export const AvatarSceneFileSchema = z.strictObject({
  version: z.literal(1),
  rig: ModelRefSchema,
  models: z.record(IdSchema, ModelRefSchema),
  colors: z.record(AvatarTokenSchema, z.string().regex(/^#[0-9a-f]{6}$/i)),
  attachments: SceneConfigSchema.shape.avatarLook.shape.attachments,
  preview: SceneConfigSchema.shape.avatarLook.shape.preview,
})

/** data/avatar/swatches.derived.json: the creator's swatch colours (src/lib/data/avatarScene.ts). */
export const AvatarSwatchesFileSchema = z.strictObject({
  version: z.literal(1),
  colors: z.record(AvatarTokenSchema, z.string().regex(/^#[0-9a-f]{6}$/i)),
})

const point = z.tuple([z.number(), z.number(), z.number()])

/**
 * data/avatar/frame.json (S16b): the bind-pose frame of the modular avatar parts and rigs,
 * written by `npm run assets:build`: each rig's joint positions and each part's material bounds
 * in fitted metres. The Blender attachment scripts fit to it.
 */
export const AvatarFrameFileSchema = z.strictObject({
  version: z.literal(1),
  generatedBy: z.string().min(1),
  models: z.record(
    IdSchema,
    z.strictObject({
      joints: z.record(IdSchema, point),
      materials: z.record(z.string().min(1), z.strictObject({ min: point, max: point })),
    }),
  ),
})
