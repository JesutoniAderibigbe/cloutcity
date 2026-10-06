/**
 * Schemas for game content: /data/items, premium, events, jobs, venues, landmarks.
 *
 * Content never carries player-facing text. It names copy keys (`nameKey`, `titleKey`, ...)
 * that resolve through the copy layer, so every string goes through the slang pack and the
 * superlative check. Cross-file references (copy keys, balance ids) are checked in
 * src/lib/data/data.test.ts.
 */
import { z } from 'zod'
import { JOB_IDS, RarityTierSchema } from './config'

export const IdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'kebab-case id')
export const CopyKeyRefSchema = z.string().regex(/^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+$/)

export const BOROUGHS = ['queens', 'brooklyn', 'manhattan', 'bronx', 'staten-island'] as const
export const BoroughSchema = z.enum(BOROUGHS)
export type Borough = z.infer<typeof BoroughSchema>

/** WGS84 point. Bounds against data/geo/bounds.json are checked in data.test.ts. */
export const LatLngSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
})

/** Rejects a list whose entries share an id. */
function uniqueIds<T extends { id: string }>(list: readonly T[], ctx: z.RefinementCtx) {
  const seen = new Set<string>()
  list.forEach((entry, index) => {
    if (seen.has(entry.id)) {
      ctx.addIssue({ code: 'custom', message: `duplicate id "${entry.id}"`, path: [index, 'id'] })
    }
    seen.add(entry.id)
  })
}

/** An array of entries with unique ids. */
export function listOf<T extends z.ZodType<{ id: string }>>(entry: T) {
  return z.array(entry).superRefine(uniqueIds)
}

const dollars = z.int().nonnegative()

export const STATS = ['energy', 'hunger', 'mood'] as const
export const StatSchema = z.enum(STATS)

export const ItemSchema = z
  .strictObject({
    id: IdSchema,
    nameKey: CopyKeyRefSchema,
    category: z.enum(['clothing', 'makeup', 'gift', 'decor', 'upgrade']),
    rarity: RarityTierSchema,
    /** In-game cash, whole dollars. */
    price: dollars,
    sellValue: dollars,
    cloutValue: z.int().nonnegative(),
    statEffects: z.partialRecord(StatSchema, z.number()),
  })
  .refine((item) => item.sellValue <= item.price, {
    error: 'sellValue must not exceed price',
    path: ['sellValue'],
  })
export const ItemsFileSchema = z.strictObject({ items: listOf(ItemSchema) })
export type Item = z.infer<typeof ItemSchema>

/**
 * Real-money items. Strict on purpose: a `sellValue` or in-game `price` is a schema error,
 * because premium items can never be bought or sold for in-game cash.
 */
export const PremiumItemSchema = z.strictObject({
  id: IdSchema,
  nameKey: CopyKeyRefSchema,
  kind: z.enum(['outfit', 'apartment-theme', 'badge', 'share-frame']),
  rarity: RarityTierSchema,
  currency: z.literal('usd'),
  /** A key of balance.premiumPriceTiersUsd. */
  priceTier: z.string().regex(/^tier-\d+$/),
  cloutValue: z.int().nonnegative(),
  styleValue: z.int().nonnegative(),
})
export const PremiumFileSchema = z.strictObject({ items: listOf(PremiumItemSchema) })
export type PremiumItem = z.infer<typeof PremiumItemSchema>

export const EventSchema = z.strictObject({
  id: IdSchema,
  titleKey: CopyKeyRefSchema,
  bodyKey: CopyKeyRefSchema,
})
export const EventsFileSchema = z.strictObject({ events: listOf(EventSchema) })
export type GameEvent = z.infer<typeof EventSchema>

/** Wages and shift length live in data/config/balance.json, keyed by job id. */
export const JobSchema = z.strictObject({
  id: z.enum(JOB_IDS),
  nameKey: CopyKeyRefSchema,
})
export const JobsFileSchema = z.strictObject({ jobs: listOf(JobSchema) })
export type Job = z.infer<typeof JobSchema>

export const VENUE_TYPES = [
  'bodega',
  'food-spot',
  'subway-station',
  'park',
  'gym',
  'coffee-shop',
  'boutique',
  'thrift',
  'club',
  'job-site',
] as const

const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Opening hours on the personal game clock: `24h`, or an open and a close time. A close
 * earlier than the open runs past midnight (a club open 22:00 to 04:00).
 */
export const HoursSchema = z.union([
  z.literal('24h'),
  z
    .strictObject({ open: z.string().regex(CLOCK_TIME), close: z.string().regex(CLOCK_TIME) })
    .refine((hours) => hours.open !== hours.close, {
      error: 'open and close must differ (use "24h" for always open)',
    }),
])
export type Hours = z.infer<typeof HoursSchema>

/**
 * Fields every place shares (venues and landmarks are one id space). `borough` and `zoneId`
 * are written by hand and checked against the S04 geo layers in
 * src/lib/world/places-content.test.ts, which prints the expected value on a mismatch.
 */
const placeBase = {
  id: IdSchema,
  nameKey: CopyKeyRefSchema,
  borough: BoroughSchema,
  zoneId: IdSchema,
  location: LatLngSchema,
}

/** Station venues are deliberately unbranded and point at an S04 subway station. */
const StationVenueSchema = z.strictObject({
  ...placeBase,
  blurbKey: CopyKeyRefSchema,
  type: z.literal('subway-station'),
  hours: HoursSchema,
  stationId: IdSchema,
})

const BusinessVenueSchema = z.strictObject({
  ...placeBase,
  blurbKey: CopyKeyRefSchema,
  type: z.enum(VENUE_TYPES).exclude(['subway-station']),
  hours: HoursSchema,
  /** Jobs worked here (data only until a task wires shifts to venues). */
  jobIds: z.array(z.enum(JOB_IDS)).min(1).optional(),
})

/** Invented businesses with original names, at plausible real coordinates. No prices here. */
export const VenueSchema = z.discriminatedUnion('type', [StationVenueSchema, BusinessVenueSchema])
export const VenuesFileSchema = z.strictObject({ venues: listOf(VenueSchema) })
export type Venue = z.infer<typeof VenueSchema>

export const LANDMARK_CATEGORIES = [
  'bridge',
  'building',
  'monument',
  'park',
  'stadium',
  'government',
  'station',
  'neighborhood',
  'memorial',
] as const

/** What a player can do at a non-memorial landmark. */
export const LANDMARK_INTERACTIONS = ['visit', 'flex', 'emote', 'events'] as const

const landmarkBase = {
  ...placeBase,
  infoKey: CopyKeyRefSchema,
  /** `generic` for trademarked or corporate-branded names. */
  nameMode: z.enum(['real', 'generic']),
  /** Stays false until a human checks the name and depiction. */
  legalReviewed: z.boolean(),
  /**
   * Where the player stands and routes to when `location` is not reachable land (a bridge
   * midspan, an island). `borough` and `zoneId` describe this point when it is set.
   */
  approach: LatLngSchema.optional(),
  /** Boroughs a bridge connects. */
  spans: z.array(BoroughSchema).min(2).optional(),
}

const InteractionsSchema = z
  .array(z.enum(LANDMARK_INTERACTIONS))
  .min(1)
  .refine((list) => new Set(list).size === list.length, { error: 'interactions repeat' })

const PlainLandmarkSchema = z.strictObject({
  ...landmarkBase,
  category: z.enum(LANDMARK_CATEGORIES).exclude(['memorial']),
  interactions: InteractionsSchema,
})

/**
 * Memorials are respectful, look-only stops (CLAUDE.md "Map and landmarks"). Strict, so any
 * interaction, flex, clout, emote or event field is a schema error.
 */
const MemorialLandmarkSchema = z.strictObject({
  ...landmarkBase,
  category: z.literal('memorial'),
  lookOnly: z.literal(true),
})

export const LandmarkSchema = z.discriminatedUnion('category', [
  PlainLandmarkSchema,
  MemorialLandmarkSchema,
])
export const LandmarksFileSchema = z.strictObject({ landmarks: listOf(LandmarkSchema) })
export type Landmark = z.infer<typeof LandmarkSchema>
