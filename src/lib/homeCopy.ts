/**
 * Player-facing text for the apartment (S16): slot and colour names, the home score, placing and
 * moving notices, why a home is locked, and the engine's home errors. Built from engine data and
 * data/homes/interiors.json through the copy layer; money goes through `formatMoney` and counts
 * through `formatCount`, never literals.
 *
 * Client code: cell names and floor areas come from the engine's home layouts
 * (src/engine/config.ts), never through the classic-zod loader.
 */
import { homeScorePct } from '@/engine/career'
import { engineConfig, type EngineConfig, type HomeId } from '@/engine/config'
import { homeClout, homeScore, layoutFor, type HomeError, type HomeLock } from '@/engine/home'
import { parseSlot } from '@/engine/homeGrid'
import { moveInCost } from '@/engine/housing'
import { findItem, isDecor, type DecorDef, type DecorFit } from '@/engine/items'
import type { PlayerState } from '@/engine/game'
import { rentFor } from '@/engine/rent'
import type { Borough } from '@/lib/data/schemas/content'
import { copy as activeCopy, isCopyKey, type CopyFn, type CopyKey } from './copy'
import { cloutLevelName, homeName } from './economyCopy'
import { formatCount, formatMoney } from './format'
import { itemName } from './shopCopy'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/boroughs'
import '@/lib/copy/ns/colors'
import '@/lib/copy/ns/home'
import '@/lib/copy/ns/housing'

export interface HomeCopyOptions {
  readonly copy?: CopyFn
  readonly config?: EngineConfig
}

function requireKey(key: string, what: string): CopyKey {
  if (!isCopyKey(key)) throw new Error(`No copy key "${key}" for ${what}`)
  return key
}

/** `staten-island` → `statenIsland`, the copy-key segment for a kebab-case id. */
function camelSegment(id: string): string {
  return id.replace(/-([a-z0-9])/g, (_, next: string) => next.toUpperCase())
}

function decor(itemId: string, config: EngineConfig): DecorDef {
  const found = findItem(itemId, config)
  if (found === undefined || !isDecor(found)) {
    throw new Error(`data/items/items.json has no decor item "${itemId}"`)
  }
  return found
}

const KIND_KEYS = {
  wall: 'home.kind.wall.lower',
  floor: 'home.kind.floor.lower',
  surface: 'home.kind.surface.lower',
} as const satisfies Record<DecorFit, CopyKey>

/** A slot kind inside a sentence: "wall". */
export function decorKindWord(kind: DecorFit, { copy = activeCopy }: HomeCopyOptions = {}) {
  return copy(KIND_KEYS[kind])
}

const WALL_KEYS = {
  back: 'home.slot.wall.back',
  left: 'home.slot.wall.left',
  right: 'home.slot.wall.right',
} as const satisfies Record<'back' | 'left' | 'right', CopyKey>

/**
 * A cell's name in `home` (S40): "Floor spot C2" (columns lettered from the left wall, rows
 * numbered from the back) or "Left wall, spot 2" (spots numbered from the back or the left).
 */
export function slotName(home: HomeId, slotId: string, options: HomeCopyOptions = {}) {
  const { copy = activeCopy, config = engineConfig } = options
  const slot = parseSlot(slotId, layoutFor(home, config).size)
  if (slot === null) throw new Error(`${home} has no cell "${slotId}"`)
  if (slot.kind === 'floor') {
    return copy('home.slot.floor', {
      col: String.fromCharCode(65 + slot.c),
      row: formatCount(slot.r + 1),
    })
  }
  return copy(WALL_KEYS[slot.wall], { spot: formatCount(slot.i + 1) })
}

/** A decor colour variant's human name ("Hot pink"), never its hex or token (A11Y-1). */
export function variantName(itemId: string, variantId: string, options: HomeCopyOptions = {}) {
  const { copy = activeCopy, config = engineConfig } = options
  const variant = decor(itemId, config).decor.variants.find((entry) => entry.id === variantId)
  if (variant === undefined) throw new Error(`decor "${itemId}" has no variant "${variantId}"`)
  return copy(requireKey(variant.nameKey, `variant ${itemId}/${variantId}`))
}

/** "Home score 14: +14 clout", saying so when the home clout cap holds it. */
export function homeScoreLine(
  player: Pick<PlayerState, 'home' | 'inventory' | 'apartment' | 'careerPath'>,
  options: HomeCopyOptions = {},
): string {
  const { copy = activeCopy, config = engineConfig } = options
  const score = homeScore(player, config)
  const clout = homeClout(player, config)
  const vars = { score: formatCount(score), clout: formatCount(clout) }
  // Capped when the cap, not the score (with any career home bonus), sets the clout.
  const uncapped = Math.floor((score * homeScorePct(player, config)) / 100)
  return copy(uncapped > config.home.maxClout ? 'home.scoreCapped' : 'home.score', vars)
}

/** "Queens room, rent $280/wk". */
export function currentHomeLine(home: HomeId, options: HomeCopyOptions = {}): string {
  const { copy = activeCopy, config = engineConfig } = options
  return copy('home.current', {
    home: homeName(home, options),
    rent: formatMoney(rentFor(home, config)),
  })
}

export function variantChangedNotice(
  itemId: string,
  variantId: string,
  options: HomeCopyOptions = {},
) {
  const { copy = activeCopy } = options
  return copy('home.variant.changed', {
    item: itemName(itemId, options),
    color: variantName(itemId, variantId, options),
  })
}

/** A home's floor in square metres (whole), from its grid. */
function floorArea(home: HomeId, config: EngineConfig): number {
  const { size, cellM: cell } = layoutFor(home, config)
  return Math.round(size.cols * size.rows * cell * cell)
}

function moveVars(home: HomeId, options: HomeCopyOptions) {
  const { config = engineConfig } = options
  return {
    home: homeName(home, options),
    cost: formatMoney(moveInCost(home, config)),
    rent: formatMoney(rentFor(home, config)),
    slots: formatCount(floorArea(home, config)),
  }
}

/** "Move-in $400, rent $520/wk, 5 slots": the numbers under a home in the Move list. */
export function moveDetails(home: HomeId, options: HomeCopyOptions = {}): string {
  const { copy = activeCopy } = options
  return copy('home.move.details', moveVars(home, options))
}

export function moveButtonText(home: HomeId, options: HomeCopyOptions = {}): string {
  const { copy = activeCopy } = options
  return copy('home.move.button', { home: homeName(home, options) })
}

/** The accessible name of an open home's Move button, with its cost, rent and slot count. */
export function moveLabel(home: HomeId, options: HomeCopyOptions = {}): string {
  const { copy = activeCopy } = options
  return copy('home.move.label', moveVars(home, options))
}

/** The confirmation step's question, with what the move costs and changes. */
export function moveConfirmText(home: HomeId, options: HomeCopyOptions = {}): string {
  const { copy = activeCopy } = options
  return copy('home.move.confirm', moveVars(home, options))
}

export function movedNotice(home: HomeId, options: HomeCopyOptions = {}): string {
  const { copy = activeCopy } = options
  return copy('home.move.done', moveVars(home, options))
}

function boroughName(borough: Borough, { copy = activeCopy }: HomeCopyOptions) {
  return copy(requireKey(`boroughs.${camelSegment(borough)}.name`, `borough ${borough}`))
}

/** Why a home is locked, in voice where the slang pack has it. */
export function homeLockReason(lock: HomeLock, options: HomeCopyOptions = {}): string {
  const { copy = activeCopy } = options
  switch (lock.code) {
    case 'CURRENT_HOME':
      return copy('home.lock.current')
    case 'FUNDS_SHORT':
      return copy('home.lock.funds', {
        required: formatMoney(lock.required),
        available: formatMoney(lock.available),
      })
    case 'BOROUGH_LOCKED': {
      if (lock.access.status === 'expanding-soon') {
        return copy('home.lock.soon', { borough: boroughName(lock.borough, options) })
      }
      const vars = {
        borough: boroughName(lock.borough, options),
        level: cloutLevelName(lock.access.required, options),
        current: cloutLevelName(lock.access.current, options),
      }
      // A home with its own line ("Manhattan loft? On bodega money? ...") uses it.
      const ownKey = `home.lock.${camelSegment(lock.home)}`
      return copy(isCopyKey(ownKey) ? ownKey : 'home.lock.borough', vars)
    }
  }
}

/**
 * A locked home's accessible name: "{home}. {reason}" (A11Y-2), so a screen reader hears why
 * before it hears that the button is unavailable.
 */
export function homeLockName(lock: HomeLock, options: HomeCopyOptions = {}): string {
  const { copy = activeCopy } = options
  return copy('home.lock.name', {
    home: homeName(lock.home, options),
    reason: homeLockReason(lock, options),
  })
}

/**
 * The player-facing text for an engine home error. The panel offers only what the engine
 * allows, so these show only when the state moved under it (a sale in another tab, a reload).
 */
export function homeErrorText(error: HomeError, options: HomeCopyOptions = {}): string {
  const { copy = activeCopy, config = engineConfig } = options
  switch (error.code) {
    case 'UNKNOWN_ITEM':
      return copy('home.error.unknownItem')
    case 'NOT_DECOR':
      return copy('home.error.notDecor')
    case 'NOT_OWNED':
      return copy('home.error.notOwned')
    case 'UNKNOWN_SLOT':
      return copy('home.error.unknownSlot')
    case 'WRONG_SLOT_KIND':
      return copy('home.error.wrongKind', {
        item: findItem(error.itemId, config) === undefined ? '' : itemName(error.itemId, options),
        fits: decorKindWord(error.fits, options),
        kind: decorKindWord(error.kind, options),
      })
    case 'NO_ROOM': {
      const item =
        findItem(error.itemId, config) === undefined ? '' : itemName(error.itemId, options)
      switch (error.reason) {
        case 'off-grid':
          return copy('home.error.noRoom.offGrid', { item })
        case 'blocked':
          return copy('home.error.noRoom.blocked')
        case 'occupied':
          return copy('home.error.noRoom.occupied')
      }
      break
    }
    case 'NO_ROOM_TO_TURN':
      return copy('home.error.noRoomToTurn', {
        item: findItem(error.itemId, config) === undefined ? '' : itemName(error.itemId, options),
      })
    case 'UNKNOWN_FINISH':
      return copy('home.error.unknownFinish')
    case 'FINISH_FUNDS_SHORT':
      return copy('home.error.finishFunds', {
        required: formatMoney(error.required),
        available: formatMoney(error.available),
      })
    case 'UNKNOWN_VARIANT':
      return copy('home.error.unknownVariant')
    case 'UNKNOWN_HOME':
      return copy('home.error.unknownHome')
    case 'CURRENT_HOME':
    case 'BOROUGH_LOCKED':
    case 'FUNDS_SHORT':
      return homeLockReason(error, options)
  }
}
