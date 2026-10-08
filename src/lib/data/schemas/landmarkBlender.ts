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
  z.strictObject({ count: z.int().positive(), source: SourceRefSchema, note: z.string().min(1) }),
  /** A point a model places a feature at (e.g. Wikidata P625 coordinates, CC0). */
  z.strictObject({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    source: SourceRefSchema,
    note: z.string().min(1),
  }),
])

/** Thin members are drawn this many times their true width so they read in game (3-5x). */
const readability = z.number().min(1).max(5)

export const LandmarkMeasurementsSchema = z
  .strictObject({
    id: IdSchema,
    /**
     * What the model stands on when the landmark has no frame in frames.derived.json yet
     * (monuments, neighbourhoods, the memorial: S07b); a frame's own base wins.
     */
    base: z.enum(['land', 'water']).optional(),
    /**
     * Where a landmark without a LION frame faces: the compass heading of the model's +y (its
     * front, or a district's main axis). The geo build places it at its landmarks.json location
     * turned by this (0 when absent: map-oriented, like the parks).
     */
    placement: z
      .strictObject({ headingDeg: z.number().min(0).lt(360), note: z.string().min(1) })
      .optional(),
    /**
     * A park model's map area: the id of its polygon in data/geo/parks.derived.json. The build
     * fills that outline (around the landmark's landmarks.json location, map-oriented: north up),
     * so the model matches the green the map draws.
     */
    park: IdSchema.optional(),
    retrieved: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
    sources: z.array(MeasurementSourceSchema).min(1),
    dimensions: z.record(z.string().regex(/^[a-z][A-Za-z0-9]*$/), DimensionSchema),
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

/** A rectangle in a model's own frame (x east, y north at heading 0), angle from east. */
export const ModelRectSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  halfLengthM: metres,
  halfWidthM: metres,
  angleDeg: z.number().min(0).lt(360),
})
export type ModelRect = z.infer<typeof ModelRectSchema>

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
  /**
   * How the geo build places the model (scripts/geo/landmarks.ts): its top above its base (the
   * pin's lift, at game scale) and the ground it covers, which district buildings, fill blocks
   * and streets keep clear of.
   */
  placement: z.strictObject({
    topM: metres,
    exclusions: z.array(ModelRectSchema),
  }),
  levels: z
    .array(LockLevelSchema)
    .length(4)
    .refine((levels) => levels.every((entry, i) => entry.level === i), {
      error: 'levels must be L0..L3 in order',
    }),
})
export type BlenderLock = z.infer<typeof BlenderLockSchema>

/**
 * data/landmarks/blender.derived.json: what the client needs to draw every Blender landmark,
 * written by `npm run landmarks:blender` from the locks and measurements (so the server loads
 * one validated file, not a lock per landmark): each level's served URL (versioned by its
 * sha256, so the service worker may cache it forever), its triangles, the model's game-scale
 * top and the scale its kit fallback is drawn at while the GLB loads.
 */
export const BlenderModelsFileSchema = z.strictObject({
  format: z.literal('cc-landmark-glb-v1'),
  derived: z.literal(true),
  landmarks: z
    .array(
      z.strictObject({
        id: IdSchema,
        /** L0..L3, finest first: `/landmarks/<id>/lod<n>.glb?v=<sha8>`. */
        files: z
          .array(z.string().regex(/^\/landmarks\/[a-z0-9-]+\/lod[0-3]\.glb\?v=[0-9a-f]{8}$/))
          .length(4),
        triangles: z.array(z.int().positive()).length(4),
        topM: metres,
        /** The measurements' game scale (1 where none): the kit fallback's height and plan. */
        gameScale: z.strictObject({ height: z.number().positive(), plan: z.number().positive() }),
      }),
    )
    .refine((list) => list.every((entry, i) => i === 0 || entry.id > (list[i - 1]?.id ?? '')), {
      error: 'landmarks must be sorted by id',
    }),
})
export type BlenderModelsFile = z.infer<typeof BlenderModelsFileSchema>
