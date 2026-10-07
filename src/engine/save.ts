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
 * - v5 (S14): adds `events` (open event, cooldown history, pending clout/item effects, random
 *   generator state).
 * - v6 (S09): adds `player.clubNights` (the night each club last paid out clout).
 * - v7 (S13): `player.clout` becomes the clout ledger (src/engine/clout.ts) and `player.flex`
 *   is added; event clout no longer waits in `events.pending` (it lands at once).
 */
import * as z from 'zod/mini'
import { CLOUT_SOURCES, type CloutSourceId } from '@/lib/data/cloutSources'
import { calendar, isSpeed, realMsPerGameMinute } from './clock'
import {
  appendClout,
  cloutLevel,
  cloutSums,
  currencyOf,
  initialCloutState,
  itemClout,
  legacyCloutState,
  type CloutEntry,
  type CloutState,
} from './clout'
import { isHomeId, type EngineConfig } from './config'
import { initialEventsState, type EventsState, type PendingEffect } from './events'
import {
  initialFlexState,
  initialSnapshot,
  type ClubNights,
  type FlexState,
  type GameSnapshot,
} from './game'
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

export const SAVE_VERSION = 7

export interface SaveState extends GameSnapshot {
  /** Passive clock speed, one of `time.speeds`. */
  readonly speed: number
  readonly events: EventsState
}

const CashSchema = z.int().check(z.gte(0))
/** A v3 to v6 save's clout: one whole number. */
const LegacyCloutSchema = z.int().check(z.gte(0))
const WholeSchema = z.int().check(z.gte(0))
const Uint32Schema = z.int().check(z.gte(0), z.lte(0xffffffff))

const EffectSourceSchema = z.strictObject({
  type: z.literal('event'),
  eventId: z.string(),
  choiceId: z.string(),
})

const ItemPendingEffectSchema = z.strictObject({
  kind: z.literal('item'),
  itemId: z.string(),
  op: z.enum(['grant', 'consume']),
  source: EffectSourceSchema,
})

/** v5 and v6 kept event clout pending too; v7 applies it at once. */
const PendingEffectV6Schema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('clout'), amount: z.int(), source: EffectSourceSchema }),
  ItemPendingEffectSchema,
])

const CLOUT_REF_SCHEMAS = {
  paycheck: z.strictObject({ jobId: z.string() }),
  flex: z.strictObject({
    placeId: z.string(),
    viral: z.boolean(),
    placeMultiplier: z.number().check(z.gt(0)),
    styleScore: WholeSchema,
    base: z.int().check(z.gte(1)),
  }),
  club: z.strictObject({ venueId: z.string(), night: WholeSchema }),
  event: z.strictObject({ eventId: z.string(), choiceId: z.string() }),
  grant: z.strictObject({ grantKey: z.string() }),
  legacy: z.strictObject({}),
  repair: z.strictObject({}),
  item: z.strictObject({ itemId: z.string(), op: z.enum(['buy', 'sell', 'grant', 'consume']) }),
  premium: z.strictObject({ itemId: z.string(), op: z.enum(['grant', 'revoke']) }),
} as const satisfies Record<CloutSourceId, z.ZodMiniType>

function cloutEntrySchema<S extends CloutSourceId>(source: S) {
  return z.strictObject({
    seq: z.int().check(z.gte(1)),
    at: WholeSchema,
    amount: z.int(),
    currency: z.literal(currencyOf(source)),
    source: z.literal(source),
    ref: CLOUT_REF_SCHEMAS[source],
  })
}

/** One clout ledger entry; the currency must be the one its source uses. */
const CloutEntrySchema = z.discriminatedUnion('source', [
  cloutEntrySchema('paycheck'),
  cloutEntrySchema('flex'),
  cloutEntrySchema('club'),
  cloutEntrySchema('event'),
  cloutEntrySchema('grant'),
  cloutEntrySchema('legacy'),
  cloutEntrySchema('repair'),
  cloutEntrySchema('item'),
  cloutEntrySchema('premium'),
])

const CompactedSchema = z.strictObject({
  entries: WholeSchema,
  bySource: z.partialRecord(z.enum(CLOUT_SOURCES), z.int()),
})

/** The structure of `player.clout`; cross-field rules are in `cloutIssue`. */
function cloutStateSchema(config: EngineConfig) {
  return z.strictObject({
    ledger: z.array(CloutEntrySchema).check(z.maxLength(config.clout.ledger.maxEntries)),
    compacted: CompactedSchema,
    nextSeq: z.int().check(z.gte(1)),
    peakLevel: z.int().check(z.gte(0), z.lte(config.clout.levels.length - 1)),
    firstPaycheckPaid: z.boolean(),
  })
}

/**
 * Why a structurally valid clout state is inconsistent, or null: entries out of order or not
 * below `nextSeq`, an entry recorded after `nowMinute`, a sum that is not a safe integer, or
 * earned or premium clout below 0.
 */
function cloutIssue(state: CloutState, nowMinute: number) {
  let lastSeq = 0
  for (const entry of state.ledger) {
    if (entry.seq <= lastSeq) return 'ledger out of order'
    if (entry.at > nowMinute) return 'clout recorded in the future'
    lastSeq = entry.seq
  }
  if (state.nextSeq <= lastSeq) return 'nextSeq behind the ledger'
  const sums = cloutSums(state)
  const values = [sums.earned, sums.premium, ...Object.values(sums.bySource)]
  if (!values.every(Number.isSafeInteger)) return 'clout sum out of range'
  if (sums.earned < 0 || sums.premium < 0) return 'negative clout'
  return null
}

/** Places the config knows, each flexed on a day no later than today. */
function flexStateSchema(config: EngineConfig) {
  return z.strictObject({
    rngState: Uint32Schema,
    byPlace: z
      .record(z.string(), WholeSchema)
      .check(
        z.refine(
          (byPlace) => Object.keys(byPlace).every((id) => config.places.has(id)),
          'Unknown place',
        ),
      ),
  })
}

/** A club's night key: the game day the night opened on (0 for day 1 before the club opens). */
const NightKeySchema = z.int().check(z.gte(0))

/** Only configured clubs, each with a night that opened no later than today. */
function clubNightsSchema(config: EngineConfig) {
  return z
    .record(z.string(), NightKeySchema)
    .check(
      z.refine(
        (nights) => Object.keys(nights).every((id) => Object.hasOwn(config.place.clubs, id)),
        'Unknown club',
      ),
    )
}

function eventsStateSchema(config: EngineConfig) {
  return z.strictObject({
    active: z.nullable(z.string()),
    history: z.record(z.string(), z.int().check(z.gte(0))),
    pending: z.array(ItemPendingEffectSchema).check(z.maxLength(config.events.maxPendingEffects)),
    rngState: Uint32Schema,
  })
}

/** v5 and v6 event state: pending effects may still hold clout. */
function eventsStateV6Schema(config: EngineConfig) {
  return z.strictObject({
    active: z.nullable(z.string()),
    history: z.record(z.string(), z.int().check(z.gte(0))),
    pending: z.array(PendingEffectV6Schema).check(z.maxLength(config.events.maxPendingEffects)),
    rngState: Uint32Schema,
  })
}

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
      clout: cloutStateSchema(config),
      flex: flexStateSchema(config),
      home: z.string().check(z.refine((home) => isHomeId(home, config), 'Unknown home')),
      rent: z.strictObject({
        owed: CashSchema,
        missed: z.int().check(z.gte(0), z.lt(config.rent.evictAfterMissed)),
      }),
      inventory: inventorySchema(config),
      clubNights: clubNightsSchema(config),
    }),
    speed: z.number().check(z.refine((speed) => isSpeed(speed, config), 'Unsupported speed')),
    events: eventsStateSchema(config),
  })
  return save.check(
    z.refine(
      (value) => inventoryIssue(value.player.inventory, value.clock.minute, config) === null,
      { message: 'Inconsistent inventory', path: ['player', 'inventory'] },
    ),
    z.refine(
      (value) =>
        Object.values(value.player.clubNights).every(
          (night) => night <= calendar(value.clock.minute, config).day,
        ),
      { message: 'A club night in the future', path: ['player', 'clubNights'] },
    ),
    z.refine((value) => cloutIssue(value.player.clout as CloutState, value.clock.minute) === null, {
      message: 'Inconsistent clout ledger',
      path: ['player', 'clout'],
    }),
    z.refine(
      (value) =>
        Object.values(value.player.flex.byPlace).every(
          (day) => day <= calendar(value.clock.minute, config).day,
        ),
      { message: 'A flex in the future', path: ['player', 'flex'] },
    ),
  )
}

/** Own keys of a plain object, or an empty object for anything else. */
function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * The clout ledger from an untrusted save, keeping everything usable: entries that do not fit
 * their source's shape, were recorded after `nowMinute` or break the `seq` order are dropped;
 * folded totals keep the known sources with whole values; `nextSeq` moves past the last entry;
 * a `peakLevel` outside the levels is clamped (a non-number becomes the current level, so no
 * level-up replays); a non-boolean `firstPaycheckPaid` becomes true (never paid twice). Earned
 * clout below 0 gets a `repair` entry back to 0; premium clout below 0 is folded back to 0.
 * Totals that sum past a safe integer keep no entries or folded totals at all.
 * `repaired` is false when the state was already valid.
 */
function repairClout(
  raw: unknown,
  nowMinute: number,
  inventory: Inventory,
  config: EngineConfig,
): { readonly clout: CloutState; readonly repaired: boolean } {
  const parsed = cloutStateSchema(config).safeParse(raw)
  if (parsed.success && cloutIssue(parsed.data as CloutState, nowMinute) === null) {
    return { clout: parsed.data as CloutState, repaired: false }
  }
  const source = recordOf(raw)

  const kept: CloutEntry[] = []
  for (const value of Array.isArray(source.ledger) ? source.ledger : []) {
    const entry = CloutEntrySchema.safeParse(value)
    if (!entry.success || entry.data.at > nowMinute) continue
    if (entry.data.seq <= (kept.at(-1)?.seq ?? 0)) continue
    kept.push(entry.data as CloutEntry)
  }
  const overflow = Math.max(0, kept.length - config.clout.ledger.maxEntries)

  const rawCompacted = recordOf(source.compacted)
  const rawBySource = recordOf(rawCompacted.bySource)
  const bySource: Partial<Record<CloutSourceId, number>> = {}
  for (const id of CLOUT_SOURCES) {
    const value = Object.hasOwn(rawBySource, id) ? rawBySource[id] : undefined
    if (typeof value === 'number' && Number.isSafeInteger(value)) bySource[id] = value
  }
  for (const entry of kept.slice(0, overflow)) {
    bySource[entry.source] = (bySource[entry.source] ?? 0) + entry.amount
  }
  const rawEntries = rawCompacted.entries
  const entries =
    (typeof rawEntries === 'number' && Number.isSafeInteger(rawEntries) && rawEntries >= 0
      ? rawEntries
      : 0) + overflow

  const ledger = kept.slice(overflow)
  const lastSeq = kept.at(-1)?.seq ?? 0
  const rawNext = source.nextSeq
  const nextSeq =
    typeof rawNext === 'number' && Number.isSafeInteger(rawNext) && rawNext > lastSeq
      ? rawNext
      : lastSeq + 1

  let clout: CloutState = {
    ledger,
    compacted: { entries, bySource },
    nextSeq,
    peakLevel: 0,
    firstPaycheckPaid:
      typeof source.firstPaycheckPaid === 'boolean' ? source.firstPaycheckPaid : true,
  }
  let sums = cloutSums(clout)
  // Each kept value is a safe integer, but tampered totals can still sum past one: such a
  // ledger is unusable, so nothing of it is kept (and no repair entry can overflow either).
  if (![sums.earned, sums.premium, ...Object.values(sums.bySource)].every(Number.isSafeInteger)) {
    clout = { ...clout, ledger: [], compacted: initialCloutState.compacted }
    sums = cloutSums(clout)
  }
  if (sums.premium < 0) {
    const premium = (clout.compacted.bySource.premium ?? 0) - sums.premium
    clout = {
      ...clout,
      compacted: { ...clout.compacted, bySource: { ...clout.compacted.bySource, premium } },
    }
  }
  if (sums.earned < 0) {
    const change = { source: 'repair', amount: -sums.earned, ref: {} } as const
    clout = appendClout(clout, change, nowMinute, config).state
  }

  const top = config.clout.levels.length - 1
  const rawPeak = source.peakLevel
  const peakLevel =
    typeof rawPeak === 'number' && Number.isFinite(rawPeak)
      ? Math.min(top, Math.max(0, Math.round(rawPeak)))
      : currentLevelIndex(clout, inventory, config)
  return { clout: { ...clout, peakLevel }, repaired: true }
}

/** The level a clout state and inventory add up to (premium capped). */
function currentLevelIndex(clout: CloutState, inventory: Inventory, config: EngineConfig) {
  const sums = cloutSums(clout)
  const premium = Math.min(sums.premium, config.clout.caps.byCurrency.usd)
  return cloutLevel(sums.earned + premium + itemClout({ inventory }, config), config).index
}

/**
 * Flex state from an untrusted save: flexes at places the config does not know or on a day
 * after today are dropped, and a generator state that is not a uint32 starts over at 0.
 */
function repairFlex(
  raw: unknown,
  nowMinute: number,
  config: EngineConfig,
): { readonly flex: FlexState; readonly repaired: boolean } {
  const today = calendar(nowMinute, config).day
  const parsed = flexStateSchema(config).safeParse(raw)
  if (parsed.success && Object.values(parsed.data.byPlace).every((day) => day <= today)) {
    return { flex: parsed.data, repaired: false }
  }
  const source = recordOf(raw)
  const rngState = Uint32Schema.safeParse(source.rngState)
  const entries = Object.entries(recordOf(source.byPlace))
  const kept = entries.filter(
    (entry): entry is [string, number] =>
      config.places.has(entry[0]) &&
      Number.isSafeInteger(entry[1]) &&
      (entry[1] as number) >= 0 &&
      (entry[1] as number) <= today,
  )
  return {
    flex: { rngState: rngState.success ? rngState.data : 0, byPlace: Object.fromEntries(kept) },
    repaired: true,
  }
}

/**
 * Club nights from an untrusted save: entries for clubs the config does not have, keys that
 * are not own string keys, and nights that are not whole numbers in 0..today are dropped (so
 * a damaged entry can only let a club pay out once more, never block it for good).
 */
function repairClubNights(
  raw: unknown,
  nowMinute: number,
  config: EngineConfig,
): { readonly clubNights: ClubNights; readonly repaired: boolean } {
  const today = calendar(nowMinute, config).day
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { clubNights: {}, repaired: true }
  }
  const entries = Object.entries(raw as Record<string, unknown>)
  const kept = entries.filter(
    (entry): entry is [string, number] =>
      Object.hasOwn(config.place.clubs, entry[0]) &&
      Number.isSafeInteger(entry[1]) &&
      (entry[1] as number) >= 0 &&
      (entry[1] as number) <= today,
  )
  return { clubNights: Object.fromEntries(kept), repaired: kept.length !== entries.length }
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
    // Repairable: unusable entries are dropped (`repairClout`).
    clout: z.unknown(),
    // Repairable: unusable flexes are dropped (`repairFlex`).
    flex: z.optional(z.unknown()),
    home: z.unknown(),
    rent: z.strictObject({ owed: CashSchema, missed: z.unknown() }),
    inventory: z.unknown(),
    // Repairable: unusable entries are dropped (`repairClubNights`).
    clubNights: z.optional(z.unknown()),
  }),
  speed: z.unknown(),
  // Repairable: a missing or unusable event state starts over (`repairEvents`).
  events: z.optional(z.unknown()),
})

/** A v6 save's structure (S09): clout is one number, no flex state yet. */
const LoadableSaveV6Schema = z.strictObject({
  clock: z.strictObject({ minute: z.int().check(z.gte(0)), remainderMs: z.unknown() }),
  player: z.strictObject({
    cash: CashSchema,
    stats: z.strictObject({ energy: z.number(), hunger: z.number(), mood: z.number() }),
    clout: LegacyCloutSchema,
    home: z.unknown(),
    rent: z.strictObject({ owed: CashSchema, missed: z.unknown() }),
    inventory: z.unknown(),
    clubNights: z.optional(z.unknown()),
  }),
  speed: z.unknown(),
  events: z.optional(z.unknown()),
})
type LoadableSaveV6 = z.infer<typeof LoadableSaveV6Schema>

/** A v5 save's structure (S14): no club nights yet. */
const LoadableSaveV5Schema = z.strictObject({
  clock: z.strictObject({ minute: z.int().check(z.gte(0)), remainderMs: z.unknown() }),
  player: z.strictObject({
    cash: CashSchema,
    stats: z.strictObject({ energy: z.number(), hunger: z.number(), mood: z.number() }),
    clout: LegacyCloutSchema,
    home: z.unknown(),
    rent: z.strictObject({ owed: CashSchema, missed: z.unknown() }),
    inventory: z.unknown(),
  }),
  speed: z.unknown(),
  events: z.optional(z.unknown()),
})

/** A v4 save's structure (S10): no event state yet. */
const LoadableSaveV4Schema = z.strictObject({
  clock: z.strictObject({ minute: z.int().check(z.gte(0)), remainderMs: z.unknown() }),
  player: z.strictObject({
    cash: CashSchema,
    stats: z.strictObject({ energy: z.number(), hunger: z.number(), mood: z.number() }),
    clout: LegacyCloutSchema,
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
    clout: LegacyCloutSchema,
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
 * - an inconsistent or malformed inventory keeps what is usable (see `repairInventory`);
 * - unusable event state starts over (see `repairEvents`);
 * - unusable club-night entries are dropped (see `repairClubNights`);
 * - an inconsistent clout ledger keeps what is usable (see `repairClout`);
 * - unusable flexes are dropped (see `repairFlex`).
 * Only a structurally unusable save (missing objects, unknown keys, cash or minute of the wrong
 * type or range) fails, and the caller starts fresh.
 */
export function loadSave(persisted: unknown, config: EngineConfig): LoadResult {
  const parsed = LoadableSaveSchema.safeParse(persisted)
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((issue) => issue.path.join('.')) }
  }
  const { clock, player, speed, events } = parsed.data
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

  const { clubNights, repaired: nightsRepaired } = repairClubNights(
    player.clubNights,
    clock.minute,
    config,
  )
  if (nightsRepaired) repaired.push('player.clubNights')

  const { clout, repaired: cloutRepaired } = repairClout(
    player.clout,
    clock.minute,
    inventory,
    config,
  )
  if (cloutRepaired) repaired.push('player.clout')

  const { flex, repaired: flexRepaired } = repairFlex(player.flex, clock.minute, config)
  if (flexRepaired) repaired.push('player.flex')

  return {
    ok: true,
    save: {
      clock: { minute: clock.minute, remainderMs },
      player: {
        cash: player.cash,
        stats,
        clout,
        flex,
        home,
        rent: { owed: player.rent.owed, missed },
        inventory,
        clubNights,
      },
      speed: validSpeed,
      events: repairEvents(events, config, repaired),
    },
    repaired,
  }
}

/**
 * Event state is replaced by a fresh one when it does not fit the schema. Otherwise an open
 * event or a history entry for an event no longer in the catalog (content changed between
 * builds) is dropped, so a removed event can never be stuck open.
 */
function repairEvents(value: unknown, config: EngineConfig, repaired: string[]): EventsState {
  const parsed = eventsStateSchema(config).safeParse(value)
  if (!parsed.success) {
    repaired.push('events')
    return initialEventsState()
  }
  const known = new Set(config.events.catalog.map((event) => event.id))
  const { active, history, pending, rngState } = parsed.data
  const keptActive = active !== null && known.has(active) ? active : null
  if (keptActive !== active) repaired.push('events.active')
  const keptHistory = Object.fromEntries(Object.entries(history).filter(([id]) => known.has(id)))
  if (Object.keys(keptHistory).length !== Object.keys(history).length) {
    repaired.push('events.history')
  }
  return { active: keptActive, history: keptHistory, pending, rngState }
}

const SaveV1Schema = z.strictObject({ player: z.strictObject({ cash: CashSchema }) })

export function initialSave(config: EngineConfig): SaveState {
  return {
    ...initialSnapshot(config),
    speed: config.time.speeds[0] ?? 1,
    events: initialEventsState(),
  }
}

/** A save written by a newer build: expected (an older tab or a rollback), not a failure. */
export class NewerSaveError extends Error {
  constructor(readonly version: number) {
    super(`Saved game version ${version} is newer than this build (${SAVE_VERSION})`)
    this.name = 'NewerSaveError'
  }
}

export interface Migration {
  readonly save: SaveState
  /** `carried` when progress came across from the old save, `fresh` when it was not usable. */
  readonly outcome: 'carried' | 'fresh'
}

/**
 * A v6 save's clout and events in v7 form:
 * - its clout number becomes one folded `legacy` entry (`legacyCloutState`);
 * - event clout still pending is drained into the ledger as `event` entries at face value (no
 *   style; a loss is clamped at 0 earned), and only item effects stay pending;
 * - `peakLevel` is the level the result adds up to with the wearables owned, so no level-up
 *   is reported for progress made before the ledger; the first paycheck is still to come;
 * - flex state starts fresh.
 * Event state that does not fit the v6 schema is passed on as is (`repairEvents` resets it).
 */
function upgradeV6(v6: LoadableSaveV6, config: EngineConfig) {
  const { clock, player } = v6
  const { inventory } = repairInventory(player.inventory, clock.minute, config)
  let clout = legacyCloutState(player.clout, 0)
  let events: unknown = v6.events
  const parsedEvents = eventsStateV6Schema(config).safeParse(v6.events)
  if (parsedEvents.success) {
    const items: PendingEffect[] = []
    for (const effect of parsedEvents.data.pending) {
      if (effect.kind === 'item') {
        items.push(effect)
        continue
      }
      const ref = { eventId: effect.source.eventId, choiceId: effect.source.choiceId }
      const change = { source: 'event', amount: effect.amount, ref } as const
      clout = appendClout(clout, change, clock.minute, config).state
    }
    events = { ...parsedEvents.data, pending: items }
  }
  clout = { ...clout, peakLevel: currentLevelIndex(clout, inventory, config) }
  return { ...v6, player: { ...player, clout, flex: initialFlexState, inventory }, events }
}

/** Loads a save in v6 form (v2 to v5 saves are brought to it first) as the current version. */
function loadV6(raw: unknown, config: EngineConfig): LoadResult | null {
  const v6 = LoadableSaveV6Schema.safeParse(raw)
  if (!v6.success) return null
  return loadSave(upgradeV6(v6.data, config), config)
}

/**
 * Upgrades a save written by an older SAVE_VERSION. A v1 save keeps its cash and starts the
 * new clock and stats fresh. A v2 save keeps everything and starts with no clout, the start
 * home and no rent owed. A v3 save keeps everything and starts with no items. A v4 save keeps
 * everything and starts with fresh event state. A v5 save keeps everything and starts with no
 * club nights. A v6 save keeps everything, its clout carried into the ledger (`upgradeV6`).
 * Every step goes through the v6 form, so v2 to v5 saves get the v6 upgrade too. Anything
 * older or malformed starts fresh. A save from a newer build throws `NewerSaveError`: it is
 * not loaded, and not overwritten unless the player plays on.
 */
export function migrateSave(persisted: unknown, version: number, config: EngineConfig): Migration {
  if (version > SAVE_VERSION) {
    throw new NewerSaveError(version)
  }
  const fresh = initialSave(config)
  const freshEvents = initialEventsState()
  let loaded: LoadResult | null = null
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
      loaded = loadV6(
        {
          ...v2.data,
          player: {
            ...v2.data.player,
            clout: 0,
            home: config.startHome,
            rent: initialRent,
            inventory: emptyInventory,
            clubNights: {},
          },
          events: freshEvents,
        },
        config,
      )
    }
  }
  if (version === 3) {
    const v3 = LoadableSaveV3Schema.safeParse(persisted)
    if (v3.success) {
      loaded = loadV6(
        {
          ...v3.data,
          player: { ...v3.data.player, inventory: emptyInventory, clubNights: {} },
          events: freshEvents,
        },
        config,
      )
    }
  }
  if (version === 4) {
    const v4 = LoadableSaveV4Schema.safeParse(persisted)
    if (v4.success) {
      loaded = loadV6(
        { ...v4.data, player: { ...v4.data.player, clubNights: {} }, events: freshEvents },
        config,
      )
    }
  }
  if (version === 5) {
    const v5 = LoadableSaveV5Schema.safeParse(persisted)
    if (v5.success) {
      loaded = loadV6({ ...v5.data, player: { ...v5.data.player, clubNights: {} } }, config)
    }
  }
  if (version === 6) loaded = loadV6(persisted, config)
  if (loaded?.ok === true) return { save: loaded.save, outcome: 'carried' }
  return { save: fresh, outcome: 'fresh' }
}
