'use client'

/**
 * Buy mode 2.0 (S40): everything about the furniture in the Home panel, in its own lazy chunk
 * (`cc-feature:home-decor`, left out of the precache, PERF-7).
 *
 * - "Your place": every item in the room (where it stands, Move, Turn, Store; selected, its
 *   colours and Sell at its depreciated resale value, with a confirm step) and in storage
 *   (Place, Sell). Starter pieces store but never sell.
 * - "Buy mode": the catalogue by category (thumbnail, footprint, rarity, price, luxury upkeep) and
 *   Design: wall paints and floors to try on for free before buying; what is bought stays owned.
 * - Placing (a bought item, one from storage, or one being moved) shows the grid in the room and a
 *   placement bar: arrow buttons or arrow keys move it a cell, Turn or R turns it, Place here or
 *   Enter puts it down where it fits, Escape cancels; a tap on a cell in the room moves it there
 *   and a second tap on the same cell places it (A11Y-3). The bar says where it is, which way it
 *   faces and why it does not fit.
 *
 * It drives the 3D room's view (src/state/apartmentView.ts) while loaded: the room as it stands
 * plus the held item at its preview spot, the grid, and a finish being tried on. Every change
 * goes through the store to the engine, which re-checks it; results show in the panel's status
 * line (`onStatus`).
 */
import themeJson from '@data/config/theme.json'
import finishesJson from '@data/homes/finishes.json'
import thumbsJson from '@data/items/thumbs.derived.json'
import looksJson from '@data/items/looks.json'
import { useEffect, useMemo, useRef, useState } from 'react'
import { resaleBonusPts } from '@/engine/career'
import { engineConfig, type FinishDef } from '@/engine/config'
import {
  currentFinish,
  decorTurn,
  finishFree,
  gridItem,
  gridPlacements,
  itemUpkeep,
  layoutFor,
  placementRefusal,
  slotOf,
  slotsFor,
  weeklyUpkeep,
} from '@/engine/home'
import {
  firstFit,
  footprintSize,
  occupiedCells,
  parseSlot,
  placementCells,
  wallSlotId,
  floorSlotId,
  type GridRefusal,
  type GridSlot,
  type Turn,
} from '@/engine/homeGrid'
import {
  DECOR_CATEGORIES,
  resaleValue,
  shopItems,
  shopPrice,
  type DecorCategory,
  type DecorDef,
} from '@/engine/items'
import { copy, type CopyKey } from '@/lib/copy'
import type { QualityTier } from '@/lib/data/schemas/config'
import { formatMoney } from '@/lib/format'
import { homeErrorText, slotName, variantChangedNotice, variantName } from '@/lib/homeCopy'
import { log } from '@/lib/log'
import { itemErrorText, itemName } from '@/lib/shopCopy'
import type { ApartmentView, CellState } from '@/scene/apartment/types'
import { onApartmentCellTap, setApartmentView } from '@/state/apartmentView'
import { gameStore, useGameStore } from '@/state/store'
import { useActionGuard } from '@/components/overlay/useActionGuard'
import type { HomeMode } from './HomePanel'
import { decorDef, finishesView, placedView, placementOf } from './homeView'
import { PANEL_BUTTON } from './PanelDialog'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/buy'
import '@/lib/copy/ns/colors'
import '@/lib/copy/ns/home'
import '@/lib/copy/ns/items'

const ACTION = `${PANEL_BUTTON} bg-raised text-center text-sm text-fg enabled:hover:bg-pressed`
const PRIMARY = `${PANEL_BUTTON} bg-taxi text-center text-sm text-on-taxi`
const SECTION_HEADING = 'text-xs font-bold text-muted uppercase'
const CHIP =
  'min-h-11 shrink-0 rounded-full px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'

const thumbs: Readonly<Record<string, string>> = thumbsJson
const icons: Readonly<Record<string, string>> = looksJson.icons

type Tab = 'design' | DecorCategory
const TABS: readonly Tab[] = ['design', ...DECOR_CATEGORIES]

const TAB_KEYS: Readonly<Record<Tab, CopyKey>> = {
  design: 'buy.category.design',
  sleep: 'buy.category.sleep',
  seating: 'buy.category.seating',
  tables: 'buy.category.tables',
  kitchen: 'buy.category.kitchen',
  lighting: 'buy.category.lighting',
  rugs: 'buy.category.rugs',
  plants: 'buy.category.plants',
  storage: 'buy.category.storage',
  fun: 'buy.category.fun',
  'wall-art': 'buy.category.wallArt',
}

const FACING_KEYS: Readonly<Record<Turn, CopyKey>> = {
  0: 'buy.place.facing.0',
  1: 'buy.place.facing.1',
  2: 'buy.place.facing.2',
  3: 'buy.place.facing.3',
}

const REFUSAL_KEYS: Readonly<Record<Exclude<GridRefusal, 'wrong-kind'>, CopyKey>> = {
  'off-grid': 'home.error.noRoom.offGrid',
  blocked: 'home.error.noRoom.blocked',
  occupied: 'home.error.noRoom.occupied',
}

/** Finishes being tried on, by kind (nothing in the save changes until one is applied). */
type TryOn = Partial<Record<FinishDef['kind'], string>>

function withoutKind(tryOn: TryOn, kind: FinishDef['kind']): TryOn {
  return Object.fromEntries(Object.entries(tryOn).filter(([key]) => key !== kind))
}

/** An item being placed: where its preview stands, how it is turned, and where it came from. */
interface Hold {
  readonly itemId: string
  readonly slotId: string
  readonly turn: Turn
  /** Moving a placed item: cancelling leaves it where it was. */
  readonly moving: boolean
}

function footprintLabel(def: DecorDef): string {
  if (def.decor.fits === 'wall') return copy('buy.footprint.wall')
  const keys = {
    '1x1': 'buy.footprint.1x1',
    '2x1': 'buy.footprint.2x1',
    '2x2': 'buy.footprint.2x2',
  } as const
  return copy(keys[def.decor.footprint])
}

function rarityLabel(def: DecorDef): string {
  const keys = { common: 'buy.rarity.common', medium: 'buy.rarity.medium', rare: 'buy.rarity.rare' }
  return copy(keys[def.rarity] as CopyKey)
}

function Thumb({ itemId, size = 56 }: { readonly itemId: string; readonly size?: number }) {
  const src = thumbs[itemId]
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-canvas/70"
      style={{ width: size, height: size }}
    >
      {src === undefined ? (
        <span className="text-2xl">{icons[itemId] ?? '🏠'}</span>
      ) : (
        // A static, content-named thumbnail (npm run thumbs): next/image adds nothing here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" />
      )}
    </span>
  )
}

/** The cells along the walls in one loop (left wall front to back, back wall, right wall). */
function wallLoop(cols: number, rows: number): string[] {
  const loop: string[] = []
  for (let i = rows - 1; i >= 0; i--) loop.push(wallSlotId('left', i))
  for (let i = 0; i < cols; i++) loop.push(wallSlotId('back', i))
  for (let i = 0; i < rows; i++) loop.push(wallSlotId('right', i))
  return loop
}

export default function HomeDecor({
  mode,
  minute,
  tier,
  label,
  onLive,
  onStatus,
}: {
  readonly mode: HomeMode
  readonly minute: number
  readonly tier: QualityTier
  readonly label: string
  readonly onLive: (live: boolean) => void
  readonly onStatus: (text: string) => void
}) {
  const player = useGameStore((state) => state.player)
  const { home, inventory, apartment } = player
  const layout = layoutFor(home, engineConfig)
  const { size } = layout
  const [hold, setHold] = useState<Hold | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('design')
  const [tryOn, setTryOn] = useState<TryOn>({})
  const [confirmSell, setConfirmSell] = useState<string | null>(null)
  const { guard: act, onKeyDown: guardKeys, onPointerDown } = useActionGuard()
  const buttonGuard = { onKeyDown: guardKeys, onPointerDown }
  const barRef = useRef<HTMLDivElement | null>(null)
  const pendingFocus = useRef<string | null>(null)

  const owned = new Map(inventory.decor.map((entry) => [entry.itemId, entry]))
  // Derived, so a sale elsewhere or a move never leaves a stale hold or selection.
  const held = hold !== null && owned.has(hold.itemId) ? hold : null
  const heldDef = held === null ? null : decorDef(held.itemId)
  const selected = selectedId !== null && owned.has(selectedId) ? selectedId : null

  useEffect(() => {
    onLive(true)
    return () => onLive(false)
  }, [onLive])

  useEffect(() => {
    const target = pendingFocus.current
    pendingFocus.current = null
    if (target === null) return
    const found = document.querySelector<HTMLElement>(`[data-home-decor] ${target}`)
    found?.focus()
    found?.scrollIntoView({ block: 'nearest' })
  })

  const refusal = useMemo(
    () =>
      held === null
        ? null
        : placementRefusal(
            home,
            apartment.placed,
            inventory,
            held.itemId,
            held.slotId,
            held.turn,
            engineConfig,
          ),
    [held, home, apartment.placed, inventory],
  )

  // The room's view: the room as it stands, the held item at its preview spot, the grid, a try-on.
  const placed = useMemo(() => {
    const view = placedView(player)
    if (held === null) return view
    const rest = Object.fromEntries(Object.entries(view).filter(([id]) => id !== held.itemId))
    const preview = placementOf(player, held.itemId, held.slotId, held.turn)
    return preview === null ? rest : { ...rest, [held.itemId]: preview }
  }, [player, held])

  const finishes = useMemo(() => {
    const now = finishesView(player)
    return { wall: tryOn.wall ?? now.wall, floor: tryOn.floor ?? now.floor }
  }, [player, tryOn])

  const cells = useMemo((): Record<string, CellState> | null => {
    const showGrid = held !== null || (mode === 'buy' && tab !== 'design')
    if (!showGrid && selected === null) return null
    const states: Record<string, CellState> = {}
    const lookup = (itemId: string) => {
      const def = decorDef(itemId)
      return def === null ? undefined : gridItem(def)
    }
    const others = gridPlacements(apartment.placed, inventory).filter(
      (entry) => entry.itemId !== held?.itemId,
    )
    if (showGrid) {
      const item = heldDef === null ? null : gridItem(heldDef)
      const kind = item?.kind ?? 'floor'
      const layer = item?.layer ?? 'furniture'
      const taken = occupiedCells(others, size, lookup, layer)
      const keepFree =
        layer === 'rug' || kind === 'wall'
          ? layout.blocked
          : new Set([...layout.blocked, ...layout.walkway])
      for (const slot of slotsFor(home, engineConfig)) {
        if (slot.kind !== kind || keepFree.has(slot.id)) continue
        states[slot.id] = taken.has(slot.id) ? 'taken' : 'free'
      }
      if (held !== null && item !== null) {
        const covered = placementCells(held.slotId, item, held.turn, size)
        if ('cells' in covered) {
          for (const cell of covered.cells) states[cell] = refusal === null ? 'ghost' : 'refused'
        }
      }
    }
    if (held === null && selected !== null) {
      const def = decorDef(selected)
      const slotId = slotOf(apartment.placed, selected)
      if (def !== null && slotId !== null) {
        const covered = placementCells(slotId, gridItem(def), decorTurn(owned.get(selected)), size)
        if ('cells' in covered) for (const cell of covered.cells) states[cell] = 'selected'
      }
    }
    return states
    // `owned` is derived from inventory, which is listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held, heldDef, mode, tab, selected, apartment.placed, inventory, layout, size, refusal])

  useEffect(() => {
    const view: ApartmentView = { home, placed, finishes, cells, label, minute, tier }
    setApartmentView(view)
  }, [home, placed, finishes, cells, label, minute, tier])

  /** Starts placing `itemId`: where it stands when moving, else the first spot it fits. */
  const startHold = (itemId: string, moving: boolean) => {
    const def = decorDef(itemId)
    if (def === null) return
    const current = slotOf(apartment.placed, itemId)
    const turn = decorTurn(owned.get(itemId))
    let spot: { slotId: string; turn: Turn } | null =
      moving && current !== null ? { slotId: current, turn } : null
    if (spot === null) {
      const item = gridItem(def)
      const keepFree =
        item.layer === 'rug' || item.kind === 'wall'
          ? layout.blocked
          : new Set([...layout.blocked, ...layout.walkway])
      const lookup = (id: string) => {
        const other = decorDef(id)
        return other === null ? undefined : gridItem(other)
      }
      spot = firstFit(item, size, keepFree, gridPlacements(apartment.placed, inventory), lookup)
    }
    if (spot === null) {
      // Nowhere fits: show it at the first cell of its kind, refused, so the player can see why.
      const first = slotsFor(home, engineConfig).find(
        (slot) => slot.kind === (def.decor.fits === 'wall' ? 'wall' : 'floor'),
      )
      if (first === undefined) return
      spot = { slotId: first.id, turn }
      onStatus(copy('buy.place.nowhere', { item: itemName(itemId) }))
    }
    setHold({ itemId, slotId: spot.slotId, turn: spot.turn, moving })
    setSelectedId(null)
    setConfirmSell(null)
    pendingFocus.current = '[data-buy-place-bar]'
  }

  const placeHeld = () => {
    if (held === null) return
    const outcome = gameStore.getState().placeDecor(held.itemId, held.slotId, held.turn)
    if (!outcome.ok) {
      log.info('A placement was refused', { itemId: held.itemId, code: outcome.error.code })
      onStatus(homeErrorText(outcome.error))
      return
    }
    setHold(null)
    setSelectedId(held.itemId)
    pendingFocus.current = `[data-buy-room-item="${held.itemId}"] [data-buy-move]`
    onStatus(copy('buy.place.placed', { item: itemName(held.itemId) }))
  }

  const storeHeld = () => {
    if (held === null) return
    const slotId = slotOf(apartment.placed, held.itemId)
    if (slotId !== null) gameStore.getState().removeDecor(slotId)
    setHold(null)
    pendingFocus.current = `[data-buy-stored="${held.itemId}"] [data-buy-place]`
    onStatus(copy('buy.item.stored', { item: itemName(held.itemId) }))
  }

  const cancelHold = () => {
    if (held === null) return
    const wasMoving = held.moving
    const itemId = held.itemId
    setHold(null)
    pendingFocus.current = wasMoving
      ? `[data-buy-room-item="${itemId}"] [data-buy-move]`
      : `[data-buy-stored="${itemId}"] [data-buy-place]`
  }

  /** Moves the preview one cell (floor) or one spot along the walls. */
  const nudge = (dc: number, dr: number) => {
    if (held === null || heldDef === null) return
    const slot = parseSlot(held.slotId, size)
    if (slot === null) return
    if (slot.kind === 'wall') {
      const loop = wallLoop(size.cols, size.rows)
      const at = loop.indexOf(held.slotId)
      const step = dc !== 0 ? dc : dr
      const next = loop[(at + step + loop.length) % loop.length]
      if (next !== undefined) setHold({ ...held, slotId: next })
      return
    }
    const { w, d } = footprintSize(heldDef.decor.footprint, held.turn)
    const c = Math.min(size.cols - w, Math.max(0, slot.c + dc))
    const r = Math.min(size.rows - d, Math.max(0, slot.r + dr))
    setHold({ ...held, slotId: floorSlotId(c, r) })
  }

  const turnHeld = () => {
    if (held === null || heldDef === null || heldDef.decor.fits === 'wall') return
    const turn = ((held.turn + 1) % 4) as Turn
    const slot = parseSlot(held.slotId, size)
    if (slot === null || slot.kind !== 'floor') return
    // Keep the footprint on the grid after it turns.
    const { w, d } = footprintSize(heldDef.decor.footprint, turn)
    const c = Math.min(size.cols - w, slot.c)
    const r = Math.min(size.rows - d, slot.r)
    setHold({ ...held, turn, slotId: floorSlotId(c, r) })
  }

  const onBarKey = (event: KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowLeft: () => nudge(-1, 0),
      ArrowRight: () => nudge(1, 0),
      ArrowUp: () => nudge(0, -1),
      ArrowDown: () => nudge(0, 1),
      r: turnHeld,
      R: turnHeld,
      Enter: placeHeld,
      Escape: cancelHold,
    }
    const run = keys[event.key]
    if (run === undefined) return
    // Enter on a focused button presses that button instead.
    if (event.key === 'Enter' && event.target !== barRef.current) return
    event.preventDefault()
    event.stopPropagation()
    run()
  }

  // A tap in the room: moves the held item there (a second tap on its spot places it), or selects
  // whatever stands on the cell.
  const onCellTap = (slotId: string) => {
    const slot = parseSlot(slotId, size)
    if (slot === null) return
    if (held !== null && heldDef !== null) {
      if (slotId === held.slotId) {
        placeHeld()
        return
      }
      const wantsWall = heldDef.decor.fits === 'wall'
      if ((slot.kind === 'wall') !== wantsWall) return
      if (slot.kind === 'wall') {
        setHold({ ...held, slotId })
        return
      }
      const { w, d } = footprintSize(heldDef.decor.footprint, held.turn)
      const c = Math.min(size.cols - w, slot.c)
      const r = Math.min(size.rows - d, slot.r)
      setHold({ ...held, slotId: floorSlotId(c, r) })
      return
    }
    const hit = itemAt(slot)
    setSelectedId(hit)
    setConfirmSell(null)
    if (hit !== null) {
      pendingFocus.current = `[data-buy-room-item="${hit}"]`
      onStatus(copy('buy.item.selected', { item: itemName(hit) }))
    }
  }

  /** The item standing on a cell: furniture before a rug under it. */
  const itemAt = (slot: GridSlot): string | null => {
    let rug: string | null = null
    for (const entry of gridPlacements(apartment.placed, inventory)) {
      const def = decorDef(entry.itemId)
      if (def === null) continue
      const covered = placementCells(entry.slotId, gridItem(def), entry.turn, size)
      if (!('cells' in covered) || !covered.cells.includes(slot.id)) continue
      if (def.decor.layer === 'rug') rug = entry.itemId
      else return entry.itemId
    }
    return rug
  }

  // Listened to directly: jsx-a11y does not allow key handlers on a non-interactive role.
  const keyHandler = useRef(onBarKey)
  useEffect(() => {
    keyHandler.current = onBarKey
  })
  const barShown = held !== null
  useEffect(() => {
    const bar = barRef.current
    if (!barShown || bar === null) return
    const onKey = (event: KeyboardEvent) => keyHandler.current(event)
    bar.addEventListener('keydown', onKey)
    return () => bar.removeEventListener('keydown', onKey)
  }, [barShown])

  const tapHandler = useRef(onCellTap)
  useEffect(() => {
    tapHandler.current = onCellTap
  })
  useEffect(() => onApartmentCellTap((slotId) => tapHandler.current(slotId)), [])

  const turnPlaced = (itemId: string) => {
    const outcome = gameStore.getState().rotateDecor(itemId)
    if (!outcome.ok) {
      log.info('A turn was refused', { itemId, code: outcome.error.code })
      onStatus(homeErrorText(outcome.error))
      return
    }
    const turn = decorTurn(
      outcome.snapshot.player.inventory.decor.find((entry) => entry.itemId === itemId),
    )
    onStatus(copy('buy.item.turned', { item: itemName(itemId), facing: copy(FACING_KEYS[turn]) }))
  }

  const storePlaced = (itemId: string) => {
    const slotId = slotOf(apartment.placed, itemId)
    if (slotId === null) return
    const outcome = gameStore.getState().removeDecor(slotId)
    if (!outcome.ok) {
      onStatus(homeErrorText(outcome.error))
      return
    }
    setSelectedId(null)
    pendingFocus.current = `[data-buy-stored="${itemId}"] [data-buy-place]`
    onStatus(copy('buy.item.stored', { item: itemName(itemId) }))
  }

  const sell = (itemId: string, amount: number) => {
    const outcome = gameStore.getState().sellItem(itemId)
    setConfirmSell(null)
    if (!outcome.ok) {
      log.info('A sale was refused', { itemId, code: outcome.error.code })
      onStatus(itemErrorText(outcome.error))
      return
    }
    setSelectedId(null)
    pendingFocus.current = '[data-buy-room-heading]'
    onStatus(copy('buy.item.sold', { item: itemName(itemId), amount: formatMoney(amount) }))
  }

  const buy = (def: DecorDef) => {
    const outcome = gameStore.getState().buyItem(def.id)
    if (!outcome.ok) {
      log.info('A buy was refused', { itemId: def.id, code: outcome.error.code })
      onStatus(itemErrorText(outcome.error))
      return
    }
    onStatus(copy('buy.bought', { item: itemName(def.id) }))
    // The store has the new item now; hold it on the next render's inventory.
    queueMicrotask(() => startHoldFresh(def.id))
  }

  /** `startHold` against the store's latest state (right after a purchase). */
  const startHoldFresh = (itemId: string) => {
    const latest = gameStore.getState().player
    const def = decorDef(itemId)
    if (def === null) return
    const item = gridItem(def)
    const lay = layoutFor(latest.home, engineConfig)
    const keepFree =
      item.layer === 'rug' || item.kind === 'wall'
        ? lay.blocked
        : new Set([...lay.blocked, ...lay.walkway])
    const lookup = (id: string) => {
      const other = decorDef(id)
      return other === null ? undefined : gridItem(other)
    }
    const spot = firstFit(
      item,
      lay.size,
      keepFree,
      gridPlacements(latest.apartment.placed, latest.inventory),
      lookup,
    )
    if (spot === null) {
      onStatus(copy('buy.place.nowhere', { item: itemName(itemId) }))
      return
    }
    setHold({ itemId, slotId: spot.slotId, turn: spot.turn, moving: false })
    pendingFocus.current = '[data-buy-place-bar]'
  }

  const applyFinish = (finish: FinishDef) => {
    const outcome = gameStore.getState().applyFinish(finish.id)
    if (!outcome.ok) {
      log.info('A finish was refused', { finishId: finish.id, code: outcome.error.code })
      onStatus(
        outcome.error.code === 'FINISH_FUNDS_SHORT'
          ? copy('buy.design.short', {
              finish: copy(finish.nameKey as CopyKey),
              price: formatMoney(finish.price),
              cash: formatMoney(outcome.error.available),
            })
          : homeErrorText(outcome.error),
      )
      return
    }
    setTryOn((last) => withoutKind(last, finish.kind))
    onStatus(copy('buy.design.applied', { finish: copy(finish.nameKey as CopyKey) }))
  }

  const bonus = resaleBonusPts(player, engineConfig)
  const resale = (def: DecorDef) => {
    const entry = owned.get(def.id)
    return entry === undefined
      ? 0
      : resaleValue(def, entry.acquiredMinute, minute, engineConfig, bonus)
  }

  const placedIds = new Set(Object.values(apartment.placed))
  const roomItems = inventory.decor.filter((entry) => placedIds.has(entry.itemId))
  const stored = inventory.decor.filter((entry) => !placedIds.has(entry.itemId))
  const upkeep = weeklyUpkeep(player, engineConfig)

  const spotName = (slotId: string) => slotName(home, slotId)
  const facingWord = (turn: Turn) => copy(FACING_KEYS[turn])

  const placementBar =
    held === null || heldDef === null ? null : (
      <div
        ref={barRef}
        role="group"
        tabIndex={-1}
        data-buy-place-bar=""
        aria-label={copy('buy.place.region', { item: itemName(held.itemId) })}
        className="flex flex-col gap-2 rounded-xl border-2 border-taxi bg-canvas/80 p-2 focus:outline-2 focus:outline-focus"
      >
        <div className="flex items-center gap-2">
          <Thumb itemId={held.itemId} size={44} />
          <div className="min-w-0">
            <p className="font-bold text-fg">
              {copy('buy.place.heading', { item: itemName(held.itemId) })}
            </p>
            <p className="text-xs text-muted" data-buy-place-where="">
              {copy('buy.place.where', {
                spot: spotName(held.slotId),
                facing: facingWord(held.turn),
              })}{' '}
              <span className={refusal === null ? 'text-taxi-ink' : 'font-semibold text-fg'}>
                {refusal === null
                  ? copy('buy.place.fits')
                  : refusal === 'wrong-kind'
                    ? ''
                    : copy(REFUSAL_KEYS[refusal], { item: itemName(held.itemId) })}
              </span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ['left', -1, 0, '←'],
              ['up', 0, -1, '↑'],
              ['down', 0, 1, '↓'],
              ['right', 1, 0, '→'],
            ] as const
          ).map(([dir, dc, dr, glyph]) => (
            <button
              key={dir}
              type="button"
              data-buy-nudge={dir}
              aria-label={copy(`buy.place.${dir}` as CopyKey)}
              onClick={() => nudge(dc, dr)}
              className={`${ACTION} w-11 px-0 text-base`}
            >
              <span aria-hidden="true">{glyph}</span>
            </button>
          ))}
          {heldDef.decor.fits === 'wall' ? null : (
            <button
              type="button"
              data-buy-turn=""
              aria-label={copy('buy.place.turnLabel', { item: itemName(held.itemId) })}
              onClick={turnHeld}
              className={ACTION}
            >
              {copy('buy.place.turn')}
            </button>
          )}
          <button
            type="button"
            data-buy-confirm=""
            {...buttonGuard}
            aria-disabled={refusal === null ? undefined : true}
            aria-label={
              refusal === null || refusal === 'wrong-kind'
                ? copy('buy.place.confirmLabel', {
                    item: itemName(held.itemId),
                    spot: spotName(held.slotId),
                  })
                : copy('buy.place.refusedLabel', {
                    item: itemName(held.itemId),
                    spot: spotName(held.slotId),
                    reason: copy(REFUSAL_KEYS[refusal], { item: itemName(held.itemId) }),
                  })
            }
            onClick={(event) => {
              if (refusal !== null) return
              act(event, 'place', placeHeld)
            }}
            className={refusal === null ? PRIMARY : `${ACTION} cursor-not-allowed text-muted`}
          >
            {copy('buy.place.confirm')}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" data-buy-store-held="" onClick={storeHeld} className={ACTION}>
            {copy('buy.place.store')}
          </button>
          <button type="button" data-buy-cancel="" onClick={cancelHold} className={ACTION}>
            {copy('buy.place.cancel')}
          </button>
        </div>
        <p className="text-xs text-muted">{copy('buy.place.keys')}</p>
      </div>
    )

  const itemRow = (itemId: string, inRoom: boolean) => {
    const def = decorDef(itemId)
    const entry = owned.get(itemId)
    if (def === null || entry === undefined) return null
    const slotId = slotOf(apartment.placed, itemId)
    const isSelected = selected === itemId
    const amount = resale(def)
    const kept = entry.prestigeKept === true
    const canSell = !def.decor.starter && !kept
    const where =
      slotId === null ? footprintLabel(def) : `${spotName(slotId)} · ${footprintLabel(def)}`
    return (
      <li
        key={itemId}
        {...(inRoom ? { 'data-buy-room-item': itemId } : { 'data-buy-stored': itemId })}
        data-selected={isSelected ? '' : undefined}
        tabIndex={-1}
        className={`flex flex-col gap-1.5 rounded-xl bg-canvas/60 p-2 focus:outline-2 focus:outline-focus ${
          isSelected ? 'ring-2 ring-taxi-ink' : ''
        }`}
      >
        <div className="flex items-center gap-2">
          <Thumb itemId={itemId} size={40} />
          <button
            type="button"
            aria-expanded={isSelected}
            aria-label={copy('buy.item.selectLabel', { item: itemName(itemId), spot: where })}
            onClick={() => {
              setSelectedId(isSelected ? null : itemId)
              setConfirmSell(null)
            }}
            className="min-h-11 min-w-0 flex-1 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-focus"
          >
            <span className="block truncate font-semibold text-fg">{itemName(itemId)}</span>
            <span className="block truncate text-xs text-muted">{where}</span>
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {inRoom ? (
            <>
              <button
                type="button"
                data-buy-move=""
                {...buttonGuard}
                aria-label={copy('buy.item.moveLabel', { item: itemName(itemId) })}
                onClick={(event) => act(event, `move-${itemId}`, () => startHold(itemId, true))}
                className={ACTION}
              >
                {copy('buy.item.move')}
              </button>
              {def.decor.fits === 'wall' ? null : (
                <button
                  type="button"
                  data-buy-turn-item=""
                  {...buttonGuard}
                  aria-label={copy('buy.item.turnLabel', { item: itemName(itemId) })}
                  onClick={(event) => act(event, `turn-${itemId}`, () => turnPlaced(itemId))}
                  className={ACTION}
                >
                  {copy('buy.item.turn')}
                </button>
              )}
              <button
                type="button"
                data-buy-store=""
                {...buttonGuard}
                aria-label={copy('buy.item.storeLabel', { item: itemName(itemId) })}
                onClick={(event) => act(event, `store-${itemId}`, () => storePlaced(itemId))}
                className={ACTION}
              >
                {copy('buy.item.store')}
              </button>
            </>
          ) : (
            <button
              type="button"
              data-buy-place=""
              {...buttonGuard}
              aria-label={copy('buy.item.placeLabel', { item: itemName(itemId) })}
              onClick={(event) => act(event, `place-${itemId}`, () => startHold(itemId, false))}
              className={PRIMARY}
            >
              {copy('buy.item.place')}
            </button>
          )}
          {isSelected || !inRoom ? (
            <button
              type="button"
              data-buy-sell=""
              {...buttonGuard}
              aria-disabled={canSell ? undefined : true}
              aria-label={
                canSell
                  ? copy('buy.item.sellLabel', {
                      item: itemName(itemId),
                      amount: formatMoney(amount),
                    })
                  : `${itemName(itemId)}. ${copy('buy.item.starter')}`
              }
              onClick={(event) => {
                if (!canSell) return
                act(event, `sell-${itemId}`, () => setConfirmSell(itemId))
              }}
              className={`${ACTION} ${canSell ? '' : 'cursor-not-allowed text-muted'}`}
            >
              {copy('buy.item.sell', { amount: formatMoney(canSell ? amount : 0) })}
            </button>
          ) : null}
        </div>
        {confirmSell === itemId ? (
          <div
            role="group"
            aria-label={copy('buy.item.sellLabel', {
              item: itemName(itemId),
              amount: formatMoney(amount),
            })}
            className="flex flex-col gap-1.5"
          >
            <p className="text-sm text-fg">
              {copy('buy.item.sellConfirm', {
                item: itemName(itemId),
                amount: formatMoney(amount),
              })}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                data-buy-sell-yes=""
                {...buttonGuard}
                onClick={(event) => act(event, `sell-yes-${itemId}`, () => sell(itemId, amount))}
                className={PRIMARY}
              >
                {copy('buy.item.sellYes')}
              </button>
              <button type="button" onClick={() => setConfirmSell(null)} className={ACTION}>
                {copy('buy.item.sellNo')}
              </button>
            </div>
          </div>
        ) : null}
        {isSelected && def.decor.variants.length > 1 ? (
          <fieldset className="flex flex-col gap-1">
            <legend className="text-xs text-muted">{copy('buy.item.colour')}</legend>
            <div className="flex flex-wrap gap-1.5">
              {def.decor.variants.map((variant) => (
                <label
                  key={variant.id}
                  className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl bg-raised px-2 text-sm text-fg has-[:checked]:bg-taxi has-[:checked]:text-on-taxi has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus"
                >
                  <input
                    type="radio"
                    name={`buy-variant-${def.id}`}
                    value={variant.id}
                    checked={entry.variant === variant.id}
                    onChange={() => {
                      const outcome = gameStore.getState().setDecorVariant(def.id, variant.id)
                      if (outcome.ok) {
                        onStatus(variantChangedNotice(def.id, variant.id))
                      }
                    }}
                    className="h-4 w-4 accent-on-taxi"
                  />
                  <span
                    aria-hidden="true"
                    className="h-3.5 w-3.5 rounded-full border border-line-strong"
                    style={{ backgroundColor: `var(--palette-${variant.token})` }}
                  />
                  {variantName(def.id, variant.id)}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        {isSelected && def.decor.luxury && !kept ? (
          <p className="text-xs text-muted">
            {copy('buy.item.upkeep', { upkeep: formatMoney(itemUpkeep(def, engineConfig)) })}
          </p>
        ) : null}
      </li>
    )
  }

  const roomSection = (
    <>
      <section aria-labelledby="buy-room-heading" className="flex flex-col gap-1.5">
        <h3
          id="buy-room-heading"
          data-buy-room-heading=""
          tabIndex={-1}
          className={`${SECTION_HEADING} focus:outline-none`}
        >
          {copy('buy.room.heading')}
        </h3>
        {roomItems.length === 0 ? (
          <p className="text-sm text-muted">{copy('buy.room.empty')}</p>
        ) : (
          <ul className="grid grid-cols-1 gap-1.5 [@media(min-width:1024px)]:grid-cols-1">
            {roomItems.map((entry) => itemRow(entry.itemId, true))}
          </ul>
        )}
        {upkeep > 0 ? (
          <p className="text-xs text-muted" data-buy-upkeep="">
            {copy('buy.upkeep.total', { upkeep: formatMoney(upkeep) })}
          </p>
        ) : null}
      </section>
      <section aria-labelledby="buy-storage-heading" className="flex flex-col gap-1.5">
        <h3 id="buy-storage-heading" className={SECTION_HEADING}>
          {copy('buy.storage.heading')}
        </h3>
        {stored.length === 0 ? (
          <p className="text-sm text-muted">{copy('buy.storage.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {stored.map((entry) => itemRow(entry.itemId, false))}
          </ul>
        )}
      </section>
    </>
  )

  const catalogue = shopItems(engineConfig).filter(
    (item): item is DecorDef =>
      item.category === 'decor' && tab !== 'design' && item.decor.category === tab,
  )

  const finishButton = (finish: FinishDef) => {
    const on = currentFinish(player, finish.kind, engineConfig) === finish.id
    const trying = tryOn[finish.kind] === finish.id
    const free = finishFree(player, finish, engineConfig)
    const shell = layout.shell
    const original = finish.id === (finish.kind === 'wall' ? shell.wallPaint : shell.floorFinish)
    const state = on
      ? copy('buy.design.current')
      : original
        ? copy('buy.design.original')
        : free
          ? copy('buy.design.owned')
          : formatMoney(finish.price)
    const name = copy(finish.nameKey as CopyKey)
    return (
      <li key={finish.id}>
        <button
          type="button"
          data-buy-finish={finish.id}
          aria-pressed={trying || (tryOn[finish.kind] === undefined && on)}
          aria-label={copy('buy.design.tryLabel', { finish: name, state })}
          onClick={() => {
            setTryOn((last) =>
              on ? withoutKind(last, finish.kind) : { ...last, [finish.kind]: finish.id },
            )
            if (!on) onStatus(copy('buy.design.trying', { finish: name }))
          }}
          className={`flex min-h-11 w-full flex-col gap-1 rounded-xl bg-canvas/60 p-1.5 text-left focus-visible:outline-2 focus-visible:outline-focus ${
            trying ? 'ring-2 ring-taxi-ink' : on ? 'ring-1 ring-line-strong' : ''
          }`}
        >
          <span
            aria-hidden="true"
            className="flex h-9 w-full overflow-hidden rounded-lg border border-line"
            data-finish-swatch={finish.id}
          >
            <span
              className="h-full flex-1"
              style={{ backgroundColor: finishColor(finish.id, 0) }}
            />
            <span
              className="h-full flex-1"
              style={{ backgroundColor: finishColor(finish.id, 1) }}
            />
          </span>
          <span className="text-xs font-semibold text-fg">{name}</span>
          <span className="text-xs text-muted">{state}</span>
        </button>
      </li>
    )
  }

  const trials = (['wall', 'floor'] as const).flatMap((kind) => {
    const finish = engineConfig.home.finishes.find((entry) => entry.id === tryOn[kind])
    return finish === undefined ? [] : [finish]
  })

  const designSection = (
    <div className="flex flex-col gap-2" data-buy-design="">
      <p className="text-xs text-muted">{copy('buy.design.hint')}</p>
      {trials.map((trial) => (
        <div
          key={trial.kind}
          className="flex flex-wrap items-center gap-1.5 rounded-xl border-2 border-taxi p-2"
          data-buy-tryon={trial.kind}
        >
          <p className="min-w-0 flex-1 text-sm text-fg">
            {copy('buy.design.trying', { finish: copy(trial.nameKey as CopyKey) })}
          </p>
          {finishFree(player, trial, engineConfig) ? (
            <button
              type="button"
              data-buy-finish-use=""
              {...buttonGuard}
              aria-label={copy('buy.design.useLabel', { finish: copy(trial.nameKey as CopyKey) })}
              onClick={(event) => act(event, 'finish', () => applyFinish(trial))}
              className={PRIMARY}
            >
              {copy('buy.design.use')}
            </button>
          ) : (
            <button
              type="button"
              data-buy-finish-buy=""
              {...buttonGuard}
              aria-label={copy('buy.design.buyLabel', {
                finish: copy(trial.nameKey as CopyKey),
                price: formatMoney(trial.price),
              })}
              onClick={(event) => act(event, 'finish', () => applyFinish(trial))}
              className={PRIMARY}
            >
              {copy('buy.design.buy', { price: formatMoney(trial.price) })}
            </button>
          )}
          <button
            type="button"
            onClick={() => setTryOn((last) => withoutKind(last, trial.kind))}
            className={ACTION}
          >
            {copy('buy.design.keep')}
          </button>
        </div>
      ))}
      {(['wall', 'floor'] as const).map((kind) => (
        <section
          key={kind}
          aria-label={copy(kind === 'wall' ? 'buy.design.walls' : 'buy.design.floors')}
        >
          <h4 className={`${SECTION_HEADING} mb-1`}>
            {copy(kind === 'wall' ? 'buy.design.walls' : 'buy.design.floors')}
          </h4>
          <ul className="grid grid-cols-3 gap-1.5 [@media(min-width:1024px)]:grid-cols-3">
            {engineConfig.home.finishes.filter((finish) => finish.kind === kind).map(finishButton)}
          </ul>
        </section>
      ))}
    </div>
  )

  const card = (def: DecorDef) => {
    const price = shopPrice(def, player, engineConfig)
    const entry = owned.get(def.id)
    const inRoom = placedIds.has(def.id)
    const short = Math.max(0, price - player.cash)
    const upkeepNow = itemUpkeep(def, engineConfig)
    return (
      <li
        key={def.id}
        data-buy-card={def.id}
        className="flex flex-col gap-1 rounded-2xl bg-canvas/60 p-2"
      >
        <div className="relative flex justify-center">
          <Thumb itemId={def.id} size={96} />
          <span className="absolute top-0 left-0 rounded-md bg-raised px-1.5 text-[11px] font-bold text-fg">
            {footprintLabel(def)}
          </span>
          {def.decor.luxury ? (
            <span className="absolute top-0 right-0 rounded-md bg-taxi px-1.5 text-[11px] font-bold text-on-taxi">
              {copy('buy.card.luxury')}
            </span>
          ) : null}
        </div>
        <p className="text-sm leading-tight font-semibold text-fg">{itemName(def.id)}</p>
        <p className="text-xs text-muted">
          {rarityLabel(def)} · <span className="font-bold text-taxi-ink">{formatMoney(price)}</span>
        </p>
        {upkeepNow > 0 ? (
          <p className="text-xs text-muted">
            {copy('buy.card.upkeep', { upkeep: formatMoney(upkeepNow) })}
          </p>
        ) : null}
        {entry !== undefined ? (
          <button
            type="button"
            data-buy-card-place=""
            {...buttonGuard}
            aria-label={
              inRoom
                ? `${itemName(def.id)}. ${copy('buy.card.placed')}`
                : copy('buy.card.placeLabel', { item: itemName(def.id) })
            }
            onClick={(event) =>
              act(event, `card-${def.id}`, () => {
                if (inRoom) {
                  setSelectedId(def.id)
                  return
                }
                startHold(def.id, false)
              })
            }
            className={inRoom ? ACTION : PRIMARY}
          >
            {copy(inRoom ? 'buy.card.placed' : 'buy.card.place')}
          </button>
        ) : (
          <button
            type="button"
            data-buy-card-buy=""
            {...buttonGuard}
            aria-disabled={short > 0 ? true : undefined}
            aria-label={
              short > 0
                ? copy('buy.card.shortLabel', {
                    item: itemName(def.id),
                    price: formatMoney(price),
                    required: formatMoney(short),
                  })
                : copy('buy.card.buyLabel', { item: itemName(def.id), price: formatMoney(price) })
            }
            onClick={(event) => {
              if (short > 0) return
              act(event, `buy-${def.id}`, () => buy(def))
            }}
            className={short > 0 ? `${ACTION} cursor-not-allowed text-muted` : PRIMARY}
          >
            {short > 0
              ? copy('buy.card.short', { required: formatMoney(short) })
              : copy('buy.card.buy')}
          </button>
        )}
      </li>
    )
  }

  const buySection = (
    <section aria-label={copy('buy.catalogue.heading')} className="flex flex-col gap-2">
      <div
        role="group"
        aria-label={copy('buy.categories.label')}
        className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
      >
        {TABS.map((option) => (
          <button
            key={option}
            type="button"
            data-buy-tab={option}
            aria-pressed={tab === option}
            onClick={() => {
              setTab(option)
              setTryOn({})
            }}
            className={`${CHIP} ${tab === option ? 'bg-taxi text-on-taxi' : 'bg-raised text-fg'}`}
          >
            {copy(TAB_KEYS[option])}
          </button>
        ))}
      </div>
      {tab === 'design' ? (
        designSection
      ) : (
        <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 [@media(min-width:1024px)]:grid-cols-2">
          {catalogue.map(card)}
        </ul>
      )}
    </section>
  )

  return (
    <div data-home-decor="" data-cc-feature="cc-feature:home-decor" className="flex flex-col gap-2">
      {placementBar}
      {mode === 'room' ? roomSection : buySection}
    </div>
  )
}

const WORLD_HEX: Readonly<Record<string, string>> = { ...themeJson.world, ...themeJson.models }
const FINISH_TOKENS: ReadonlyMap<string, readonly string[]> = new Map(
  finishesJson.finishes.map((finish) => [finish.id, finish.tokens]),
)

/** A finish's colour for its swatch, from the world palette (theme.json). */
function finishColor(finishId: string, index: 0 | 1): string {
  const finish = FINISH_TOKENS.get(finishId)
  const token = finish?.[index] ?? finish?.[0]
  return token === undefined ? 'transparent' : (WORLD_HEX[token] ?? 'transparent')
}
