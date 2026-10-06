/**
 * Schemas for /data/config. This file imports only `zod` (no path aliases, no other modules) so
 * Node can load it directly from `scripts/` with its built-in type stripping.
 */
import { z } from 'zod'

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

export const HOME_IDS = ['queens-room', 'brooklyn-1br', 'manhattan-loft'] as const
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
     * Missed rent. Each consecutive due date the player cannot pay in full adds that week's
     * rent to what they owe, plus `lateFees[missed - 1]` (0 is a warning). On the
     * `evictAfterMissed`-th miss the player is evicted to the lowest-rent home.
     */
    rent: z.strictObject({
      lateFees: z.array(dollars),
      evictAfterMissed: positiveInt,
    }),
    /** Clout levels, lowest first. A player is at the highest level whose `minClout` they hold. */
    clout: z.strictObject({
      levels: z
        .array(
          z.strictObject({
            id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
            minClout: z.int().nonnegative(),
          }),
        )
        .min(1),
    }),
    costs: z.strictObject({ food: MinMaxSchema, subwayFare: dollars }),
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
    rarityTiers: z.array(RarityTierSchema).length(RARITY_TIERS.length),
    /** Placeholder USD prices (whole dollars) until a human sets them. */
    premiumPriceTiersUsd: z.record(z.string().regex(/^tier-\d+$/), z.int().positive()),
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
  .refine((balance) => balance.rent.lateFees.length === balance.rent.evictAfterMissed - 1, {
    error: 'rent.lateFees needs one fee for each miss before eviction',
    path: ['rent', 'lateFees'],
  })
  .refine(
    ({ clout: { levels } }) =>
      levels[0]?.minClout === 0 &&
      levels.every((level, i) => i === 0 || level.minClout > (levels[i - 1]?.minClout ?? 0)) &&
      new Set(levels.map((level) => level.id)).size === levels.length,
    {
      error: 'clout.levels must start at 0, rise strictly and have unique ids',
      path: ['clout', 'levels'],
    },
  )
export type BalanceConfig = z.infer<typeof BalanceConfigSchema>

export const LayoutConfigSchema = z.strictObject({
  overlay: z.strictObject({
    bannerHeightPx: positive,
    hudHeightPx: positive,
    toastHeightPx: positive,
    sheetMaxHeightVh: positive,
    sheetMaxWidthPx: positive,
    tabBarHeightPx: positive,
  }),
})
export type LayoutConfig = z.infer<typeof LayoutConfigSchema>

export const CopyConfigSchema = z.strictObject({
  /** Active slang pack id (a file in data/copy/packs). Swapping it needs no code change. */
  slangPack: z.string().regex(/^[a-z0-9-]+$/),
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

const metres = z.number().positive()

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
  })
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
