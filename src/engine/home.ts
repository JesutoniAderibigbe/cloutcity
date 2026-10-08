/**
 * The apartment (S16, S40 buy mode 2.0): decor placed on the home's grid, the home score it adds
 * up to, wall paint and floor finishes, luxury upkeep, and moving home. Pure functions over a
 * GameSnapshot; nothing here moves the clock.
 *
 * Rules:
 * - Each home has a placement grid (data/homes/interiors.json, src/engine/homeGrid.ts): floor
 *   cells and wall cells. A wall item hangs on one free wall cell; a floor or surface item covers
 *   its footprint (1×1, 2×1 or 2×2) of floor cells, turned by quarter turns. `placed` maps the
 *   footprint's back-left cell (or the wall cell) to the item; the turn lives on the owned item
 *   (`OwnedDecor.turn`). Cells the home blocks never take an item; the walkway (the avatar's
 *   spot, the way in from the door) refuses furniture but a rug may cover it. Furniture may stand
 *   on a rug; two rugs, or two pieces of furniture, may not share a cell.
 * - Placing an item already placed moves it (from its old cells); placing never displaces
 *   anything: a spot another item covers is refused (OCCUPIED), so nothing silently goes to storage.
 * - Home score = the home's `home.baseScore` plus the `homeScore` of every owned decor item
 *   placed there. Home clout is that score capped at `home.maxClout`. Both are computed from the
 *   save, never accumulated, so a place/remove, move/rotate or buy/place/sell loop cannot farm
 *   clout, and no ledger entry is written for them. Decor kept through prestige is a look only:
 *   placed, it adds nothing (DEC-14). Starter pieces add nothing either (score 0).
 * - Placing, removing and moving change clout, so each settles the level (`settleLevel`) and
 *   reports a level-up that lifts the player above their peak; turning an item or choosing a
 *   colour variant changes only looks.
 * - Wall paint and floor finishes (data/homes/finishes.json) are looks only: no home score. The
 *   home's original finishes are free there; any other finish is bought once (its price in
 *   cash) and is the player's to apply again in any home at no cost. Trying one on is the UI's
 *   (nothing in the save changes until `applyFinish`). Moving home starts on the new home's
 *   originals; owned finishes are kept.
 * - Luxury decor (rare) costs `home.upkeepPctPerWeek` of its price every rent week while owned
 *   (src/engine/rent.ts charges it with the rent): a cash sink.
 * - Moving home (`moveHome`) is instant. It is refused, in this order, when the home is the
 *   current one, when its borough is not open at the player's level (src/engine/boroughs.ts),
 *   and when the player cannot afford it (src/engine/housing.ts `canAffordMove`: cash after the
 *   rent reserve must cover the move-in cost). The move-in cost is paid and the movers carry the
 *   furniture over (`placementsAfterMove`): what fits where it stood stays there, the rest is set
 *   up in the first free spot, and what fits nowhere goes to storage. The move is appended to
 *   `apartment.moveLog` (newest last, at most `home.moveLogMax`) for save plausibility (SEC-11).
 */
import { HOME_BOROUGHS } from '@/lib/data/homes'
import type { Borough } from '@/lib/data/schemas/content'
import { boroughAccess, type BoroughAccess } from './boroughs'
import { homeScorePct } from './career'
import { levelClout, settleLevel, type LevelUp } from './clout'
import {
  isHomeId,
  type EngineConfig,
  type FinishDef,
  type HomeId,
  type HomeLayout,
  type SlotDef,
} from './config'
import type { GameSnapshot, PlayerState } from './game'
import {
  facingTurn,
  firstFit,
  fitRefusal,
  footprintSize,
  gridSlots,
  nextTurn,
  parseSlot,
  type GridItem,
  type GridPlacement,
  type GridRefusal,
  type Turn,
} from './homeGrid'
import { canAffordMove, moveInCost, rentReserve } from './housing'
import {
  findItem,
  isDecor,
  isPrestigeKept,
  type DecorDef,
  type DecorFit,
  type Inventory,
  type OwnedDecor,
} from './items'

/** Slot id (a grid cell) → the decor item placed there. */
export type Placements = Readonly<Record<string, string>>

/** One move, as the save keeps it. */
export interface MoveRecord {
  readonly from: HomeId
  readonly to: HomeId
  /** Personal-clock minute of the move. */
  readonly at: number
  /** Whole dollars paid (the move-in cost). */
  readonly cost: number
}

export interface ApartmentState {
  /** What is placed on the current home's grid. Every entry names owned decor. */
  readonly placed: Placements
  /** Moves made with `moveHome`, oldest first, at most `home.moveLogMax`. */
  readonly moveLog: readonly MoveRecord[]
  /** The wall paint and floor finish shown (finish ids), or null for the home's originals. */
  readonly wallPaint: string | null
  readonly floorFinish: string | null
  /** Finishes bought (S40), each once, in the order bought. */
  readonly finishes: readonly string[]
}

export const initialApartment: ApartmentState = {
  placed: {},
  moveLog: [],
  wallPaint: null,
  floorFinish: null,
  finishes: [],
}

/** What home clout reads: the home, its decor and the career path (an artist/DJ's home bonus). */
export type HomePlayer = Pick<PlayerState, 'home' | 'inventory' | 'apartment' | 'careerPath'>

/** Why a home is locked to the player right now. */
export type HomeLock =
  /** The player already lives there. */
  | { readonly code: 'CURRENT_HOME'; readonly home: HomeId }
  /** Its borough is not open at the player's level (or is expanding soon). */
  | {
      readonly code: 'BOROUGH_LOCKED'
      readonly home: HomeId
      readonly borough: Borough
      readonly access: Exclude<BoroughAccess, { readonly status: 'open' }>
    }
  /** Cash after the rent reserve does not cover the move-in cost. */
  | {
      readonly code: 'FUNDS_SHORT'
      readonly home: HomeId
      /** The rent reserve plus the move-in cost. */
      readonly required: number
      readonly available: number
    }

export type HomeError =
  | { readonly code: 'UNKNOWN_ITEM'; readonly itemId: string }
  | { readonly code: 'NOT_DECOR'; readonly itemId: string }
  | { readonly code: 'NOT_OWNED'; readonly itemId: string }
  /** The current home has no slot with this id. */
  | { readonly code: 'UNKNOWN_SLOT'; readonly slotId: string }
  /** A wall item on the floor or a floor item on a wall. */
  | {
      readonly code: 'WRONG_SLOT_KIND'
      readonly itemId: string
      readonly slotId: string
      readonly fits: DecorFit
      readonly kind: SlotDef['kind']
    }
  /** The footprint runs off the grid, onto a cell the home keeps free, or onto another item. */
  | {
      readonly code: 'NO_ROOM'
      readonly itemId: string
      readonly slotId: string
      readonly reason: Exclude<GridRefusal, 'wrong-kind'>
    }
  /** No quarter turn fits where the item stands. */
  | { readonly code: 'NO_ROOM_TO_TURN'; readonly itemId: string }
  | { readonly code: 'UNKNOWN_VARIANT'; readonly itemId: string; readonly variantId: string }
  | { readonly code: 'UNKNOWN_FINISH'; readonly finishId: string }
  | { readonly code: 'FINISH_FUNDS_SHORT'; readonly required: number; readonly available: number }
  | { readonly code: 'UNKNOWN_HOME'; readonly home: string }
  | HomeLock

export type HomeResult<Extra = object> =
  | ({ readonly ok: true; readonly snapshot: GameSnapshot } & Extra)
  | { readonly ok: false; readonly error: HomeError }

export function layoutFor(home: HomeId, config: EngineConfig): HomeLayout {
  return config.home.layouts[home]
}

const slotLists = new WeakMap<HomeLayout, readonly SlotDef[]>()

/** The placement cells of `home`: floor cells from the back row, then each wall's cells. */
export function slotsFor(home: HomeId, config: EngineConfig): readonly SlotDef[] {
  const layout = layoutFor(home, config)
  let slots = slotLists.get(layout)
  if (slots === undefined) {
    slots = gridSlots(layout.size)
    slotLists.set(layout, slots)
  }
  return slots
}

function decorDef(itemId: string, config: EngineConfig): DecorDef | undefined {
  const item = findItem(itemId, config)
  return item !== undefined && isDecor(item) ? item : undefined
}

/** How the grid sees a decor item. */
export function gridItem(def: DecorDef): GridItem {
  return {
    kind: def.decor.fits === 'wall' ? 'wall' : 'floor',
    footprint: def.decor.footprint,
    layer: def.decor.layer,
  }
}

const itemLookup = (config: EngineConfig) => (itemId: string) => {
  const def = decorDef(itemId, config)
  return def === undefined ? undefined : gridItem(def)
}

/** An owned item's turn (0 when it was never turned). */
export function decorTurn(owned: Pick<OwnedDecor, 'turn'> | undefined): Turn {
  return owned?.turn ?? 0
}

/** The placements as the grid sees them, with each item's turn from the inventory. */
export function gridPlacements(placed: Placements, inventory: Inventory): GridPlacement[] {
  const turns = new Map(inventory.decor.map((owned) => [owned.itemId, decorTurn(owned)]))
  return Object.entries(placed).map(([slotId, itemId]) => ({
    itemId,
    slotId,
    turn: turns.get(itemId) ?? 0,
  }))
}

/** The cells the home keeps from `item`: everything blocked, and the walkway for furniture. */
function blockedFor(layout: HomeLayout, item: GridItem): ReadonlySet<string> {
  if (item.kind === 'wall' || item.layer === 'rug') return layout.blocked
  return new Set([...layout.blocked, ...layout.walkway])
}

/**
 * Why `itemId` cannot stand at `slotId` turned `turn` in `home` among `placed` (the item itself
 * left out), or null when it fits.
 */
export function placementRefusal(
  home: HomeId,
  placed: Placements,
  inventory: Inventory,
  itemId: string,
  slotId: string,
  turn: Turn,
  config: EngineConfig,
): GridRefusal | null {
  const def = decorDef(itemId, config)
  if (def === undefined) return 'wrong-kind'
  const layout = layoutFor(home, config)
  const item = gridItem(def)
  const others = gridPlacements(placed, inventory).filter((entry) => entry.itemId !== itemId)
  return fitRefusal(
    slotId,
    item,
    turn,
    layout.size,
    blockedFor(layout, item),
    others,
    itemLookup(config),
  )
}

/** Owned decor ids that still count toward the home score (not kept through prestige). */
function countingDecor(inventory: Inventory): ReadonlySet<string> {
  return new Set(
    inventory.decor.filter((owned) => owned.prestigeKept !== true).map((owned) => owned.itemId),
  )
}

/** The home's base score plus the `homeScore` of every counting decor item placed there. */
export function homeScore(player: HomePlayer, config: EngineConfig): number {
  const counting = countingDecor(player.inventory)
  return Object.values(player.apartment.placed).reduce((score, itemId) => {
    if (!counting.has(itemId)) return score
    return score + (decorDef(itemId, config)?.decor.homeScore ?? 0)
  }, config.home.baseScore[player.home])
}

/** The clout the home adds: its score, capped at `home.maxClout`. */
export function homeClout(player: HomePlayer, config: EngineConfig): number {
  const score = Math.floor((homeScore(player, config) * homeScorePct(player, config)) / 100)
  return Math.min(config.home.maxClout, score)
}

/** Whole dollars of upkeep one luxury item costs per rent week (0 for any other item). */
export function itemUpkeep(def: DecorDef, config: EngineConfig): number {
  return def.decor.luxury ? Math.ceil((def.price * config.home.upkeepPctPerWeek) / 100) : 0
}

/** Whole dollars of upkeep the player's luxury decor costs per rent week (kept looks aside). */
export function weeklyUpkeep(player: Pick<PlayerState, 'inventory'>, config: EngineConfig): number {
  return player.inventory.decor.reduce((sum, owned) => {
    if (isPrestigeKept(owned)) return sum
    const def = decorDef(owned.itemId, config)
    return def === undefined ? sum : sum + itemUpkeep(def, config)
  }, 0)
}

function withApartment(
  snapshot: GameSnapshot,
  apartment: ApartmentState,
  patch: Partial<PlayerState> = {},
): PlayerState {
  return { ...snapshot.player, ...patch, apartment }
}

/** Settles the level after a home change and returns the snapshot with it. */
function settled(snapshot: GameSnapshot, player: PlayerState, config: EngineConfig) {
  const result = settleLevel(player, snapshot.clock.minute, 'home', config)
  return {
    ok: true as const,
    snapshot: { ...snapshot, player: result.player },
    levelUp: result.levelUp,
  }
}

/** `placed` without `itemId` in any slot. */
export function withoutItem(placed: Placements, itemId: string): Placements {
  return Object.fromEntries(Object.entries(placed).filter(([, placedId]) => placedId !== itemId))
}

/** The slot `itemId` is placed in, or null when it is in storage. */
export function slotOf(placed: Placements, itemId: string): string | null {
  return Object.entries(placed).find(([, placedId]) => placedId === itemId)?.[0] ?? null
}

function withTurn(inventory: Inventory, itemId: string, turn: Turn): Inventory {
  return {
    ...inventory,
    decor: inventory.decor.map((owned): OwnedDecor => {
      if (owned.itemId !== itemId) return owned
      // A turn of 0 is left out, as the save writes it.
      const base: OwnedDecor = {
        itemId: owned.itemId,
        acquiredMinute: owned.acquiredMinute,
        variant: owned.variant,
        ...(owned.prestigeKept === true ? { prestigeKept: true as const } : {}),
      }
      return turn === 0 ? base : { ...base, turn }
    }),
  }
}

/** The turn that faces an item placed at `slotId` into the room (0 for a wall item). */
export function defaultTurn(
  home: HomeId,
  slotId: string,
  def: DecorDef,
  config: EngineConfig,
): Turn {
  const { size } = layoutFor(home, config)
  const slot = parseSlot(slotId, size)
  if (slot === null || slot.kind === 'wall') return 0
  const { w, d } = footprintSize(def.decor.footprint, 0)
  return facingTurn(slot.c, slot.r, w, d, size)
}

/**
 * Places owned decor at a slot of the current home turned `turn` (the item's own turn when
 * omitted), or moves it there when it is already placed. Refused when the footprint does not fit
 * (see the module comment); nothing else moves.
 */
export function placeDecor(
  snapshot: GameSnapshot,
  itemId: string,
  slotId: string,
  config: EngineConfig,
  turn?: Turn,
): HomeResult<{ readonly levelUp: LevelUp | null }> {
  const item = findItem(itemId, config)
  if (item === undefined) return { ok: false, error: { code: 'UNKNOWN_ITEM', itemId } }
  if (!isDecor(item)) return { ok: false, error: { code: 'NOT_DECOR', itemId } }
  const { player } = snapshot
  const owned = player.inventory.decor.find((entry) => entry.itemId === itemId)
  if (owned === undefined) return { ok: false, error: { code: 'NOT_OWNED', itemId } }
  const layout = layoutFor(player.home, config)
  const slot = parseSlot(slotId, layout.size)
  if (slot === null) return { ok: false, error: { code: 'UNKNOWN_SLOT', slotId } }
  const placeTurn = turn ?? decorTurn(owned)
  const refusal = placementRefusal(
    player.home,
    player.apartment.placed,
    player.inventory,
    itemId,
    slotId,
    placeTurn,
    config,
  )
  if (refusal === 'wrong-kind') {
    return {
      ok: false,
      error: { code: 'WRONG_SLOT_KIND', itemId, slotId, fits: item.decor.fits, kind: slot.kind },
    }
  }
  if (refusal !== null) {
    return { ok: false, error: { code: 'NO_ROOM', itemId, slotId, reason: refusal } }
  }
  const placed = { ...withoutItem(player.apartment.placed, itemId), [slotId]: itemId }
  const inventory = withTurn(player.inventory, itemId, placeTurn)
  return settled(
    snapshot,
    withApartment(snapshot, { ...player.apartment, placed }, { inventory }),
    config,
  )
}

/**
 * Turns owned decor a quarter turn (clockwise seen from above). A placed item takes the next turn
 * that fits where it stands (NO_ROOM_TO_TURN when none does); a wall item never turns. Looks only.
 */
export function rotateDecor(
  snapshot: GameSnapshot,
  itemId: string,
  config: EngineConfig,
): HomeResult {
  const item = findItem(itemId, config)
  if (item === undefined) return { ok: false, error: { code: 'UNKNOWN_ITEM', itemId } }
  if (!isDecor(item)) return { ok: false, error: { code: 'NOT_DECOR', itemId } }
  const { player } = snapshot
  const owned = player.inventory.decor.find((entry) => entry.itemId === itemId)
  if (owned === undefined) return { ok: false, error: { code: 'NOT_OWNED', itemId } }
  if (item.decor.fits === 'wall') return { ok: false, error: { code: 'NO_ROOM_TO_TURN', itemId } }
  const slotId = slotOf(player.apartment.placed, itemId)
  let turn = nextTurn(decorTurn(owned))
  if (slotId !== null) {
    const fits = (candidate: Turn) =>
      placementRefusal(
        player.home,
        player.apartment.placed,
        player.inventory,
        itemId,
        slotId,
        candidate,
        config,
      ) === null
    let tries = 0
    while (!fits(turn) && tries < 3) {
      turn = nextTurn(turn)
      tries += 1
    }
    if (tries === 3 || turn === decorTurn(owned)) {
      return { ok: false, error: { code: 'NO_ROOM_TO_TURN', itemId } }
    }
  }
  const inventory = withTurn(player.inventory, itemId, turn)
  return { ok: true, snapshot: { ...snapshot, player: { ...player, inventory } } }
}

/** Takes whatever is in a slot of the current home back to storage (a no-op when it is empty). */
export function removeDecor(
  snapshot: GameSnapshot,
  slotId: string,
  config: EngineConfig,
): HomeResult<{ readonly levelUp: LevelUp | null }> {
  const { player } = snapshot
  if (parseSlot(slotId, layoutFor(player.home, config).size) === null) {
    return { ok: false, error: { code: 'UNKNOWN_SLOT', slotId } }
  }
  if (!Object.hasOwn(player.apartment.placed, slotId)) return { ok: true, snapshot, levelUp: null }
  const placed = Object.fromEntries(
    Object.entries(player.apartment.placed).filter(([id]) => id !== slotId),
  )
  return settled(snapshot, withApartment(snapshot, { ...player.apartment, placed }), config)
}

/** Shows owned decor in another of its colour variants (looks only: no clout change). */
export function setDecorVariant(
  snapshot: GameSnapshot,
  itemId: string,
  variantId: string,
  config: EngineConfig,
): HomeResult {
  const item = findItem(itemId, config)
  if (item === undefined) return { ok: false, error: { code: 'UNKNOWN_ITEM', itemId } }
  if (!isDecor(item)) return { ok: false, error: { code: 'NOT_DECOR', itemId } }
  const { inventory } = snapshot.player
  if (!inventory.decor.some((owned) => owned.itemId === itemId)) {
    return { ok: false, error: { code: 'NOT_OWNED', itemId } }
  }
  if (!item.decor.variants.some((variant) => variant.id === variantId)) {
    return { ok: false, error: { code: 'UNKNOWN_VARIANT', itemId, variantId } }
  }
  const decor = inventory.decor.map((owned) =>
    owned.itemId === itemId ? { ...owned, variant: variantId } : owned,
  )
  return {
    ok: true,
    snapshot: { ...snapshot, player: { ...snapshot.player, inventory: { ...inventory, decor } } },
  }
}

export function findFinish(finishId: string, config: EngineConfig): FinishDef | undefined {
  return config.home.finishes.find((finish) => finish.id === finishId)
}

/** The wall paint or floor finish the current home shows (its original when none is applied). */
export function currentFinish(
  player: Pick<PlayerState, 'home' | 'apartment'>,
  kind: FinishDef['kind'],
  config: EngineConfig,
): string {
  const shell = layoutFor(player.home, config).shell
  return kind === 'wall'
    ? (player.apartment.wallPaint ?? shell.wallPaint)
    : (player.apartment.floorFinish ?? shell.floorFinish)
}

/** Whether applying `finish` here is free: it is the home's original or the player owns it. */
export function finishFree(
  player: Pick<PlayerState, 'home' | 'apartment'>,
  finish: FinishDef,
  config: EngineConfig,
): boolean {
  const shell = layoutFor(player.home, config).shell
  const original = finish.kind === 'wall' ? shell.wallPaint : shell.floorFinish
  return finish.id === original || player.apartment.finishes.includes(finish.id)
}

/**
 * Puts a wall paint or floor finish on the current home: free when it is the home's original or
 * owned, otherwise bought first for its price (FINISH_FUNDS_SHORT when short; nothing changes).
 */
export function applyFinish(
  snapshot: GameSnapshot,
  finishId: string,
  config: EngineConfig,
): HomeResult<{ readonly cost: number }> {
  const finish = findFinish(finishId, config)
  if (finish === undefined) return { ok: false, error: { code: 'UNKNOWN_FINISH', finishId } }
  const { player } = snapshot
  const free = finishFree(player, finish, config)
  const cost = free ? 0 : finish.price
  if (player.cash < cost) {
    return {
      ok: false,
      error: { code: 'FINISH_FUNDS_SHORT', required: cost, available: player.cash },
    }
  }
  const shell = layoutFor(player.home, config).shell
  const original = finish.kind === 'wall' ? shell.wallPaint : shell.floorFinish
  const shown = finish.id === original ? null : finish.id
  const apartment: ApartmentState = {
    ...player.apartment,
    ...(finish.kind === 'wall' ? { wallPaint: shown } : { floorFinish: shown }),
    finishes: free ? player.apartment.finishes : [...player.apartment.finishes, finish.id],
  }
  return {
    ok: true,
    snapshot: { ...snapshot, player: { ...player, cash: player.cash - cost, apartment } },
    cost,
  }
}

/**
 * What the movers set up in `to` (moving, eviction, prestige): every placed item that fits where
 * it stood stays there (in slot order), the rest go to the first spot that fits (facing into the
 * room), and what fits nowhere goes back to storage. Deterministic. Returns the placements and the
 * inventory with any new turns.
 */
export function placementsAfterMove(
  player: Pick<PlayerState, 'apartment' | 'inventory'>,
  to: HomeId,
  config: EngineConfig,
): { readonly placed: Placements; readonly inventory: Inventory } {
  const layout = layoutFor(to, config)
  const lookup = itemLookup(config)
  let inventory = player.inventory
  const kept: GridPlacement[] = []
  const later: GridPlacement[] = []
  const entries = gridPlacements(player.apartment.placed, player.inventory).sort((a, b) =>
    a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0,
  )
  for (const entry of entries) {
    const item = lookup(entry.itemId)
    if (item === undefined) continue
    const refusal = fitRefusal(
      entry.slotId,
      item,
      entry.turn,
      layout.size,
      blockedFor(layout, item),
      kept,
      lookup,
    )
    if (refusal === null) kept.push(entry)
    else later.push(entry)
  }
  for (const entry of later) {
    const item = lookup(entry.itemId)
    if (item === undefined) continue
    const spot = firstFit(item, layout.size, blockedFor(layout, item), kept, lookup)
    if (spot === null) continue
    kept.push({ itemId: entry.itemId, slotId: spot.slotId, turn: spot.turn })
    inventory = withTurn(inventory, entry.itemId, spot.turn)
  }
  return {
    placed: Object.fromEntries(kept.map((entry) => [entry.slotId, entry.itemId])),
    inventory,
  }
}

/**
 * A new game's starter pieces (data/homes/interiors.json `starter` of the start home): owned at
 * `minute` in their first colour, placed where the data puts them.
 */
export function starterFurnishing(
  home: HomeId,
  minute: number,
  config: EngineConfig,
): { readonly decor: readonly OwnedDecor[]; readonly placed: Placements } {
  const decor: OwnedDecor[] = []
  const placed: Record<string, string> = {}
  for (const entry of layoutFor(home, config).starter) {
    const def = decorDef(entry.itemId, config)
    if (def === undefined) throw new Error(`starter piece "${entry.itemId}" is not decor`)
    const variant = def.decor.variants[0]?.id ?? ''
    decor.push({
      itemId: def.id,
      acquiredMinute: minute,
      variant,
      ...(entry.turn === 0 ? {} : { turn: entry.turn }),
    })
    placed[entry.slotId] = def.id
  }
  return { decor, placed }
}

/**
 * Sets `pieces` up in `home` one by one, each where it asks to stand when that fits, else in the
 * first spot that fits, else left in storage. Placements already there stay.
 */
export function furnishWith(
  player: Pick<PlayerState, 'apartment' | 'inventory'>,
  home: HomeId,
  pieces: readonly { readonly itemId: string; readonly slotId: string; readonly turn: Turn }[],
  config: EngineConfig,
): { readonly placed: Placements; readonly inventory: Inventory } {
  const layout = layoutFor(home, config)
  const lookup = itemLookup(config)
  let placed: Record<string, string> = { ...player.apartment.placed }
  let inventory = player.inventory
  for (const piece of pieces) {
    const item = lookup(piece.itemId)
    if (item === undefined || Object.values(placed).includes(piece.itemId)) continue
    const others = gridPlacements(placed, inventory)
    const blocked = blockedFor(layout, item)
    const spot =
      fitRefusal(piece.slotId, item, piece.turn, layout.size, blocked, others, lookup) === null
        ? { slotId: piece.slotId, turn: piece.turn }
        : firstFit(item, layout.size, blocked, others, lookup)
    if (spot === null) continue
    placed = { ...placed, [spot.slotId]: piece.itemId }
    inventory = withTurn(inventory, piece.itemId, spot.turn)
  }
  return { placed, inventory }
}

/** Why the player cannot move into `to` right now, or null when they can (see the module comment). */
export function homeLock(player: PlayerState, to: HomeId, config: EngineConfig): HomeLock | null {
  if (to === player.home) return { code: 'CURRENT_HOME', home: to }
  const borough = HOME_BOROUGHS[to]
  const access = boroughAccess(borough, levelClout(player, config), config)
  if (access.status !== 'open') return { code: 'BOROUGH_LOCKED', home: to, borough, access }
  if (!canAffordMove(player, to, config)) {
    return {
      code: 'FUNDS_SHORT',
      home: to,
      required: rentReserve(player, config) + moveInCost(to, config),
      available: player.cash,
    }
  }
  return null
}

/** Moves into `to` at once, paying its move-in cost (see the module comment). */
export function moveHome(
  snapshot: GameSnapshot,
  to: string,
  config: EngineConfig,
): HomeResult<{ readonly cost: number; readonly levelUp: LevelUp | null }> {
  if (!isHomeId(to, config)) return { ok: false, error: { code: 'UNKNOWN_HOME', home: to } }
  const { player } = snapshot
  const lock = homeLock(player, to, config)
  if (lock !== null) return { ok: false, error: lock }
  const cost = moveInCost(to, config)
  const move: MoveRecord = { from: player.home, to, at: snapshot.clock.minute, cost }
  const moved = placementsAfterMove(player, to, config)
  const apartment: ApartmentState = {
    ...player.apartment,
    placed: moved.placed,
    moveLog: [...player.apartment.moveLog, move].slice(-config.home.moveLogMax),
    wallPaint: null,
    floorFinish: null,
  }
  const next = withApartment(snapshot, apartment, {
    cash: player.cash - cost,
    home: to,
    inventory: moved.inventory,
  })
  return { ...settled(snapshot, next, config), cost }
}
