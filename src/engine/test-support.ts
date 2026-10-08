/**
 * Helpers for engine tests (not used by the game). Clout is derived from the ledger, so tests
 * that need a player at some clout build the ledger through these instead of setting a number.
 */
import { expect } from 'vitest'
import { cloutLevel, itemClout, legacyCloutState } from './clout'
import type { EngineConfig } from './config'
import { initialCreatorState, initialRolls } from './creator'
import type { GameSnapshot, PlayerState } from './game'
import { gridItem, gridPlacements, homeClout, layoutFor } from './home'
import { firstFit, type Turn } from './homeGrid'
import { findItem, isDecor } from './items'
import { buyAtShop, performPlaceAction, placeActions, shopBlock } from './placeActions'
import type { Place } from './places'

/**
 * `player` holding `total` clout: earned clout becomes one folded legacy entry (less what their
 * wearables and home already carry), and the level it lands on counts as reached (no level-up
 * for it).
 */
export function playerWithClout<P extends PlayerState>(
  player: P,
  total: number,
  config: EngineConfig,
): P {
  const earned = Math.max(0, total - itemClout(player, config) - homeClout(player, config))
  const clout = {
    ...legacyCloutState(earned, cloutLevel(total, config).index),
    firstPaycheckPaid: player.clout.firstPaycheckPaid,
  }
  return { ...player, clout }
}

/** `snapshot` with its player holding `total` clout (see `playerWithClout`). */
export function withClout(
  snapshot: GameSnapshot,
  total: number,
  config: EngineConfig,
): GameSnapshot {
  return { ...snapshot, player: playerWithClout(snapshot.player, total, config) }
}

/** `snapshot` with the player standing at the place `placeId` (DEC-22: its actions need them there). */
export function atPlace<S extends GameSnapshot>(snapshot: S, placeId: string): S {
  return { ...snapshot, player: { ...snapshot.player, location: { kind: 'place', placeId } } }
}

/**
 * The place rules as the player sees them standing at the place (DEC-22): for tests about a
 * place's own rules (hours, door, funds, limits), not about getting there.
 */
export function placeActionsHere(place: Place, snapshot: GameSnapshot, config: EngineConfig) {
  return placeActions(place, atPlace(snapshot, place.id), config)
}

/** `performPlaceAction` standing at the place (see `placeActionsHere`). */
export function performPlaceActionHere(
  snapshot: GameSnapshot,
  place: Place,
  actionId: string,
  config: EngineConfig,
) {
  return performPlaceAction(atPlace(snapshot, place.id), place, actionId, config)
}

/** `shopBlock` standing at the place (see `placeActionsHere`). */
export function shopBlockHere(place: Place, snapshot: GameSnapshot, config: EngineConfig) {
  return shopBlock(place, atPlace(snapshot, place.id), config)
}

/** `buyAtShop` standing at the place (see `placeActionsHere`). */
export function buyAtShopHere(
  snapshot: GameSnapshot,
  place: Place,
  itemId: string,
  config: EngineConfig,
) {
  return buyAtShop(atPlace(snapshot, place.id), place, itemId, config)
}

/**
 * The player fields save v12 (S16a) added. Tests that build an older save from a current one
 * delete them (and the top-level `creator` and `rolls`), as an older build never wrote them.
 */
export const V12_PLAYER_KEYS = [
  'look',
  'traits',
  'traitsChangedAt',
  'careerPath',
  'careerChangedAt',
  'neighborhood',
] as const

/**
 * What a migration to v12 gives an older save's player, for `toEqual`: a look (seeded from the
 * save; src/engine/save.v12.test.ts checks which), and no traits, career or neighborhood.
 */
export const V12_FRESH_PLAYER = {
  look: expect.any(Object) as unknown,
  traits: [],
  traitsChangedAt: null,
  careerPath: null,
  careerChangedAt: null,
  neighborhood: null,
} as const

/** What a migration to v12 adds at the top of an older save: a fresh creator and no rolls. */
export const V12_FRESH_SAVE = { creator: initialCreatorState, rolls: initialRolls } as const

/**
 * `snapshot` without the starter pieces a new game comes furnished with (S40): nothing owned
 * as decor, nothing placed. For tests about decor rules that want a bare room.
 */
export function unfurnished<S extends GameSnapshot>(snapshot: S): S {
  const { player } = snapshot
  return {
    ...snapshot,
    player: {
      ...player,
      inventory: { ...player.inventory, decor: [] },
      apartment: { ...player.apartment, placed: {} },
    },
  }
}

/**
 * The first free slot (and its facing turn) where owned or not-yet-owned `itemId` fits in the
 * player's home, by the movers' rule (src/engine/homeGrid.ts `firstFit`); throws when none does.
 */
export function freeSlot(
  player: Pick<PlayerState, 'home' | 'apartment' | 'inventory'>,
  itemId: string,
  config: EngineConfig,
): { readonly slotId: string; readonly turn: Turn } {
  const def = findItem(itemId, config)
  if (def === undefined || !isDecor(def)) throw new Error(`no decor ${itemId}`)
  const layout = layoutFor(player.home, config)
  const item = gridItem(def)
  const blocked =
    item.kind === 'wall' || item.layer === 'rug'
      ? layout.blocked
      : new Set([...layout.blocked, ...layout.walkway])
  const lookup = (id: string) => {
    const other = findItem(id, config)
    return other !== undefined && isDecor(other) ? gridItem(other) : undefined
  }
  const others = gridPlacements(player.apartment.placed, player.inventory).filter(
    (entry) => entry.itemId !== itemId,
  )
  const spot = firstFit(item, layout.size, blocked, others, lookup)
  if (spot === null) throw new Error(`no free spot for ${itemId} in ${player.home}`)
  return spot
}

/**
 * What a migration to v13 gives an older save (S40): its starter pieces, owned and set up by the
 * movers. Which cells they take depends on the home, so specs match the shape here and check
 * the pieces themselves in save.home.test.ts.
 */
export const V13_MIGRATED_INVENTORY = {
  wearables: [],
  gifts: [],
  outfit: {},
  decor: expect.any(Array) as unknown,
} as const
export const V13_MIGRATED_APARTMENT = {
  placed: expect.any(Object) as unknown,
  moveLog: [],
  wallPaint: null,
  floorFinish: null,
  finishes: [],
} as const
