/**
 * Schemas for the Blender-built landmark models (S07c, DEC-25):
 *
 * - data/landmarks/measurements/<id>.json: the real dimensions a model is built from. Numbers
 *   only from CC0 or public-domain sources (Wikidata, HAER/HABS, NPS, public-domain texts);
 *   anything else is marked `estimate` or `derived` and says how it was set. Never traced from
 *   photos.
 * - data/landmarks/blender/<id>.lock.json: what `npm run landmarks:blender` built: the pinned
 *   Blender, a digest of every input, and each shipped GLB's sha256, bytes and triangles, so
 *   `npm run landmarks:check` can tell (without Blender) whether a shipped model is stale.
 *
 * Imports only zod, so the Node scripts can load it.
 */
import { z } from 'zod'

const IdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'kebab-case id')
const metres = z.number().positive()
const sha256 = z.string().regex(/^[0-9a-f]{64}$/)

export const MEASUREMENT_LICENCES = ['CC0-1.0', 'public-domain'] as const

const MeasurementSourceSchema = z.strictObject({
  id: IdSchema,
  title: z.string().min(1),
  url: z.url({ protocol: /^https$/ }),
  licence: z.enum(MEASUREMENT_LICENCES),
})

/** Where a number came from: a listed source, an estimate, or derived from other values. */
const SourceRefSchema = z.string().min(1)
const UNSOURCED = ['estimate', 'derived']

const DimensionSchema = z.union([
  z.strictObject({ valueM: metres, source: SourceRefSchema, note: z.string().min(1) }),
  z.strictObject({
    widthM: metres,
    depthM: metres,
    source: SourceRefSchema,
    note: z.string().min(1),
  }),
  z.strictObject({
    count: z.int().positive(),
    diameterM: metres,
    source: SourceRefSchema,
    note: z.string().min(1),
  }),
])

/** Thin members are drawn this many times their true width so they read in game (3-5x). */
const readability = z.number().min(1).max(5)

export const LandmarkMeasurementsSchema = z
  .strictObject({
    id: IdSchema,
    retrieved: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
    sources: z.array(MeasurementSourceSchema).min(1),
    dimensions: z.record(z.string().regex(/^[a-z][A-Za-z]*$/), DimensionSchema),
    readabilityScale: z.record(z.string(), z.union([readability, z.string()])),
    /**
     * Game scale: heights and widths drawn this many times the real numbers so the model reads
     * at the game camera (3-4.5 km); lengths along a bridge axis stay real.
     */
    gameScale: z
      .strictObject({
        height: z.number().min(1).max(2.5),
        plan: z.number().min(1).max(2.5),
        note: z.string().min(1),
      })
      .optional(),
  })
  .superRefine((file, ctx) => {
    const ids = new Set(file.sources.map((source) => source.id))
    for (const [key, dimension] of Object.entries(file.dimensions)) {
      if (!ids.has(dimension.source) && !UNSOURCED.includes(dimension.source)) {
        ctx.addIssue({
          code: 'custom',
          message: `source "${dimension.source}" is not listed (or "estimate" / "derived")`,
          path: ['dimensions', key, 'source'],
        })
      }
    }
  })
export type LandmarkMeasurements = z.infer<typeof LandmarkMeasurementsSchema>

const LockLevelSchema = z.strictObject({
  level: z.int().min(0).max(3),
  /** The shipped (compressed) file, relative to the repository root. */
  file: z.string().regex(/^public\/landmarks\/[a-z0-9-]+\/lod[0-3]\.glb$/),
  sha256,
  bytes: z.int().positive(),
  triangles: z.int().positive(),
  /** The uncompressed master in .cache/blender (not committed). */
  uncompressedBytes: z.int().positive(),
})

export const BlenderLockSchema = z.strictObject({
  version: z.literal(1),
  id: IdSchema,
  blender: z.strictObject({
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    buildHash: z.string().regex(/^[0-9a-f]{12}$/),
  }),
  /** sha256 of the canonical JSON of every build input (scripts/blender/inputs.ts). */
  inputsSha: sha256,
  caps: z.strictObject({
    low: z.int().positive(),
    mid: z.int().positive(),
    high: z.int().positive(),
  }),
  levels: z
    .array(LockLevelSchema)
    .length(4)
    .refine((levels) => levels.every((entry, i) => entry.level === i), {
      error: 'levels must be L0..L3 in order',
    }),
})
export type BlenderLock = z.infer<typeof BlenderLockSchema>
