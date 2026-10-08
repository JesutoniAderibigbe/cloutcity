/**
 * Schemas for game content: /data/items, premium, events, jobs, venues, landmarks.
 *
 * Content never carries player-facing text. It names copy keys (`nameKey`, `titleKey`, ...)
 * that resolve through the copy layer, so every string goes through the slang pack and the
 * superlative check. Cross-file references (copy keys, balance ids) are checked in
 * src/lib/data/data.test.ts.
 */
import { z } from 'zod'
import { HOME_IDS, JOB_IDS, PaletteTokenRefSchema, RarityTierSchema } from './config'

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

/** Outfit slots. Clothing fills the first four; makeup fills `face` (src/engine/items.ts mirrors this). */
export const ITEM_SLOTS = ['top', 'bottom', 'shoes', 'accessory', 'face'] as const
export const ItemSlotSchema = z.enum(ITEM_SLOTS)
export type ItemSlot = z.infer<typeof ItemSlotSchema>

/** Which slots each wearable category may fill. Other categories have no slot. */
const CATEGORY_SLOTS: Readonly<Record<string, readonly ItemSlot[]>> = {
  clothing: ['top', 'bottom', 'shoes', 'accessory'],
  makeup: ['face'],
}

/** Where a decor item goes in an apartment: a wall, the floor, or a surface (a sill, a shelf). */
export const DECOR_FITS = ['wall', 'floor', 'surface'] as const
export const DecorFitSchema = z.enum(DECOR_FITS)
export type DecorFit = z.infer<typeof DecorFitSchema>

/**
 * A decor item's colour variant (S16): a palette token (never a hex value; theme.json must hold
 * it) and a human colour name in the shared `colors` copy namespace (A11Y-1).
 */
export const DecorVariantSchema = z.strictObject({
  id: IdSchema,
  token: PaletteTokenRefSchema,
  nameKey: CopyKeyRefSchema.refine((key) => key.startsWith('colors.'), {
    error: 'a colour name lives in the colors copy namespace',
  }),
})

/** How many floor cells a decor item covers (S40, src/engine/homeGrid.ts); wall items cover one. */
export const DECOR_FOOTPRINTS = ['1x1', '2x1', '2x2'] as const
/** Buy-mode categories (S40): the catalogue's tabs, in display order. */
export const DECOR_CATEGORIES = [
  'sleep',
  'seating',
  'tables',
  'kitchen',
  'lighting',
  'rugs',
  'plants',
  'storage',
  'fun',
  'wall-art',
] as const
export type DecorCategory = (typeof DECOR_CATEGORIES)[number]

/**
 * What a decor item adds to an apartment (S16, S40): where it goes (a wall cell, or floor cells;
 * a surface item stands on its own small table), how many cells it covers, its buy-mode
 * category, the home score it adds while placed (src/engine/home.ts) and its colour variants.
 * Rugs lie on their own layer under furniture. A luxury item (rare only) costs weekly upkeep
 * (balance.json `home.upkeepPctPerWeek`). A starter piece comes with a new game's home: free,
 * never sold in the shop, worth no home score and never sold back.
 */
export const DecorSchema = z
  .strictObject({
    fits: DecorFitSchema,
    footprint: z.enum(DECOR_FOOTPRINTS).optional(),
    layer: z.literal('rug').optional(),
    category: z.enum(DECOR_CATEGORIES),
    luxury: z.literal(true).optional(),
    starter: z.literal(true).optional(),
    homeScore: z.int().min(0),
    variants: listOf(DecorVariantSchema).min(1),
  })
  .refine((decor) => decor.fits !== 'wall' || (decor.footprint ?? '1x1') === '1x1', {
    error: 'a wall item covers one wall cell',
    path: ['footprint'],
  })
  .refine((decor) => decor.layer === undefined || decor.fits === 'floor', {
    error: 'only floor items lie on the rug layer',
    path: ['layer'],
  })
  .refine((decor) => (decor.starter === true) === (decor.homeScore === 0), {
    error: 'starter pieces add no home score; every other decor item adds some',
    path: ['homeScore'],
  })

/**
 * What a wearable does to the avatar's look (S16a, D12): ids from data/avatar/options.json and
 * catalog model ids, checked in src/lib/data/avatar-data.test.ts. A top changes the outfit (the
 * body model) and its top colour; a bottom or shoes their colour; an accessory adds a model
 * attachment. Makeup has no visual yet (`none`, Q6). A worn item overrides the creator's choice
 * (src/engine/appearance.ts `effectiveLook`).
 */
export const ItemLookSchema = z.discriminatedUnion('part', [
  z.strictObject({ part: z.literal('outfit'), outfit: IdSchema, top: IdSchema }),
  z.strictObject({ part: z.literal('bottom'), color: IdSchema }),
  z.strictObject({ part: z.literal('shoes'), color: IdSchema }),
  z.strictObject({ part: z.literal('attachment'), model: IdSchema }),
  z.strictObject({ part: z.literal('none') }),
])
export type ItemLook = z.infer<typeof ItemLookSchema>

/** The look part each outfit slot's items use. */
export const SLOT_LOOK_PARTS = {
  top: 'outfit',
  bottom: 'bottom',
  shoes: 'shoes',
  accessory: 'attachment',
  face: 'none',
} as const satisfies Readonly<Record<ItemSlot, ItemLook['part']>>

/**
 * An in-game cash item (CLAUDE.md "Two kinds of purchases"). `sellValue` is what the item sells
 * back for on the day it is bought; worn items lose more value per game day owned
 * (balance.json `items`, applied in src/engine/items.ts). It is always below `price`, so a
 * buy/sell loop can only lose cash.
 */
export const ItemSchema = z
  .strictObject({
    id: IdSchema,
    nameKey: CopyKeyRefSchema,
    descriptionKey: CopyKeyRefSchema,
    category: z.enum(['clothing', 'makeup', 'gift', 'decor', 'upgrade']),
    /** Wearables only: the outfit slot the item fills. */
    slot: ItemSlotSchema.optional(),
    rarity: RarityTierSchema,
    currency: z.literal('cash'),
    /** In-game cash, whole dollars (0 only for a starter piece, which is never sold). */
    price: z.int().nonnegative(),
    sellValue: dollars,
    cloutValue: z.int().nonnegative(),
    /** Style points while worn (S13): the outfit's score multiplies clout gains. Gifts: 0. */
    styleValue: z.int().nonnegative(),
    statEffects: z.partialRecord(StatSchema, z.int()),
    /** Decor only (S16): the slot kind, home score and colour variants. */
    decor: DecorSchema.optional(),
    /** Wearables only (S16a): what wearing it does to the avatar's look. */
    look: ItemLookSchema.optional(),
  })
  .refine((item) => item.category !== 'gift' || item.styleValue === 0, {
    error: 'a gift is never worn, so its styleValue must be 0',
    path: ['styleValue'],
  })
  .refine(
    (item) =>
      item.decor?.starter === true
        ? item.price === 0 && item.sellValue === 0
        : item.price > 0 && item.sellValue < item.price,
    {
      error: 'sellValue must be below price (a starter piece is free and sells for 0)',
      path: ['sellValue'],
    },
  )
  .refine((item) => item.decor?.luxury !== true || item.rarity === 'rare', {
    error: 'only rare decor is luxury',
    path: ['decor', 'luxury'],
  })
  .refine(
    (item) => {
      const slots = CATEGORY_SLOTS[item.category]
      return slots === undefined
        ? item.slot === undefined
        : item.slot !== undefined && slots.includes(item.slot)
    },
    {
      error: 'clothing needs a clothing slot, makeup the face slot, others no slot',
      path: ['slot'],
    },
  )
  .refine(
    (item) =>
      item.slot === undefined
        ? item.look === undefined
        : item.look !== undefined && item.look.part === SLOT_LOOK_PARTS[item.slot],
    {
      error: 'every wearable needs a look for its slot, and only wearables have one',
      path: ['look'],
    },
  )
  .refine((item) => (item.category === 'decor') === (item.decor !== undefined), {
    error: 'decor needs a decor block, and only decor has one',
    path: ['decor'],
  })
  .refine(
    (item) =>
      item.category !== 'decor' ||
      (item.cloutValue === 0 &&
        item.styleValue === 0 &&
        Object.keys(item.statEffects).length === 0),
    {
      // Decor adds clout only through the home score (src/engine/home.ts), never as item clout,
      // style or a stat effect.
      error: 'decor has cloutValue 0, styleValue 0 and no stat effects',
      path: ['category'],
    },
  )
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
  // S41: the rest of a Lagos Life-style neighbourhood (errands, care, hangouts, creator spots).
  'barber',
  'salon',
  'food-cart',
  'mall',
  'bank',
  'pharmacy',
  'laundromat',
  'community-center',
  'lounge',
  'studio',
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

/**
 * Where each home sits (S05): the player's start point and avatar position for that home.
 * `borough` and `zoneId` are checked against the S04 geo layers in
 * src/lib/world/homes-content.test.ts. Keyed by every home id, so none can be missing.
 */
export const HomeSchema = z.strictObject({
  borough: BoroughSchema,
  zoneId: IdSchema,
  location: LatLngSchema,
})
export const HomesFileSchema = z.strictObject({ homes: z.record(z.enum(HOME_IDS), HomeSchema) })
export type HomesFile = z.infer<typeof HomesFileSchema>

/**
 * A start neighborhood (S16a, data/homes/neighborhoods.json): where its startable homes sit on
 * the map and the subway station they are near. The creator's roll picks one per save; the
 * player's home point then comes from it (src/engine/neighborhoods.ts `homePoint`). Geo rules
 * (zone, land, station distance, trip fairness) are checked in
 * src/lib/world/neighborhoods-content.test.ts.
 */
export const NeighborhoodSchema = z.strictObject({
  id: IdSchema,
  nameKey: CopyKeyRefSchema.refine((key) => key.startsWith('neighborhoods.')),
  blurbKey: CopyKeyRefSchema.refine((key) => key.startsWith('neighborhoods.')),
  zoneId: IdSchema,
  /** Where the neighborhood's homes stand. */
  home: LatLngSchema,
  /** The nearest subway station's id in data/geo/subway.derived.json. */
  stationId: z.string().min(1),
  /** Startable homes in this neighborhood (S44 adds more). */
  homes: z.array(z.enum(HOME_IDS)).min(1),
})

export const NeighborhoodsFileSchema = z.strictObject({
  version: z.literal(1),
  borough: BoroughSchema,
  /** Every home stands within this walk of its station. */
  maxStationM: z.number().positive(),
  /**
   * Trip fairness: each neighborhood's mean trip by `mode` to the places in `to` is within
   * `tolerancePct` of the mean over all neighborhoods, so no roll is a handicap.
   */
  fairness: z.strictObject({
    tolerancePct: z.int().min(1).max(100),
    mode: z.enum(['walk', 'subway', 'taxi']),
    to: z.array(IdSchema).min(1),
  }),
  neighborhoods: z
    .array(NeighborhoodSchema)
    .min(2)
    .refine((list) => new Set(list.map((n) => n.id)).size === list.length, {
      error: 'neighborhood ids must be unique',
    }),
})
export type NeighborhoodsFile = z.infer<typeof NeighborhoodsFileSchema>
export type Neighborhood = z.infer<typeof NeighborhoodSchema>

/** A point in an apartment, in metres: x right, y up, z toward the camera; 0,0,0 is the floor's centre. */
const RoomPointSchema = z.tuple([z.number(), z.number(), z.number()])
const metres = z.number().positive()
/** A wall of the room: the camera looks in through the open front. */
const RoomWallSchema = z.enum(['back', 'left', 'right'])
const SLOT_ID = /^(?:f\d+-\d+|w-(?:back|left|right)-\d+)$/
/** A grid cell (src/engine/homeGrid.ts): `f{column}-{row}` on the floor, `w-{wall}-{i}` on a wall. */
const SlotIdSchema = z.string().regex(SLOT_ID, 'slot ids are f<c>-<r> or w-<wall>-<i>')
const TurnSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])

/** A window or door: `span` wall cells from cell `at`, from `sillM` up `heightM`. */
const OpeningSchema = z.strictObject({
  kind: z.enum(['window', 'door']),
  wall: RoomWallSchema,
  at: z.int().nonnegative(),
  span: z.int().positive(),
  heightM: metres,
  /** Height of the bottom edge above the floor (0 for a door). */
  sillM: z.number().nonnegative(),
})

/** A built-in piece the home comes with (a kitchen run): a catalog model or a counter, one cell. */
const FixtureSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('model'),
    model: IdSchema,
    slot: SlotIdSchema,
    turn: TurnSchema,
  }),
  z.strictObject({ kind: z.literal('counter'), slot: SlotIdSchema, turn: TurnSchema }),
])

/**
 * One home's interior (S16, S40): its placement grid and ceiling height, windows and door, the
 * camera angle, the avatar's spot, built-in fixtures, the shell's original finishes, and the
 * starter pieces a new game places there. Cell-level rules (fixtures and the avatar inside the
 * grid and apart, openings inside their wall, starter pieces fitting) are checked in
 * src/lib/data/homes-data.test.ts with the engine's grid maths.
 */
export const HomeInteriorSchema = z.strictObject({
  grid: z.strictObject({
    cols: z.int().min(3).max(12),
    rows: z.int().min(3).max(12),
    cellM: metres,
  }),
  heightM: metres,
  openings: z.array(OpeningSchema).min(2),
  /**
   * The camera looks from `position` towards `target` through the open front. The scene keeps
   * that direction and target and moves along it until the room fits the free scene area
   * (src/scene/apartment/fit.ts), so `position` sets the angle, not the distance.
   */
  camera: z.strictObject({
    position: RoomPointSchema,
    target: RoomPointSchema,
    fovDeg: z.number().gt(0).lt(180),
  }),
  avatar: z.strictObject({ slot: SlotIdSchema, rotationDeg: z.number().min(-180).max(180) }),
  fixtures: z.array(FixtureSchema),
  shell: z.strictObject({
    /** Finish ids (data/homes/finishes.json): what the home has before any paint or floor is bought. */
    wallPaint: IdSchema,
    floorFinish: IdSchema,
    /** Crown moulding along the wall tops: the nicer tiers. */
    crown: z.boolean(),
    /** A wall finish only the back wall shows (the loft's exposed brick), or null. */
    accentBack: IdSchema.nullable(),
  }),
  starter: z.array(z.strictObject({ itemId: IdSchema, slot: SlotIdSchema, turn: TurnSchema })),
})
export type HomeInterior = z.infer<typeof HomeInteriorSchema>

/**
 * A wall paint or floor finish (S40, data/homes/finishes.json): bought once with in-game cash,
 * tried on for free first; colours are world palette tokens (theme.json), drawn as `pattern`.
 */
export const FinishSchema = z
  .strictObject({
    id: IdSchema,
    kind: z.enum(['wall', 'floor']),
    pattern: z.enum(['solid', 'checker', 'planks', 'herringbone', 'brick']),
    tokens: z.array(PaletteTokenRefSchema).min(1).max(2),
    price: z.int().positive(),
    nameKey: CopyKeyRefSchema,
  })
  .refine((finish) => finish.pattern === 'solid' || finish.tokens.length === 2, {
    error: 'a patterned finish needs two colours',
    path: ['tokens'],
  })
export const FinishesFileSchema = z.strictObject({ finishes: listOf(FinishSchema).min(2) })
export type Finish = z.infer<typeof FinishSchema>

/** data/homes/engine.derived.json (S40): src/lib/data/homesDerive.ts `deriveHomeEngineTables`. */
export const HomeEngineTablesSchema = z.strictObject({
  homes: z.strictObject(
    Object.fromEntries(
      HOME_IDS.map((id) => [
        id,
        z.strictObject({
          cols: z.int().positive(),
          rows: z.int().positive(),
          cellM: metres,
          blocked: z.array(SlotIdSchema),
          walkway: z.array(SlotIdSchema),
          starter: z.array(
            z.strictObject({ itemId: IdSchema, slot: SlotIdSchema, turn: TurnSchema }),
          ),
          wallPaint: IdSchema,
          floorFinish: IdSchema,
        }),
      ]),
    ) as unknown as Record<(typeof HOME_IDS)[number], z.ZodType>,
  ),
  finishes: z.array(
    z.strictObject({
      id: IdSchema,
      kind: z.enum(['wall', 'floor']),
      price: z.int().positive(),
      nameKey: CopyKeyRefSchema,
    }),
  ),
})

/** data/homes/interiors.json: every home's interior, keyed by home id (none can be missing). */
export const HomeInteriorsFileSchema = z.strictObject({
  homes: z.strictObject(
    Object.fromEntries(HOME_IDS.map((id) => [id, HomeInteriorSchema])) as Record<
      (typeof HOME_IDS)[number],
      typeof HomeInteriorSchema
    >,
  ),
})
export type HomeInteriorsFile = z.infer<typeof HomeInteriorsFileSchema>

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

/**
 * Events (S14): data-driven moments with conditions, a weight and two or three choices.
 * The engine (src/engine/events.ts) picks among the eligible ones with a seeded random source.
 *
 * Safety rules (CLAUDE.md "Map and landmarks", "Safety rules") are enforced twice: here, so no
 * event can even name a memorial or put a crime event at a government building, and again in
 * the engine, which refuses every event at a memorial and every crime event at a government
 * building whatever the data says.
 */
export const EVENT_TAGS = [
  'transit',
  'money',
  'food',
  'nightlife',
  'social',
  'landmark',
  'weather',
  'home',
  'crime',
] as const
export const EventTagSchema = z.enum(EVENT_TAGS)
export type EventTag = z.infer<typeof EventTagSchema>

/** Where an event may happen: a landmark category or a venue type. Memorials are never valid. */
export const EventLocationCategorySchema = z.union([
  z.enum(LANDMARK_CATEGORIES).exclude(['memorial']),
  z.enum(VENUE_TYPES),
])
/** Every place category the engine can be told the player is at, memorials included. */
export type LocationCategory = Landmark['category'] | Venue['type']

/**
 * data/places/icons.json (S04k): each place category's icon group, drawn on its map pin and
 * beside it in the Places list. Every venue type and landmark category maps to a group; `home`
 * is the player's home row. The icon is decorative (emoji, aria-hidden); the group's label is a
 * copy key, checked in src/lib/data/data.test.ts.
 */
export const PLACE_ICON_GROUPS = [
  'job',
  'food',
  'coffee',
  'nightlife',
  'shop',
  'gym',
  'park',
  'transit',
  'landmark',
  'skyline',
  'bridge',
  'stadium',
  'neighborhood',
  'memorial',
  'barber',
  'beauty',
  'mall',
  'bank',
  'pharmacy',
  'laundry',
  'community',
  'lounge',
  'studio',
  'home',
] as const
export type PlaceIconGroup = (typeof PLACE_ICON_GROUPS)[number]

/**
 * data/items/looks.json (S04k): the shop's thumbnail size for the offline renders (npm run
 * thumbs) and each item's icon, shown when it has no rendered thumbnail. Every item has one
 * (checked in src/lib/data/data.test.ts).
 */
export const ItemLooksFileSchema = z.strictObject({
  thumbs: z.strictObject({ sizePx: z.int().min(32).max(512) }),
  icons: z.record(IdSchema, z.string().min(1).max(16)),
})

/** data/items/thumbs.derived.json (npm run thumbs): item id → content-named thumbnail URL. */
export const ItemThumbsFileSchema = z.record(
  IdSchema,
  z.string().regex(/^\/thumbs\/[a-z0-9-]+\.[0-9a-f]{8}\.webp$/),
)

export const PlaceIconsConfigSchema = z.strictObject({
  groups: z.record(
    z.enum(PLACE_ICON_GROUPS),
    z.strictObject({ icon: z.string().min(1).max(16), labelKey: z.string().min(1) }),
  ),
  categories: z.record(
    z.union([z.enum(VENUE_TYPES), z.enum(LANDMARK_CATEGORIES)]),
    z.enum(PLACE_ICON_GROUPS),
  ),
})
export type PlaceIconsConfig = z.infer<typeof PlaceIconsConfigSchema>

const statPoints = z.int().nonnegative()

/** An inclusive range; at least one bound, and min <= max. */
function rangeOf(value: z.ZodInt) {
  return z
    .strictObject({ min: value.optional(), max: value.optional() })
    .refine((range) => range.min !== undefined || range.max !== undefined, {
      error: 'a range needs min or max',
    })
    .refine(
      (range) => range.min === undefined || range.max === undefined || range.min <= range.max,
      { error: 'min must not exceed max' },
    )
}

/**
 * All present conditions must hold. Within a list, any entry matches. `locationIds` and
 * `locationCategories` together describe one "where": the player must be at a listed place
 * or at a place of a listed category.
 */
export const EventConditionsSchema = z.strictObject({
  /** Personal-clock hour window [from, to); wraps past midnight when from > to. */
  hours: z
    .strictObject({ from: z.int().min(0).max(23), to: z.int().min(0).max(23) })
    .refine((window) => window.from !== window.to, {
      error: 'an empty window: omit hours for all day',
    })
    .optional(),
  /** Earliest game day (1-based) the event can fire. */
  minDay: z.int().positive().optional(),
  boroughs: z.array(BoroughSchema).min(1).optional(),
  /** Landmark or venue ids. */
  locationIds: z.array(IdSchema).min(1).optional(),
  locationCategories: z.array(EventLocationCategorySchema).min(1).optional(),
  stats: z.partialRecord(StatSchema, rangeOf(statPoints)).optional(),
  /** Whole dollars on hand. */
  cash: rangeOf(z.int().nonnegative()).optional(),
  /** Clout points (S13). */
  clout: rangeOf(z.int().nonnegative()).optional(),
  /** Item ids (S10): owns at least one of `anyOf`, none of `noneOf`. */
  items: z
    .strictObject({
      anyOf: z.array(IdSchema).min(1).optional(),
      noneOf: z.array(IdSchema).min(1).optional(),
    })
    .optional(),
})
export type EventConditions = z.infer<typeof EventConditionsSchema>

const nonZero = z.int().refine((amount) => amount !== 0, { error: 'amount must not be 0' })

/**
 * What a choice does. Cash, stats and time apply now through the engine. Clout (S13) and items
 * (S10) are recorded as typed pending effects in the save until those systems consume them.
 * There is deliberately no effect that involves drinking.
 */
export const EventEffectSchema = z.discriminatedUnion('kind', [
  /** Whole dollars; negative is a cost the player must be able to pay. */
  z.strictObject({ kind: z.literal('cash'), amount: nonZero }),
  z.strictObject({ kind: z.literal('stat'), stat: StatSchema, amount: nonZero }),
  /** Game minutes the personal clock fast-forwards. */
  z.strictObject({ kind: z.literal('time'), minutes: z.int().positive() }),
  z.strictObject({ kind: z.literal('clout'), amount: nonZero }),
  z.strictObject({ kind: z.literal('item'), itemId: IdSchema, op: z.enum(['grant', 'consume']) }),
])
export type EventEffect = z.infer<typeof EventEffectSchema>

export const EventChoiceSchema = z.strictObject({
  id: IdSchema,
  /** Button text: plain and clear. */
  labelKey: CopyKeyRefSchema,
  /** What happened, shown after the choice. */
  resultKey: CopyKeyRefSchema,
  effects: z.array(EventEffectSchema),
})
export type EventChoice = z.infer<typeof EventChoiceSchema>

/** Net whole dollars a choice takes (0 when free). Mirrors `choiceCashCost` in src/engine/events.ts. */
function choiceCashCost(choice: Pick<EventChoice, 'effects'>): number {
  const net = choice.effects.reduce(
    (sum, effect) => (effect.kind === 'cash' ? sum + effect.amount : sum),
    0,
  )
  return Math.max(0, -net)
}

export const EventSchema = z
  .strictObject({
    id: IdSchema,
    titleKey: CopyKeyRefSchema,
    bodyKey: CopyKeyRefSchema,
    tags: z.array(EventTagSchema).min(1),
    /** Relative chance among the events eligible at the same moment. */
    weight: z.int().positive(),
    /** Game minutes before it can fire again; defaults to balance `events.defaultCooldownMin`. */
    cooldownMin: z.int().nonnegative().optional(),
    /** Fires at most once per save. */
    once: z.boolean().optional(),
    conditions: EventConditionsSchema,
    choices: listOf(EventChoiceSchema).min(2).max(3),
  })
  .refine((event) => event.choices.some((choice) => choiceCashCost(choice) === 0), {
    error: 'every event needs a choice that costs no cash, so a broke player is never stuck',
    path: ['choices'],
  })
  .refine(
    (event) =>
      !event.tags.includes('crime') ||
      !(event.conditions.locationCategories ?? []).includes('government'),
    {
      error: 'no crime events at government buildings',
      path: ['conditions', 'locationCategories'],
    },
  )
export const EventsFileSchema = z.strictObject({ events: listOf(EventSchema) })
export type GameEvent = z.infer<typeof EventSchema>
