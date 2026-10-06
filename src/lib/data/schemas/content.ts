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
  'club',
  'job-site',
] as const

/** Invented businesses with original names, at plausible real coordinates. */
export const VenueSchema = z.strictObject({
  id: IdSchema,
  nameKey: CopyKeyRefSchema,
  type: z.enum(VENUE_TYPES),
  borough: BoroughSchema,
  location: LatLngSchema,
})
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

export const LandmarkSchema = z.strictObject({
  id: IdSchema,
  nameKey: CopyKeyRefSchema,
  category: z.enum(LANDMARK_CATEGORIES),
  /** `generic` for trademarked or corporate-branded names. */
  nameMode: z.enum(['real', 'generic']),
  /** Stays false until a human checks the name and depiction. */
  legalReviewed: z.boolean(),
  borough: BoroughSchema,
  location: LatLngSchema,
})
export const LandmarksFileSchema = z.strictObject({ landmarks: listOf(LandmarkSchema) })
export type Landmark = z.infer<typeof LandmarkSchema>
