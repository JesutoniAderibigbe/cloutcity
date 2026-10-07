/**
 * Schemas for /data/config. This file imports only `zod` and dependency-free modules by relative
 * `.ts` paths (no path aliases) so Node can load it directly from `scripts/` with its built-in
 * type stripping.
 */
import { z } from 'zod'
import { STYLED_SOURCES } from '../cloutSources.ts'
import { BUILDING_DISTRICT_IDS } from '../../geo/sources.ts'
import { distanceM, project } from '../../geo/projection.ts'
import { HOME_IDS, lowestRentHome } from '../homes.ts'

export const QUALITY_TIERS = ['low', 'mid', 'high'] as const
export const QualityTierSchema = z.enum(QUALITY_TIERS)
export type QualityTier = z.infer<typeof QualityTierSchema>

const positive = z.number().positive()
const positiveInt = z.int().positive()

/** One value per quality tier. Rows that CLAUDE.md marks "same" for every tier are scalars. */
function perTier<T extends z.ZodType>(value: T) {
  return z.strictObject({ low: value, mid: value, high: value })
}

/** Throttle profile for `npm run e2e:perf`. */
export const ThrottleProfileSchema = z.strictObject({
  downloadKbps: positive,
  uploadKbps: positive,
  rttMs: z.number().nonnegative(),
  cpuSlowdown: z.number().min(1),
  viewport: z.strictObject({ width: positiveInt, height: positiveInt }),
})

/**
 * Every row of CLAUDE.md "Performance budgets". Sizes are gzipped KB (1 KB = 1000 bytes, so
 * 1.2 MB = 1200 KB); times are milliseconds.
 */
export const PerfConfigSchema = z.strictObject({
  /** Shell JS of route `/`, before the 3D chunk. Read by `npm run budget`. */
  shellJsGzKB: positive,
  /**
   * Room the shell keeps below `shellJsGzKB` for features still to land (S05c): the shell may
   * use at most shellJsGzKB minus this. Read by scripts/shell-guard.ts.
   */
  shellHeadroomGzKB: z.number().nonnegative(),
  sceneChunkJsGzKB: positive,
  totalJsToPlayableGzKB: positive,
  baseGeoGzKB: positive,
  districtBuildingsGzKB: perTier(positive),
  /** Audio excluded: it loads after the player's choice. */
  totalBytesToPlayableGzKB: perTier(positive),
  shellInteractiveColdMs: positive,
  playableColdMs: perTier(positive),
  playableWarmMs: positive,
  /** `renderer.info.render.calls` at the default Queens-start camera. */
  drawCallsMax: perTier(positiveInt),
  trianglesMax: perTier(positiveInt),
  dprCap: perTier(positive),
  /** `pcf-directional` means one directional light with PCFShadowMap, never PCFSoftShadowMap. */
  shadows: perTier(z.enum(['none', 'blob-or-baked', 'pcf-directional'])),
  otherPlayersMax: perTier(z.int().nonnegative()),
  otherPlayersStyle: perTier(z.enum(['billboard', 'model'])),
  /** Real reference device only (human/qa check); headless CI cannot measure FPS. */
  medianFpsMin: perTier(positive),
  /** Idle renders zero frames (`frameloop="demand"`). */
  idleFramesMax: z.literal(0),
  /** Step down one tier when average FPS stays below `belowFps` for `sustainMs`. */
  fpsStepDown: z.strictObject({ belowFps: positive, sustainMs: positive }),
  throttleProfiles: z.strictObject({ 'cc-mid-4g': ThrottleProfileSchema }),
  /**
   * Audio fetched after the player's sound choice, per tier: the first music track, the ambience
   * loop and (where the tier preloads them) the sound effects, in one encoding. Audio is not part
   * of `totalBytesToPlayableGzKB`.
   */
  audioLazyGzKB: perTier(positive),
  /** Largest single audio file. */
  audioFileMaxKB: positive,
  /** The lazily loaded audio runtime chunk (src/lib/audio/runtime.ts). */
  audioRuntimeJsGzKB: positive,
  /**
   * Triangles of every district's building masses plus the procedural blocks, per tier, as the
   * geo build counts them (TUNE-7 placeholders). Part of `trianglesMax`, not on top of it.
   */
  buildingTrianglesMax: perTier(positiveInt),
})
export type PerfConfig = z.infer<typeof PerfConfigSchema>

const HEX_COLOR = /^#[0-9a-f]{6}$/i
const TOKEN_NAME = /^[a-z]+-\d{2,3}$/

/** Palette tokens. Each becomes the Tailwind colour `--color-<token>` (see globals.css). */
export const ThemeConfigSchema = z
  .strictObject({
    colors: z.record(z.string().regex(TOKEN_NAME), z.string().regex(HEX_COLOR)),
    /** Token used for the browser/PWA theme colour and the page background. */
    themeColor: z.string(),
  })
  .refine((theme) => theme.themeColor in theme.colors, {
    error: 'themeColor must name a token in colors',
    path: ['themeColor'],
  })
export type ThemeConfig = z.infer<typeof ThemeConfigSchema>

const RateLimitSchema = z.strictObject({ max: positiveInt, windowMs: positiveInt })

export const RealtimeConfigSchema = z.strictObject({
  shardSize: positiveInt,
  maxFriendFanout: positiveInt,
  heartbeatIntervalMs: positiveInt,
  /** Minimum time between two accepted `move` calls from one player. */
  moveMinIntervalMs: positiveInt,
  emoteRateLimit: RateLimitSchema,
  /** Cost guard for S35's load simulation. */
  budgetMsgsPerPlayerMinute: positive,
})
export type RealtimeConfig = z.infer<typeof RealtimeConfigSchema>

export const ModerationConfigSchema = z.strictObject({
  /** Content auto-hides, pending review, after this many distinct reporters. */
  autoHideReports: positiveInt,
})
export type ModerationConfig = z.infer<typeof ModerationConfigSchema>

const dollars = z.int().nonnegative()
/** Whole percent, 0..99: resale is always worth less than the price. */
const percent = z.int().min(0).max(99)
const MinMaxSchema = z
  .strictObject({ min: dollars, max: dollars })
  .refine((range) => range.min <= range.max, { error: 'min must not exceed max' })

export const RARITY_TIERS = ['common', 'medium', 'rare'] as const
export const RarityTierSchema = z.enum(RARITY_TIERS)
export type RarityTier = z.infer<typeof RarityTierSchema>

export { HOME_IDS }
export const JOB_IDS = ['barista', 'retail', 'delivery', 'junior-dev'] as const

/** Player needs, 0..stats.max. Hunger is fullness: high is fed, 0 is starving. */
export const STAT_KEYS = ['energy', 'hunger', 'mood'] as const
export type StatKey = (typeof STAT_KEYS)[number]

const statPoints = z.int().nonnegative()
const StatsRecordSchema = z.strictObject({
  energy: statPoints,
  hunger: statPoints,
  mood: statPoints,
})
function PartialStatsSchema<T extends z.ZodType<number>>(value: T) {
  return z.strictObject({
    energy: value.optional(),
    hunger: value.optional(),
    mood: value.optional(),
  })
}

/** What happens each game hour a stat sits at zero. */
const AtZeroSchema = z.strictObject({
  /** Extra points drained from the other stats per game hour. */
  extraDecayPerGameHour: PartialStatsSchema(statPoints),
  /** Action durations are multiplied by this (rounded up); multipliers of several zero stats stack. */
  durationMultiplier: z.number().min(1),
})

/** One action: what it costs up front and what it changes once its time has passed. */
export const ActionDefSchema = z.strictObject({
  /** Game minutes the personal clock fast-forwards. */
  durationMin: z.int().nonnegative(),
  cashCost: dollars,
  energyCost: statPoints,
  /** Points added (or removed, if negative) when the action finishes. */
  statEffects: PartialStatsSchema(z.int()),
})
export type ActionDef = z.infer<typeof ActionDefSchema>

/**
 * Who may enter a borough: always (`open`), from a clout level (`clout`, a `clout.levels` id),
 * or nobody yet (`expanding-soon`, shown as dimmed teaser land).
 */
export const BoroughAccessRuleSchema = z.discriminatedUnion('access', [
  z.strictObject({ access: z.literal('open') }),
  z.strictObject({ access: z.literal('clout'), level: z.string() }),
  z.strictObject({ access: z.literal('expanding-soon') }),
])
export type BoroughAccessRule = z.infer<typeof BoroughAccessRuleSchema>

const MINUTES_PER_DAY_MAX = 24 * 60
const LatLngSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
})
const probability = z.number().min(0).max(1)

/** A daily window of the personal clock, [startMin, endMin) minutes after midnight. */
const DayWindowSchema = z
  .strictObject({
    startMin: z.int().nonnegative().max(MINUTES_PER_DAY_MAX),
    endMin: z.int().nonnegative().max(MINUTES_PER_DAY_MAX),
  })
  .refine((window) => window.startMin < window.endMin, { error: 'startMin must be before endMin' })

/**
 * Walk, subway and taxi (S08, src/engine/transit). Distances are local metres from the shared
 * projection; times are game minutes. The subway fare itself is `costs.subwayFare`.
 */
export const TransitConfigSchema = z.strictObject({
  /** Shorter trips are refused: the player is already there. */
  minTripM: positive,
  /**
   * A trip end off land (a bridge's midspan, a pier) moves to the nearest land within this many
   * metres; further out it is unreachable.
   */
  snapToLandM: z.number().nonnegative(),
  walk: z.strictObject({
    speedKmh: positive,
    /** Street distance over straight-line distance (the grid is not a straight line). */
    detourFactor: z.number().min(1),
    /** Energy points drained per km walked (also on the subway's walking legs). */
    energyPerKm: z.number().nonnegative(),
    /** A walk whose straight line leaves land for longer than this in one stretch is refused. */
    maxWaterM: z.number().nonnegative(),
  }),
  taxi: z.strictObject({
    speedKmh: positive,
    detourFactor: z.number().min(1),
    /** Wait for the pickup, game minutes. */
    pickupMin: z.number().nonnegative(),
    /** Flag drop, whole dollars. */
    baseFare: dollars,
    /** Dollars per km driven; the total fare rounds up to whole dollars. */
    perKm: z.number().nonnegative(),
    /** A drive leaving land for longer than this in one stretch must use a crossing instead. */
    maxWaterM: z.number().nonnegative(),
  }),
  /**
   * Bridges and vehicle tunnels the taxi may use across water: one point on land at each end.
   * Ids are data only (never rendered by S08).
   */
  crossings: z.array(
    z.strictObject({ id: z.string().regex(/^[a-z0-9-]+$/), a: LatLngSchema, b: LatLngSchema }),
  ),
  /** Points on land a taxi may also drive through, so a drive can bend around a bay. */
  roadWaypoints: z.array(
    z.strictObject({ id: z.string().regex(/^[a-z0-9-]+$/), at: LatLngSchema }),
  ),
  subway: z.strictObject({
    /** In-vehicle speed along the line path. */
    speedKmh: positive,
    /** Extra minutes per stop the train makes. */
    dwellMinPerStop: z.number().nonnegative(),
    /** Wait on the platform before the first train. */
    boardWaitMin: z.number().nonnegative(),
    /** Minutes added for each change of line (walk inside the station and wait). */
    transferPenaltyMin: z.number().nonnegative(),
    /** Separate stations this close are linked by a walking transfer. */
    transferWalkMaxM: z.number().nonnegative(),
    /** How many of the nearest stations to each end are tried as entry and exit. */
    accessCandidates: positiveInt,
    /** Stations further than this are not tried, except the single nearest one. */
    accessMaxM: positive,
    /** Stations further than this from every path of a line they list are not on it. */
    stationSnapM: positive,
    /**
     * Consecutive stretches of track drawn for one ride may be this far apart; further apart (a
     * change between two paths of the line), the drawn path goes through the station.
     */
    pathJoinM: z.number().nonnegative(),
  }),
  rushHour: z.strictObject({
    /** By personal clock time of departure. */
    windows: z.array(DayWindowSchema).min(1),
    /** In-vehicle and dwell time are multiplied by this in rush hour. */
    subwayDurationMultiplier: z.number().min(1),
    /** Mood points drained by a subway trip that departs in rush hour. */
    subwayMoodDrain: z.int().nonnegative(),
    /** Taxi driving time is multiplied by this in rush hour (no mood drain). */
    taxiDurationMultiplier: z.number().min(1),
  }),
  /** Random delay on subway trips; the roll uses the injected seeded random source. */
  delay: z.strictObject({
    probability,
    rushProbability: probability,
    minutes: z
      .strictObject({ min: z.int().nonnegative(), max: z.int().nonnegative() })
      .refine((range) => range.min <= range.max, { error: 'min must not exceed max' }),
    moodDrain: z.int().nonnegative(),
  }),
  animation: z.strictObject({
    /** Longest the travel animation may run, real milliseconds. */
    maxMs: z.int().nonnegative(),
    /** Real milliseconds of animation per game minute of travel, before the cap. */
    msPerGameMinute: z.number().nonnegative(),
  }),
})
export type TransitConfig = z.infer<typeof TransitConfigSchema>

const KEBAB_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const COPY_KEY = /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+$/

/**
 * A club's door and what a night inside does (S09). The door refuses anyone below
 * `minCloutLevel` (a `clout.levels` id) with the in-voice `refusalKey` copy; inside, the cover
 * is paid up front, the night lasts `durationMin` and ends with `moodGain` and `cloutGain`.
 */
export const ClubRuleSchema = z.strictObject({
  coverCharge: dollars,
  minCloutLevel: z.string().regex(KEBAB_ID),
  refusalKey: z.string().regex(COPY_KEY),
  durationMin: positiveInt,
  energyCost: statPoints,
  // Positive so a repeat entry (no clout) still says what the night gave.
  moodGain: positiveInt,
  cloutGain: positiveInt,
})
export type ClubRule = z.infer<typeof ClubRuleSchema>

/**
 * What a player can do at a place (S09, src/engine/placeActions.ts). Ids of venues, venue
 * types and landmarks are checked against data/venues and data/landmarks in
 * src/lib/world/placeActions-content.test.ts (this file cannot import the content schemas).
 */
export const PlaceConfigSchema = z.strictObject({
  /**
   * Actions offered at each venue type, by id: a key of `actions.catalog` or of `actions`
   * below. Shifts come from a venue's `jobIds` and the club night from `clubs`, not from here.
   */
  venueActions: z.record(z.string().regex(KEBAB_ID), z.array(z.string().regex(KEBAB_ID))),
  /** Actions only places offer (a coffee, a meal out), shaped like `actions.catalog`. */
  actions: z.record(z.string().regex(KEBAB_ID), ActionDefSchema),
  /** Door and night rules for every club venue, by venue id. */
  clubs: z.record(z.string().regex(KEBAB_ID), ClubRuleSchema),
  /** The Visit action at any landmark that allows `visit` (never a memorial). */
  visit: z.strictObject({
    durationMin: positiveInt,
    energyCost: statPoints,
    moodGain: positiveInt,
  }),
  /**
   * How much a flex at a landmark counts (read by S13), by landmark id; others get `default`.
   * Landmarks that do not allow `flex` (memorials included) have no multiplier at all.
   */
  flexMultiplier: z.strictObject({
    default: positive,
    byLandmark: z.record(z.string().regex(KEBAB_ID), positive),
  }),
})
export type PlaceConfig = z.infer<typeof PlaceConfigSchema>

/**
 * Clout (S13, src/engine/clout.ts): levels, how flexing and style work, the ledger and the
 * premium cap. Venue types in `flex.venueTypes` are checked against the content schema in
 * src/lib/world/placeActions-content.test.ts (this file cannot import the content schemas).
 */
export const CloutConfigSchema = z
  .strictObject({
    /** Lowest first. A player is at the highest level whose `minClout` they hold. */
    levels: z
      .array(
        z.strictObject({
          id: z.string().regex(KEBAB_ID),
          minClout: z.int().nonnegative(),
        }),
      )
      .min(1),
    /** One-off gains: the first paycheck ever earned. */
    sources: z.strictObject({ firstPaycheck: positiveInt }),
    /**
     * The Flex action: at a landmark that allows it (its `place.flexMultiplier`) or a venue of
     * one of `venueTypes` (the default multiplier; never `club`). Once per place per game day, at most
     * `maxPerGameDay` a day. A flex goes viral when one seeded draw falls below
     * min(maxChance, (baseChance + style score * perStylePoint) * place multiplier); a viral
     * flex earns `baseClout * cloutMultiplier`.
     */
    flex: z.strictObject({
      durationMin: positiveInt,
      energyCost: statPoints,
      cashCost: dollars,
      baseClout: positiveInt,
      maxPerGameDay: positiveInt,
      venueTypes: z.array(z.string().regex(KEBAB_ID)),
      viral: z.strictObject({
        baseChance: probability,
        perStylePoint: probability,
        maxChance: probability,
        cloutMultiplier: z.int().min(1),
      }),
    }),
    /**
     * The outfit's style score (the `styleValue` of every worn item) multiplies positive gains
     * from `appliesTo` by 100 + min(maxBonusPct, score * pctPerPoint) percent. `club` cannot be
     * listed (STYLED_SOURCES): club clout is exactly the configured value.
     */
    style: z.strictObject({
      pctPerPoint: z.int().nonnegative(),
      maxBonusPct: z.int().nonnegative(),
      appliesTo: z.array(z.enum(STYLED_SOURCES)),
    }),
    /** Entries kept one by one; older ones fold into per-source totals. */
    ledger: z.strictObject({ maxEntries: positiveInt }),
    /** The most clout a currency other than in-game cash can add (premium items: `usd`). */
    caps: z.strictObject({ byCurrency: z.strictObject({ usd: z.int().nonnegative() }) }),
  })
  .refine(
    ({ levels }) =>
      levels[0]?.minClout === 0 &&
      levels.every((level, i) => i === 0 || level.minClout > (levels[i - 1]?.minClout ?? 0)) &&
      new Set(levels.map((level) => level.id)).size === levels.length,
    { error: 'clout.levels must start at 0, rise strictly and have unique ids', path: ['levels'] },
  )
  .refine(({ levels, caps }) => caps.byCurrency.usd < (levels.at(-1)?.minClout ?? 0), {
    error:
      'caps.byCurrency.usd must stay below the top level, so premium clout alone never reaches it',
    path: ['caps', 'byCurrency', 'usd'],
  })
  .refine(({ style }) => new Set(style.appliesTo).size === style.appliesTo.length, {
    error: 'style.appliesTo must not repeat a source',
    path: ['style', 'appliesTo'],
  })
  .refine(({ flex }) => !flex.venueTypes.includes('club'), {
    // Nightlife is flavour only: a club pays its configured clout and nothing more.
    error: 'flex.venueTypes must not include club',
    path: ['flex', 'venueTypes'],
  })
  .refine(({ flex }) => flex.viral.baseChance <= flex.viral.maxChance, {
    error: 'flex.viral.baseChance must not exceed maxChance',
    path: ['flex', 'viral'],
  })
export type CloutConfig = z.infer<typeof CloutConfigSchema>

/** CLAUDE.md "Balance anchors". Money is whole in-game dollars. */
export const BalanceConfigSchema = z
  .strictObject({
    time: z.strictObject({
      gameMinutesPerRealMinute: positive,
      gameDayHours: positiveInt,
      rentPeriodGameDays: positiveInt,
      /** The personal clock starts on day 1 at this minute of the day. */
      startMinuteOfDay: z.int().nonnegative(),
      /** Passive clock speed multipliers the player can toggle between; 1 must be first. */
      speeds: z.array(positiveInt).min(1),
      /** Longest real gap one tick may count, so a stalled or sleeping tab cannot skip time. */
      maxTickRealMs: positiveInt,
      /** How often the client clock driver ticks the store. */
      tickIntervalMs: positiveInt,
    }),
    start: z.strictObject({ cash: dollars, home: z.enum(HOME_IDS) }),
    stats: z.strictObject({
      max: positiveInt,
      start: StatsRecordSchema,
      decayPerGameHour: StatsRecordSchema,
      atZero: z.strictObject({ energy: AtZeroSchema, hunger: AtZeroSchema, mood: AtZeroSchema }),
    }),
    actions: z.strictObject({
      /** Longest duration any one action may have, in game minutes. */
      maxDurationMin: positiveInt,
      catalog: z.record(z.string().regex(/^[a-z0-9-]+$/), ActionDefSchema),
    }),
    rentPerWeek: z.strictObject({
      'queens-room': dollars,
      'brooklyn-1br': dollars,
      'manhattan-loft': dollars,
    }),
    jobs: z.strictObject({
      shiftHours: positive,
      hourlyWage: z.strictObject({
        barista: dollars,
        retail: dollars,
        delivery: dollars,
        'junior-dev': dollars,
      }),
      /** Energy points paid up front for one shift (passive decay during the shift is extra). */
      energyCostPerShift: z.strictObject({
        barista: statPoints,
        retail: statPoints,
        delivery: statPoints,
        'junior-dev': statPoints,
      }),
      /** Jobs locked until the player reaches a clout level (an id in `clout.levels`). */
      requiredCloutLevel: z.partialRecord(z.enum(JOB_IDS), z.string()),
    }),
    /**
     * Moving home (S12 measures it, S16 spends it). `moveInCost` is the whole dollars a player
     * needs on top of their rent reserve (rent owed plus this week's rent) to move into a home.
     * Every home except the lowest-rent one has a cost; the lowest-rent home (where an eviction
     * lands; on a tie, the first in HOME_IDS, as the engine's cheapestHome) has none.
     */
    housing: z.strictObject({
      moveInCost: z.partialRecord(z.enum(HOME_IDS), dollars),
    }),
    /**
     * Missed rent. Each consecutive due date the player cannot pay in full adds that week's
     * rent to what they owe, plus `lateFees[missed - 1]` (0 is a warning). On the
     * `evictAfterMissed`-th miss the player is evicted to the lowest-rent home.
     */
    rent: z.strictObject({
      lateFees: z.array(dollars),
      evictAfterMissed: positiveInt,
    }),
    /** Clout (S13, src/engine/clout.ts). Every number here is a TUNE-4 placeholder. */
    clout: CloutConfigSchema,
    costs: z.strictObject({ food: MinMaxSchema, subwayFare: dollars }),
    transit: TransitConfigSchema,
    target: z.strictObject({
      shiftsPerDay: positive,
      weeklySavings: dollars,
      firstUpgradeGameDay: MinMaxSchema,
    }),
    /**
     * Shop and resale (S10). Integer percentages keep the money maths exact.
     * - An item's `sellValue` in data/items is floor(price * resalePct[rarity] / 100).
     * - A wearable sells for floor(sellValue * max(minResalePct, 100 - days owned *
     *   depreciationPctPerGameDay) / 100), counting whole game days since it was bought.
     *   Gifts do not age: they sell for their `sellValue`.
     * - A player holds at most `maxGiftStack` of each gift.
     */
    items: z.strictObject({
      resalePct: z.strictObject({ common: percent, medium: percent, rare: percent }),
      depreciationPctPerGameDay: percent,
      minResalePct: percent,
      maxGiftStack: positiveInt,
    }),
    events: z.strictObject({
      /** Chance (0..1) that a roll fires an event when one is eligible. */
      rollChance: z.number().min(0).max(1),
      /** Game minutes before an event can fire again, unless the event sets its own. */
      defaultCooldownMin: z.int().nonnegative(),
      /** Clout and item effects kept in the save until S13 and S10 consume them. */
      maxPendingEffects: positiveInt,
    }),
    rarityTiers: z.array(RarityTierSchema).length(RARITY_TIERS.length),
    /** Placeholder USD prices (whole dollars) until a human sets them. */
    premiumPriceTiersUsd: z.record(z.string().regex(/^tier-\d+$/), z.int().positive()),
    /** Borough gating, keyed by borough id (the ids of BOROUGHS in schemas/content.ts). */
    boroughs: z.strictObject({
      queens: BoroughAccessRuleSchema,
      brooklyn: BoroughAccessRuleSchema,
      manhattan: BoroughAccessRuleSchema,
      bronx: BoroughAccessRuleSchema,
      'staten-island': BoroughAccessRuleSchema,
    }),
    /** Place actions, club doors, landmark visits and flex multipliers (S09). */
    place: PlaceConfigSchema,
  })
  .refine((balance) => new Set(balance.rarityTiers).size === RARITY_TIERS.length, {
    error: 'rarityTiers must list each tier once',
    path: ['rarityTiers'],
  })
  .refine((balance) => balance.time.speeds[0] === 1, {
    error: 'speeds must start with 1x',
    path: ['time', 'speeds'],
  })
  .refine((balance) => new Set(balance.time.speeds).size === balance.time.speeds.length, {
    error: 'speeds must not repeat',
    path: ['time', 'speeds'],
  })
  .refine((balance) => balance.time.startMinuteOfDay < balance.time.gameDayHours * 60, {
    error: 'startMinuteOfDay must fall inside one game day',
    path: ['time', 'startMinuteOfDay'],
  })
  .refine(
    (balance) =>
      STAT_KEYS.every((key) => balance.stats.start[key] <= balance.stats.max) &&
      STAT_KEYS.every((key) => balance.stats.decayPerGameHour[key] <= balance.stats.max),
    { error: 'start stats and decay must not exceed stats.max', path: ['stats'] },
  )
  .refine(
    (balance) =>
      Object.values(balance.actions.catalog).every(
        (action) =>
          action.durationMin <= balance.actions.maxDurationMin &&
          action.energyCost <= balance.stats.max &&
          STAT_KEYS.every((key) => Math.abs(action.statEffects[key] ?? 0) <= balance.stats.max),
      ),
    { error: 'an action exceeds maxDurationMin or stats.max', path: ['actions', 'catalog'] },
  )
  .refine(
    (balance) =>
      Number.isInteger(balance.jobs.shiftHours * 60) &&
      balance.jobs.shiftHours * 60 <= balance.actions.maxDurationMin &&
      JOB_IDS.every((id) =>
        Number.isInteger(balance.jobs.hourlyWage[id] * balance.jobs.shiftHours),
      ),
    {
      error: 'a shift must be whole game minutes within maxDurationMin and pay whole dollars',
      path: ['jobs', 'shiftHours'],
    },
  )
  .refine(
    (balance) => JOB_IDS.every((id) => balance.jobs.energyCostPerShift[id] <= balance.stats.max),
    {
      error: 'a shift energy cost exceeds stats.max',
      path: ['jobs', 'energyCostPerShift'],
    },
  )
  .refine(
    (balance) =>
      Object.values(balance.jobs.requiredCloutLevel).every((level) =>
        balance.clout.levels.some((entry) => entry.id === level),
      ),
    {
      error: 'requiredCloutLevel must name a level in clout.levels',
      path: ['jobs', 'requiredCloutLevel'],
    },
  )
  .refine(
    (balance) =>
      Object.values(balance.boroughs).every(
        (rule) =>
          rule.access !== 'clout' || balance.clout.levels.some((entry) => entry.id === rule.level),
      ),
    { error: 'a clout-gated borough must name a level in clout.levels', path: ['boroughs'] },
  )
  .refine(
    (balance) => {
      const cheapest = lowestRentHome(balance.rentPerWeek)
      return HOME_IDS.every((id) => (id === cheapest) === !(id in balance.housing.moveInCost))
    },
    {
      error: 'housing.moveInCost needs every home except the lowest-rent one, and not that one',
      path: ['housing', 'moveInCost'],
    },
  )
  .refine((balance) => balance.rent.lateFees.length === balance.rent.evictAfterMissed - 1, {
    error: 'rent.lateFees needs one fee for each miss before eviction',
    path: ['rent', 'lateFees'],
  })
  .refine(
    ({ actions, stats, clout }) =>
      clout.flex.durationMin <= actions.maxDurationMin && clout.flex.energyCost <= stats.max,
    { error: 'clout.flex exceeds maxDurationMin or stats.max', path: ['clout', 'flex'] },
  )
  .refine(
    ({ actions, place }) =>
      Object.values(place.venueActions).every((ids) =>
        ids.every((id) => Object.hasOwn(actions.catalog, id) || Object.hasOwn(place.actions, id)),
      ),
    {
      error: 'place.venueActions must name actions in actions.catalog or place.actions',
      path: ['place', 'venueActions'],
    },
  )
  .refine(
    ({ actions, place }) =>
      Object.keys(place.actions).every((id) => !Object.hasOwn(actions.catalog, id)),
    { error: 'place.actions must not reuse an actions.catalog id', path: ['place', 'actions'] },
  )
  .refine(
    ({ actions, stats, place }) =>
      [
        ...Object.values(place.actions).map((action) => ({
          durationMin: action.durationMin,
          energyCost: action.energyCost,
          effects: STAT_KEYS.map((key) => action.statEffects[key] ?? 0),
        })),
        ...Object.values(place.clubs).map((club) => ({
          durationMin: club.durationMin,
          energyCost: club.energyCost,
          effects: [club.moodGain],
        })),
        {
          durationMin: place.visit.durationMin,
          energyCost: place.visit.energyCost,
          effects: [place.visit.moodGain],
        },
      ].every(
        (action) =>
          action.durationMin <= actions.maxDurationMin &&
          action.energyCost <= stats.max &&
          action.effects.every((effect) => Math.abs(effect) <= stats.max),
      ),
    { error: 'a place action exceeds maxDurationMin or stats.max', path: ['place'] },
  )
  .refine(
    ({ clout, place }) =>
      Object.values(place.clubs).every((club) =>
        clout.levels.some((level) => level.id === club.minCloutLevel),
      ),
    {
      error: 'place.clubs minCloutLevel must name a level in clout.levels',
      path: ['place', 'clubs'],
    },
  )
export type BalanceConfig = z.infer<typeof BalanceConfigSchema>

export const LayoutConfigSchema = z.strictObject({
  overlay: z.strictObject({
    bannerHeightPx: positive,
    hudHeightPx: positive,
    toastHeightPx: positive,
    /** How long a toast (the level-up message) shows before it closes itself. */
    toastMs: positiveInt,
    sheetMaxHeightVh: positive,
    sheetMaxWidthPx: positive,
    tabBarHeightPx: positive,
    /**
     * A lazily loaded feature's loading skeleton stays invisible this long, so a fast load never
     * flashes a placeholder (its status is announced at once).
     */
    loadingRevealDelayMs: z.int().nonnegative(),
  }),
})
export type LayoutConfig = z.infer<typeof LayoutConfigSchema>

const PACK_ID = /^[a-z0-9-]+$/

export const CopyConfigSchema = z
  .strictObject({
    /** Active slang pack id. Swapping it needs no code change. */
    slangPack: z.string().regex(PACK_ID),
    /**
     * Every slang pack. A pack overrides a namespace with data/copy/<namespace>/<pack>.json;
     * a namespace it does not override has no file for it.
     */
    packs: z.array(z.string().regex(PACK_ID)).min(1),
  })
  .refine((config) => config.packs.includes(config.slangPack), {
    error: 'slangPack must be one of packs',
    path: ['slangPack'],
  })
  .refine((config) => new Set(config.packs).size === config.packs.length, {
    error: 'packs must not repeat',
    path: ['packs'],
  })
export type CopyConfig = z.infer<typeof CopyConfigSchema>

/** The welcome card: the 18+ check, the under-age lock and the consent version (S05a). */
export const OnboardingConfigSchema = z
  .strictObject({
    /** Players must be at least this old. The year picker never shows or hints at it. */
    minimumAge: positiveInt,
    /** How long an under-age answer locks the gate on that device. */
    underAgeLockHours: positiveInt,
    /** How many years back the year picker goes from the current year. */
    birthYearSpan: positiveInt,
    /** Version of the Terms and Privacy Policy a player consents to (an ISO date). */
    consentVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((config) => config.birthYearSpan > config.minimumAge + 1, {
    error: 'birthYearSpan must reach past minimumAge, or no year in the picker can pass',
    path: ['birthYearSpan'],
  })
export type OnboardingConfig = z.infer<typeof OnboardingConfigSchema>

const volume = z.int().min(0).max(100)
const AudioTierSchema = z.strictObject({
  /** Decode the sound effects as soon as the runtime starts (else on first use). */
  preloadSfx: z.boolean(),
  /** Fetch the next music track ahead of the crossfade (else at the switch). */
  prefetchNextMusic: z.boolean(),
})

/**
 * The audio mixer and runtime (S05b). Volumes are whole percent 0-100 on the player's sliders;
 * gains follow a squared curve (src/lib/audio/mixer.ts). Times are seconds.
 */
export const AudioConfigSchema = z
  .strictObject({
    defaults: z.strictObject({
      master: volume,
      music: volume,
      sfx: volume,
      ambience: volume,
      voice: volume,
    }),
    /** Slider step; every stored volume is a multiple of it. */
    volumeStep: z.int().min(1).max(50),
    /** Length of the linear ramp on every gain change, so volume moves never click. */
    rampSeconds: positive,
    musicCrossfadeSeconds: positive,
    /** How long one music track plays before the next fades in. */
    musicTrackPlaySeconds: positive,
    /** How far ahead of the switch the next track is fetched, where the tier prefetches. */
    prefetchAheadSeconds: positive,
    tiers: perTier(AudioTierSchema),
  })
  .refine((audio) => 100 % audio.volumeStep === 0, {
    error: 'volumeStep must divide 100',
    path: ['volumeStep'],
  })
  .refine(
    (audio) => Object.values(audio.defaults).every((value) => value % audio.volumeStep === 0),
    { error: 'defaults must be multiples of volumeStep', path: ['defaults'] },
  )
  .refine((audio) => audio.musicCrossfadeSeconds < audio.musicTrackPlaySeconds, {
    error: 'the crossfade must be shorter than a track',
    path: ['musicCrossfadeSeconds'],
  })
  .refine(
    (audio) =>
      audio.prefetchAheadSeconds > audio.musicCrossfadeSeconds &&
      audio.prefetchAheadSeconds < audio.musicTrackPlaySeconds,
    {
      error: 'prefetchAheadSeconds must fall between the crossfade and the track length',
      path: ['prefetchAheadSeconds'],
    },
  )
export type AudioConfig = z.infer<typeof AudioConfigSchema>

const metres = z.number().positive()

const GEO_BOROUGHS = ['manhattan', 'bronx', 'brooklyn', 'queens', 'staten-island'] as const

export const GeoDistrictSchema = z.strictObject({
  id: z.enum(BUILDING_DISTRICT_IDS),
  label: z.string().min(1),
  borough: z.enum(GEO_BOROUGHS),
  /** WGS84 centre, inside the NYC extent. */
  center: z.strictObject({
    lat: z.number().min(40.4).max(41),
    lng: z.number().min(-74.3).max(-73.6),
  }),
  radiusM: metres,
})
export type GeoDistrict = z.infer<typeof GeoDistrictSchema>

/** How one quality tier simplifies the district footprints. */
export const BuildingTierSchema = z.strictObject({
  /** Douglas-Peucker tolerance for each output ring. */
  simplifyM: metres,
  /** Footprints smaller than this (true m², after projection) are dropped. */
  minAreaM2: metres,
  /** Footprints lower than this (after the feet-to-metres conversion) are dropped. */
  minHeightM: z.number().nonnegative(),
  /** Heights are rounded to multiples of this; touching footprints in one bin may merge. */
  heightBinM: metres,
  /** Merge touching footprints of the same height bin into one mass. */
  merge: z.boolean(),
})
export type BuildingTier = z.infer<typeof BuildingTierSchema>

export const BuildingTiersSchema = z
  .strictObject({
    /** Height used when HEIGHT_ROOF is missing or zero. */
    defaultHeightM: metres,
    /** Footprints are snapped to this grid before merging. */
    quantumM: z.literal(1),
    tiers: perTier(BuildingTierSchema),
  })
  .refine(
    ({ tiers }) =>
      tiers.low.simplifyM >= tiers.mid.simplifyM &&
      tiers.mid.simplifyM >= tiers.high.simplifyM &&
      tiers.low.minAreaM2 >= tiers.mid.minAreaM2 &&
      tiers.mid.minAreaM2 >= tiers.high.minAreaM2,
    { error: 'lower tiers must simplify at least as much as higher ones', path: ['tiers'] },
  )
export type BuildingTiers = z.infer<typeof BuildingTiersSchema>

/** Procedural low blocks outside the districts, one jittered grid per tier and borough. */
export const BlocksConfigSchema = z.strictObject({
  /** Seed for src/engine/rng.ts; changing it reshuffles every block. */
  seed: z.int().nonnegative(),
  /** Storey height: a block is its zone's average floors times this. */
  floorM: metres,
  /** Random offset of a block from its grid point, as a fraction of the spacing. */
  jitter: z.number().min(0).max(0.5),
  /** Random spread of the floor count around the zone average (0.4 = plus or minus 40%). */
  heightJitter: z.number().min(0).max(0.9),
  /** Floor-area ratio at which every grid point gets a block; lower FAR fills proportionally. */
  fullFar: positive,
  /** Block side as a fraction of the grid spacing. */
  footprintFraction: z.number().gt(0).max(1),
  spacingM: perTier(metres),
  /** The build fails when a tier places more blocks than this. */
  maxInstances: perTier(positiveInt),
  /** Grid rotation per borough, degrees counter-clockwise from east (Manhattan's street grid). */
  gridAngleDeg: z.strictObject({
    manhattan: z.number().min(-90).max(90),
    bronx: z.number().min(-90).max(90),
    brooklyn: z.number().min(-90).max(90),
    queens: z.number().min(-90).max(90),
    'staten-island': z.number().min(-90).max(90),
  }),
})
export type BlocksConfig = z.infer<typeof BlocksConfigSchema>

/**
 * Parameters of `npm run geo:build` (scripts/geo). Distances in metres, weights and areas in
 * square metres. Changing any of them changes the committed geo outputs: rebuild them.
 */
export const GeoConfigSchema = z
  .strictObject({
    /** Output grid: coordinates are rounded to whole metres. */
    quantumM: z.literal(1),
    /** Visvalingam minimum triangle area kept on borough shorelines. */
    landMinWeightM2: metres,
    landMinRingAreaM2: metres,
    zoneMinWeightM2: metres,
    zoneMinRingAreaM2: metres,
    parkMinRingAreaM2: metres,
    /** Douglas-Peucker tolerance for subway paths. */
    subwayToleranceM: metres,
    /** A shape is dropped when every vertex lies this close to the paths already kept. */
    subwayDedupCoverM: metres,
    /** A station must lie this close to a path of one of its own lines. */
    stationOnLineToleranceM: metres,
    /** Longest gap a route's path may be extended by to reach its terminal station. */
    terminalGapMaxM: metres,
    /** Longest distance a station may be snapped to its nearest borough or zone. */
    stationAreaFallbackM: metres,
    /** How far the sea extends beyond data/geo/bounds.json. */
    waterMarginM: metres,
    /**
     * Districts with real building masses (S04d): footprints whose centroid lies inside the
     * circle are kept. `label` names the district in SOURCES.md and build logs only; player-facing
     * names come from copy.
     */
    districts: z.array(GeoDistrictSchema).min(1),
    buildingTiers: BuildingTiersSchema,
    blocks: BlocksConfigSchema,
  })
  .refine((geo) => new Set(geo.districts.map((d) => d.id)).size === geo.districts.length, {
    error: 'district ids must be unique',
    path: ['districts'],
  })
  .refine(
    (geo) =>
      geo.districts.every((a, i) =>
        geo.districts
          .slice(i + 1)
          .every((b) => distanceM(project(a.center), project(b.center)) > a.radiusM + b.radiusM),
      ),
    { error: 'district circles must not overlap', path: ['districts'] },
  )
  .refine(
    (geo) =>
      geo.stationOnLineToleranceM >
      geo.subwayToleranceM + geo.subwayDedupCoverM + geo.quantumM / Math.SQRT2,
    {
      error: 'stationOnLineToleranceM must exceed simplification plus dedup plus rounding error',
      path: ['stationOnLineToleranceM'],
    },
  )
export type GeoConfig = z.infer<typeof GeoConfigSchema>
