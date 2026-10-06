/**
 * The versioned save format: what the store persists (src/state/store.ts) and, later, what
 * syncs to the server. Saves are untrusted and validated on every load.
 *
 * Bump SAVE_VERSION on any breaking change to the schema and add the step from the previous
 * version to `migrateSave`, with a test.
 *
 * History:
 * - v1 (S02): `{ player: { cash } }`.
 * - v2 (S03): adds the personal clock, stats and the clock speed.
 * - v3 (S11): adds `player.clout`, `player.home` and `player.rent` (owed, missed).
 */
import * as z from 'zod/mini'
import { isSpeed, realMsPerGameMinute } from './clock'
import { isHomeId, type EngineConfig } from './config'
import { initialSnapshot, type GameSnapshot } from './game'
import { initialRent } from './rent'

export const SAVE_VERSION = 3

export interface SaveState extends GameSnapshot {
  /** Passive clock speed, one of `time.speeds`. */
  readonly speed: number
}

const CashSchema = z.int().check(z.gte(0))
const CloutSchema = z.int().check(z.gte(0))

export function createSaveSchema(config: EngineConfig) {
  const stat = z.int().check(z.gte(0), z.lte(config.stats.max))
  return z.strictObject({
    clock: z.strictObject({
      minute: z.int().check(z.gte(0)),
      remainderMs: z.number().check(z.gte(0), z.lt(realMsPerGameMinute(config))),
    }),
    player: z.strictObject({
      cash: CashSchema,
      stats: z.strictObject({ energy: stat, hunger: stat, mood: stat }),
      clout: CloutSchema,
      home: z.string().check(z.refine((home) => isHomeId(home, config), 'Unknown home')),
      rent: z.strictObject({
        owed: CashSchema,
        missed: z.int().check(z.gte(0), z.lt(config.rent.evictAfterMissed)),
      }),
    }),
    speed: z.number().check(z.refine((speed) => isSpeed(speed, config), 'Unsupported speed')),
  })
}

/**
 * The structure a current-version save must have to be usable at all. Fields that can be
 * repaired one by one (see `loadSave`) are only type-checked loosely here.
 */
const LoadableSaveSchema = z.strictObject({
  clock: z.strictObject({ minute: z.int().check(z.gte(0)), remainderMs: z.unknown() }),
  player: z.strictObject({
    cash: CashSchema,
    stats: z.strictObject({ energy: z.number(), hunger: z.number(), mood: z.number() }),
    clout: CloutSchema,
    home: z.unknown(),
    rent: z.strictObject({ owed: CashSchema, missed: z.unknown() }),
  }),
  speed: z.unknown(),
})

/** A v2 save's structure (S03): no clout, home or rent yet. */
const LoadableSaveV2Schema = z.strictObject({
  clock: z.strictObject({ minute: z.int().check(z.gte(0)), remainderMs: z.unknown() }),
  player: z.strictObject({
    cash: CashSchema,
    stats: z.strictObject({ energy: z.number(), hunger: z.number(), mood: z.number() }),
  }),
  speed: z.unknown(),
})

export type LoadResult =
  | {
      readonly ok: true
      readonly save: SaveState
      /** Dotted paths of the fields that were out of range and were repaired. */
      readonly repaired: readonly string[]
    }
  | { readonly ok: false; readonly issues: readonly string[] }

/**
 * Loads a current-version save, repairing individually invalid fields instead of discarding
 * the player's progress:
 * - a speed the config does not offer becomes 1x;
 * - a remainder outside [0, one game minute) or not a finite number becomes 0;
 * - a stat outside 0..stats.max is clamped, and a fractional stat is rounded;
 * - a home the config does not offer becomes the start home;
 * - a missed-rent count that is not a whole number in 0..evictAfterMissed-1 is clamped
 *   (a non-number becomes 0).
 * Only a structurally unusable save (missing objects, unknown keys, cash or minute of the wrong
 * type or range) fails, and the caller starts fresh.
 */
export function loadSave(persisted: unknown, config: EngineConfig): LoadResult {
  const parsed = LoadableSaveSchema.safeParse(persisted)
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((issue) => issue.path.join('.')) }
  }
  const { clock, player, speed } = parsed.data
  const repaired: string[] = []

  const inRange = (value: unknown): value is number =>
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value < realMsPerGameMinute(config)
  const remainderMs = inRange(clock.remainderMs) ? clock.remainderMs : 0
  if (remainderMs !== clock.remainderMs) repaired.push('clock.remainderMs')

  const offered = (value: unknown): value is number =>
    typeof value === 'number' && isSpeed(value, config)
  const validSpeed = offered(speed) ? speed : (config.time.speeds[0] ?? 1)
  if (validSpeed !== speed) repaired.push('speed')

  const stat = (key: 'energy' | 'hunger' | 'mood') => {
    const value = player.stats[key]
    const fixed = Math.min(config.stats.max, Math.max(0, Math.round(value)))
    if (fixed !== value) repaired.push(`player.stats.${key}`)
    return fixed
  }
  const stats = { energy: stat('energy'), hunger: stat('hunger'), mood: stat('mood') }

  const home = isHomeId(player.home, config) ? player.home : config.startHome
  if (home !== player.home) repaired.push('player.home')

  const rawMissed = player.rent.missed
  const missed =
    typeof rawMissed === 'number' && Number.isFinite(rawMissed)
      ? Math.min(config.rent.evictAfterMissed - 1, Math.max(0, Math.round(rawMissed)))
      : 0
  if (missed !== rawMissed) repaired.push('player.rent.missed')

  return {
    ok: true,
    save: {
      clock: { minute: clock.minute, remainderMs },
      player: {
        cash: player.cash,
        stats,
        clout: player.clout,
        home,
        rent: { owed: player.rent.owed, missed },
      },
      speed: validSpeed,
    },
    repaired,
  }
}

const SaveV1Schema = z.strictObject({ player: z.strictObject({ cash: CashSchema }) })

export function initialSave(config: EngineConfig): SaveState {
  return { ...initialSnapshot(config), speed: config.time.speeds[0] ?? 1 }
}

export interface Migration {
  readonly save: SaveState
  /** `carried` when progress came across from the old save, `fresh` when it was not usable. */
  readonly outcome: 'carried' | 'fresh'
}

/**
 * Upgrades a save written by an older SAVE_VERSION. A v1 save keeps its cash and starts the
 * new clock and stats fresh. A v2 save keeps everything and starts with no clout, the start
 * home and no rent owed. Anything older or malformed starts fresh. A save from a newer
 * build throws: it is not loaded, and not overwritten unless the player plays on.
 */
export function migrateSave(persisted: unknown, version: number, config: EngineConfig): Migration {
  if (version > SAVE_VERSION) {
    throw new Error(`Saved game version ${version} is newer than this build (${SAVE_VERSION})`)
  }
  const fresh = initialSave(config)
  if (version === 1) {
    const v1 = SaveV1Schema.safeParse(persisted)
    if (v1.success) {
      return {
        save: { ...fresh, player: { ...fresh.player, cash: v1.data.player.cash } },
        outcome: 'carried',
      }
    }
  }
  if (version === 2) {
    const v2 = LoadableSaveV2Schema.safeParse(persisted)
    if (v2.success) {
      const loaded = loadSave(
        {
          ...v2.data,
          player: { ...v2.data.player, clout: 0, home: config.startHome, rent: initialRent },
        },
        config,
      )
      if (loaded.ok) return { save: loaded.save, outcome: 'carried' }
    }
  }
  return { save: fresh, outcome: 'fresh' }
}
