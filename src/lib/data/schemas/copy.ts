/** Schemas for /data/copy: base strings and swappable slang packs. */
import { z } from 'zod'
import { hasMalformedPlaceholder } from '../../placeholders'
import { CopyKeyRefSchema } from './content'

/** Superlative words players may see, but only through `superlative()` (computed from data). */
export const SUPERLATIVE_KINDS = ['cheapest', 'biggest', 'best', 'most', 'fastest'] as const
export type SuperlativeKind = (typeof SUPERLATIVE_KINDS)[number]

/** One copy string. Braces must form valid `{name}` placeholders. */
const CopyStringSchema = z
  .string()
  .min(1)
  .max(500)
  .refine((text) => !hasMalformedPlaceholder(text), {
    error: 'malformed placeholder: use {name} (a letter, then letters or digits)',
  })

export const BaseCopySchema = z.strictObject({
  /** Every player-facing string, in plain English. Packs may override any of them. */
  strings: z.record(CopyKeyRefSchema, CopyStringSchema),
  /** The only place superlative words may appear (GR-11). Keyed by kind. */
  superlatives: z.strictObject({
    cheapest: CopyStringSchema,
    biggest: CopyStringSchema,
    best: CopyStringSchema,
    most: CopyStringSchema,
    fastest: CopyStringSchema,
  }),
})
export type BaseCopy = z.infer<typeof BaseCopySchema>

/** A slang pack overrides some base strings. Unknown keys are rejected in copy.test.ts. */
export const SlangPackSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  strings: z.record(CopyKeyRefSchema, CopyStringSchema),
})
export type SlangPack = z.infer<typeof SlangPackSchema>
