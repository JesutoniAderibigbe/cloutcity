/**
 * The in-game cash item catalog as the engine sees it (data/items/items.json). The file is
 * validated in full by `ItemsFileSchema` (src/lib/data/schemas/content.ts) in the data tests,
 * which gate every build; here the JSON is only narrowed to the engine's types, and anything
 * that does not fit throws at load (fail fast), without pulling classic zod into the client.
 */
import type { RarityTier } from '@/lib/data/schemas/config'
import type { DecorCategory, DecorFit, Item, ItemLook } from '@/lib/data/schemas/content'
import type { GridFootprint } from './homeGrid'
import { STAT_KEYS, type StatChanges } from './stats'

/** Outfit slots, in display order. Mirrors ITEM_SLOTS in src/lib/data/schemas/content.ts. */
export const ITEM_SLOTS = ['top', 'bottom', 'shoes', 'accessory', 'face'] as const
export type ItemSlot = (typeof ITEM_SLOTS)[number]

const CATEGORIES = ['clothing', 'makeup', 'gift', 'decor', 'upgrade'] as const
/** Mirrors DECOR_FITS in src/lib/data/schemas/content.ts. */
export const DECOR_FITS = ['wall', 'floor', 'surface'] as const satisfies readonly DecorFit[]
export type { DecorCategory, DecorFit }
/** Mirrors DECOR_CATEGORIES in src/lib/data/schemas/content.ts (buy mode's tabs, in order). */
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
] as const satisfies readonly DecorCategory[]
const FOOTPRINTS = ['1x1', '2x1', '2x2'] as const satisfies readonly GridFootprint[]
const RARITIES = ['common', 'medium', 'rare'] as const
type Category = (typeof CATEGORIES)[number]

interface ItemBase {
  readonly id: string
  readonly nameKey: string
  readonly descriptionKey: string
  readonly rarity: RarityTier
  readonly currency: 'cash'
  /** Whole in-game dollars. */
  readonly price: number
  /** Whole dollars it sells back for on the day it is bought; always below `price`. */
  readonly sellValue: number
  /**
   * Clout the item is worth while the player owns (or wears) it. It is computed from what is
   * owned (src/engine/clout.ts `itemClout`), never accumulated, so a sold item stops counting.
   */
  readonly cloutValue: number
  /** Style points while worn; the outfit's total multiplies clout gains (src/engine/clout.ts). */
  readonly styleValue: number
  readonly statEffects: StatChanges
}

/** Clothing or makeup: owned once, worn in its slot. */
export interface WearableDef extends ItemBase {
  readonly category: 'clothing' | 'makeup'
  readonly slot: ItemSlot
  /** What wearing it does to the avatar (S16a, src/engine/appearance.ts `effectiveLook`). */
  readonly look: ItemLook
}

/** The look part each slot's items use (mirrors SLOT_LOOK_PARTS in schemas/content.ts). */
const SLOT_LOOK_PART: Readonly<Record<ItemSlot, ItemLook['part']>> = {
  top: 'outfit',
  bottom: 'bottom',
  shoes: 'shoes',
  accessory: 'attachment',
  face: 'none',
}

/** A gift: stacks, and is consumed when used on yourself or an NPC. */
export interface GiftDef extends ItemBase {
  readonly category: 'gift'
}

/** A decor item's colour variant: a palette token and its colour name's copy key. */
export interface DecorVariant {
  readonly id: string
  readonly token: string
  readonly nameKey: string
}

/**
 * Decor (S16, S40): owned once and placed on the home's grid (src/engine/homeGrid.ts). It is
 * worth no item clout or style (`cloutValue` and `styleValue` are 0); while placed it adds
 * `homeScore` to the home's score (src/engine/home.ts).
 */
export interface DecorDef extends ItemBase {
  readonly category: 'decor'
  readonly decor: {
    /** A wall cell, or floor cells (a surface item stands on its own small table). */
    readonly fits: DecorFit
    readonly footprint: GridFootprint
    /** Rugs lie under furniture. */
    readonly layer: 'furniture' | 'rug'
    /** Buy mode's tab. */
    readonly category: DecorCategory
    /** Costs weekly upkeep while owned (balance.json `home.upkeepPctPerWeek`). */
    readonly luxury: boolean
    /** Comes with a new game's home: free, never in the shop, never sold back, no home score. */
    readonly starter: boolean
    readonly homeScore: number
    /** At least one; the first is what a new purchase shows. */
    readonly variants: readonly DecorVariant[]
  }
}

/** Apartment upgrades: listed in the catalog, sold by a later task. */
export interface OtherItemDef extends ItemBase {
  readonly category: 'upgrade'
}

export type ItemDef = WearableDef | GiftDef | DecorDef | OtherItemDef

export function isWearable(item: ItemDef): item is WearableDef {
  return item.category === 'clothing' || item.category === 'makeup'
}

export function isGift(item: ItemDef): item is GiftDef {
  return item.category === 'gift'
}

export function isDecor(item: ItemDef): item is DecorDef {
  return item.category === 'decor'
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value)
}

const isDollars = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

/** Shape the JSON import may have; every field is re-checked below. */
type RawItem = { readonly [K in keyof Item]?: unknown }

function narrow(raw: RawItem, index: number): ItemDef {
  const fail = (field: string): never => {
    throw new Error(`data/items/items.json: items[${index}].${field} does not fit the engine`)
  }
  const { id, nameKey, descriptionKey, category, slot, rarity, currency } = raw
  const { price, sellValue, cloutValue, styleValue, statEffects, decor, look } = raw
  if (typeof id !== 'string') return fail('id')
  if (typeof nameKey !== 'string') return fail('nameKey')
  if (typeof descriptionKey !== 'string') return fail('descriptionKey')
  if (!oneOf<Category>(category, CATEGORIES)) return fail('category')
  if (!oneOf<RarityTier>(rarity, RARITIES)) return fail('rarity')
  if (currency !== 'cash') return fail('currency')
  const starter = (decor as { starter?: unknown } | undefined)?.starter === true
  if (!isDollars(price) || (starter ? price !== 0 : price < 1)) return fail('price')
  if (!isDollars(sellValue) || (starter ? sellValue !== 0 : sellValue >= price)) {
    return fail('sellValue')
  }
  if (!isDollars(cloutValue)) return fail('cloutValue')
  if (!isDollars(styleValue) || (category === 'gift' && styleValue !== 0)) return fail('styleValue')
  if (typeof statEffects !== 'object' || statEffects === null) return fail('statEffects')
  const effects: Partial<Record<(typeof STAT_KEYS)[number], number>> = {}
  for (const [key, value] of Object.entries(statEffects)) {
    if (!oneOf(key, STAT_KEYS) || typeof value !== 'number' || !Number.isInteger(value)) {
      return fail(`statEffects.${key}`)
    }
    effects[key] = value
  }
  const base = {
    id,
    nameKey,
    descriptionKey,
    rarity,
    currency,
    price,
    sellValue,
    cloutValue,
    styleValue,
    statEffects: effects,
  } as const
  if (category === 'clothing' || category === 'makeup') {
    if (!oneOf<ItemSlot>(slot, ITEM_SLOTS)) return fail('slot')
    if ((category === 'makeup') !== (slot === 'face')) return fail('slot')
    return { ...base, category, slot, look: narrowLook(look, slot, fail) }
  }
  if (slot !== undefined) return fail('slot')
  if (look !== undefined) return fail('look')
  if (category === 'decor') {
    if (cloutValue !== 0) return fail('cloutValue')
    if (styleValue !== 0) return fail('styleValue')
    return { ...base, category, decor: narrowDecor(decor, fail) }
  }
  if (decor !== undefined) return fail('decor')
  return { ...base, category }
}

function narrowLook(raw: unknown, slot: ItemSlot, fail: (field: string) => never): ItemLook {
  if (typeof raw !== 'object' || raw === null) return fail('look')
  const look = raw as Record<string, unknown>
  const id = (key: string) => {
    const value = look[key]
    return typeof value === 'string' && value.length > 0 ? value : fail(`look.${key}`)
  }
  if (look.part !== SLOT_LOOK_PART[slot]) return fail('look.part')
  switch (look.part) {
    case 'outfit':
      return { part: 'outfit', outfit: id('outfit'), top: id('top') }
    case 'bottom':
      return { part: 'bottom', color: id('color') }
    case 'shoes':
      return { part: 'shoes', color: id('color') }
    case 'attachment':
      return { part: 'attachment', model: id('model') }
    default:
      return { part: 'none' }
  }
}

function narrowDecor(raw: unknown, fail: (field: string) => never): DecorDef['decor'] {
  if (typeof raw !== 'object' || raw === null) return fail('decor')
  const { fits, homeScore, variants, footprint, layer, category, luxury, starter } = raw as Record<
    string,
    unknown
  >
  if (!oneOf<DecorFit>(fits, DECOR_FITS)) return fail('decor.fits')
  const isStarter = starter === true
  if (starter !== undefined && !isStarter) return fail('decor.starter')
  if (!isDollars(homeScore) || (homeScore === 0) !== isStarter) return fail('decor.homeScore')
  const shape = footprint ?? '1x1'
  if (!oneOf<GridFootprint>(shape, FOOTPRINTS) || (fits === 'wall' && shape !== '1x1')) {
    return fail('decor.footprint')
  }
  if (layer !== undefined && (layer !== 'rug' || fits !== 'floor')) return fail('decor.layer')
  if (!oneOf<DecorCategory>(category, DECOR_CATEGORIES)) return fail('decor.category')
  if (luxury !== undefined && luxury !== true) return fail('decor.luxury')
  if (!Array.isArray(variants) || variants.length < 1) return fail('decor.variants')
  const list = variants.map((variant: unknown, i): DecorVariant => {
    const { id, token, nameKey } = (variant ?? {}) as Record<string, unknown>
    if (typeof id !== 'string' || typeof token !== 'string' || typeof nameKey !== 'string') {
      return fail(`decor.variants[${i}]`)
    }
    return { id, token, nameKey }
  })
  if (new Set(list.map((variant) => variant.id)).size !== list.length) {
    return fail('decor.variants')
  }
  return {
    fits,
    footprint: shape,
    layer: layer === 'rug' ? 'rug' : 'furniture',
    category,
    luxury: luxury === true,
    starter: isStarter,
    homeScore,
    variants: list,
  }
}

/** The engine catalog from the items file's `items` array. Throws on a duplicate id. */
export function catalogFromJson(items: readonly RawItem[]): readonly ItemDef[] {
  const catalog = items.map(narrow)
  const ids = new Set(catalog.map((item) => item.id))
  if (ids.size !== catalog.length) throw new Error('data/items/items.json: duplicate item id')
  return catalog
}
