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
    }),
    costs: z.strictObject({ food: MinMaxSchema, subwayFare: dollars }),
    target: z.strictObject({
      shiftsPerDay: positive,
      weeklySavings: dollars,
      firstUpgradeGameDay: MinMaxSchema,
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
