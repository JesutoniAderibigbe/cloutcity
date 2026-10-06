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
 * - v4 (S10): adds `player.inventory` (owned wearables, gift stacks, outfit).
 */
import * as z from 'zod/mini'
import { isSpeed, realMsPerGameMinute } from './clock'
import { isHomeId, type EngineConfig } from './config'
import { initialSnapshot, type GameSnapshot } from './game'
import {
  ITEM_SLOTS,
  emptyInventory,
  findItem,
  isGift,
  isWearable,
  type GiftStack,
  type Inventory,
  type OwnedWearable,
} from './items'
import { initialRent } from './rent'

export const SAVE_VERSION = 4

export interface SaveState extends GameSnapshot {
  /** Passive clock speed, one of `time.speeds`. */
  readonly speed: number
}

const CashSchema = z.int().check(z.gte(0))
const CloutSchema = z.int().check(z.gte(0))

const knownWearable = (config: EngineConfig) => (id: string) => {
  const item = findItem(id, config)
  return item !== undefined && isWearable(item)
}
const knownGift = (config: EngineConfig) => (id: string) => {
  const item = findItem(id, config)
  return item !== undefined && isGift(item)
}

/** The structure of `player.inventory`; cross-field rules are in `inventoryIssue`. */
function inventorySchema(config: EngineConfig) {
  return z.strictObject({
    wearables: z.array(
      z.strictObject({
        itemId: z.string().check(z.refine(knownWearable(config), 'Unknown wearable')),
        acquiredMinute: z.int().check(z.gte(0)),
        worn: z.boolean(),
      }),
    ),
    gifts: z.array(
      z.strictObject({
        itemId: z.string().check(z.refine(knownGift(config), 'Unknown gift')),
        count: z.int().check(z.gte(1), z.lte(config.items.maxGiftStack)),
      }),
    ),
    outfit: z.strictObject(
      Object.fromEntries(ITEM_SLOTS.map((slot) => [slot, z.optional(z.string())])) as Record<
        (typeof ITEM_SLOTS)[number],
        z.ZodMiniOptional<z.ZodMiniString>
      >,
    ),
  })
}

/**
 * Why a structurally valid inventory is inconsistent, or null: a duplicate wearable or gift,
 * a wearable bought after `nowMinute`, or an outfit slot holding something not owned or not
 * for that slot.
 */
function inventoryIssue(inventory: Inventory, nowMinute: number, config: EngineConfig) {
  const wearableIds = inventory.wearables.map((owned) => owned.itemId)
  if (new Set(wearableIds).size !== wearableIds.length) return 'duplicate wearable'
  const giftIds = inventory.gifts.map((stack) => stack.itemId)
  if (new Set(giftIds).size !== giftIds.length) return 'duplicate gift'
  if (inventory.wearables.some((owned) => owned.acquiredMinute > nowMinute)) {
    return 'wearable bought in the future'
  }
  for (const slot of ITEM_SLOTS) {
    const itemId = inventory.outfit[slot]
    if (itemId === undefined) continue
    const item = findItem(itemId, config)
    if (!wearableIds.includes(itemId) || item === undefined || !isWearable(item)) {
      return 'outfit holds an item not owned'
    }
    if (item.slot !== slot) return 'outfit item in the wrong slot'
  }
  return null
}

export function createSaveSchema(config: EngineConfig) {
  const stat = z.int().check(z.gte(0), z.lte(config.stats.max))
  const save = z.strictObject({
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
      inventory: inventorySchema(config),
    }),
    speed: z.number().check(z.refine((speed) => isSpeed(speed, config), 'Unsupported speed')),
  })
  return save.check(
    z.refine(
      (value) => inventoryIssue(value.player.inventory, value.clock.minute, config) === null,
      { message: 'Inconsistent inventory', path: ['player', 'inventory'] },
    ),
  )
}

/**
 * The player's inventory from an untrusted save, keeping everything usable: unknown or
 * duplicate items are dropped, a purchase minute that is not a whole number in
 * 0..`nowMinute` is clamped (a non-number becomes `nowMinute`), a non-boolean `worn` becomes
 * true (so stat effects never land twice), gift counts are rounded and clamped to
 * 1..maxGiftStack (0 drops the stack), and outfit slots that do not hold an owned item for that
 * slot are emptied. `repaired` is false when the inventory was already valid.
 */
function repairInventory(
  raw: unknown,
  nowMinute: number,
  config: EngineConfig,
): { readonly inventory: Inventory; readonly repaired: boolean } {
  const parsed = inventorySchema(config).safeParse(raw)
  if (parsed.success && inventoryIssue(parsed.data, nowMinute, config) === null) {
    return { inventory: parsed.data, repaired: false }
  }

  const record = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : [])
  const source = record(raw)

  const wearables: OwnedWearable[] = []
  for (const entry of list(source.wearables).map(record)) {
    const { itemId, acquiredMinute, worn } = entry
    if (typeof itemId !== 'string' || !knownWearable(config)(itemId)) continue
    if (wearables.some((owned) => owned.itemId === itemId)) continue
    const minute =
      typeof acquiredMinute === 'number' && Number.isFinite(acquiredMinute)
        ? Math.min(nowMinute, Math.max(0, Math.round(acquiredMinute)))
        : nowMinute
    wearables.push({
      itemId,
      acquiredMinute: minute,
      worn: typeof worn === 'boolean' ? worn : true,
    })
  }

  const gifts: GiftStack[] = []
  for (const entry of list(source.gifts).map(record)) {
    const { itemId, count } = entry
    if (typeof itemId !== 'string' || !knownGift(config)(itemId)) continue
    if (gifts.some((stack) => stack.itemId === itemId)) continue
    if (typeof count !== 'number' || !Number.isFinite(count)) continue
    const fixed = Math.min(config.items.maxGiftStack, Math.round(count))
    if (fixed >= 1) gifts.push({ itemId, count: fixed })
  }

  const rawOutfit = record(source.outfit)
  const outfit: Partial<Record<(typeof ITEM_SLOTS)[number], string>> = {}
  for (const slot of ITEM_SLOTS) {
    const itemId = Object.hasOwn(rawOutfit, slot) ? rawOutfit[slot] : undefined
    if (typeof itemId !== 'string') continue
    const item = findItem(itemId, config)
    const owned = wearables.some((entry) => entry.itemId === itemId)
    if (owned && item !== undefined && isWearable(item) && item.slot === slot) outfit[slot] = itemId
  }
  return { inventory: { wearables, gifts, outfit }, repaired: true }
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
    inventory: z.unknown(),
  }),
  speed: z.unknown(),
})

/** A v3 save's structure (S11): no inventory yet. */
const LoadableSaveV3Schema = z.strictObject({
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
 *   (a non-number becomes 0);
 * - an inconsistent or malformed inventory keeps what is usable (see `repairInventory`).
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

  const { inventory, repaired: inventoryRepaired } = repairInventory(
    player.inventory,
    clock.minute,
    config,
  )
  if (inventoryRepaired) repaired.push('player.inventory')

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
        inventory,
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
 * home and no rent owed. A v3 save keeps everything and starts with no items. Anything older or malformed starts fresh. A save from a newer
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
          player: {
            ...v2.data.player,
            clout: 0,
            home: config.startHome,
            rent: initialRent,
            inventory: emptyInventory,
          },
        },
        config,
      )
      if (loaded.ok) return { save: loaded.save, outcome: 'carried' }
    }
  }
  if (version === 3) {
    const v3 = LoadableSaveV3Schema.safeParse(persisted)
    if (v3.success) {
      const loaded = loadSave(
        { ...v3.data, player: { ...v3.data.player, inventory: emptyInventory } },
        config,
      )
      if (loaded.ok) return { save: loaded.save, outcome: 'carried' }
    }
  }
  return { save: fresh, outcome: 'fresh' }
}
