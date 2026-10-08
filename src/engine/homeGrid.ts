/**
 * The apartment's placement grid (S40, buy mode 2.0): pure maths shared by the engine
 * (src/engine/home.ts), the Home panel and the 3D room. No config imports, so the room's lazy
 * chunk can use it without pulling the engine config in.
 *
 * - The floor is `cols` × `rows` square cells; cell `f{c}-{r}` has column c (0 at the left wall)
 *   and row r (0 at the back wall). Each wall has one cell per column (back) or row (left,
 *   right): `w-back-{i}`, `w-left-{i}`, `w-right-{i}`.
 * - A floor item covers a footprint (1×1, 2×1 or 2×2) turned by quarter turns: a 2×1 item is two
 *   cells wide at turns 0 and 2 and two cells deep at turns 1 and 3. Its slot is the footprint's
 *   back-left cell. A wall item covers one wall cell.
 * - Rugs lie on their own layer: furniture may stand on a rug, a rug may not overlap a rug. Two
 *   items never share a slot (the back-left cell a placement is keyed by), whatever their layers.
 * - Cells the home blocks (built-in fixtures, the way in from the door, where the avatar stands,
 *   a window or door on a wall) never take an item.
 */

export type GridFootprint = '1x1' | '2x1' | '2x2'
export type GridWall = 'back' | 'left' | 'right'
export type GridLayer = 'furniture' | 'rug'
/** A quarter turn about the vertical axis: 0 faces the open front, 1 the right wall, and so on. */
export type Turn = 0 | 1 | 2 | 3

export const TURNS: readonly Turn[] = [0, 1, 2, 3]
export const GRID_WALLS: readonly GridWall[] = ['back', 'left', 'right']

export interface GridSize {
  readonly cols: number
  readonly rows: number
}

export type GridSlot =
  | { readonly id: string; readonly kind: 'floor'; readonly c: number; readonly r: number }
  | { readonly id: string; readonly kind: 'wall'; readonly wall: GridWall; readonly i: number }

export function floorSlotId(c: number, r: number): string {
  return `f${c}-${r}`
}

export function wallSlotId(wall: GridWall, i: number): string {
  return `w-${wall}-${i}`
}

const FLOOR_ID = /^f(\d+)-(\d+)$/
const WALL_ID = /^w-(back|left|right)-(\d+)$/

/** The slot `id` names in a grid of `size`, or null when it is not one of its cells. */
export function parseSlot(id: string, size: GridSize): GridSlot | null {
  const floor = FLOOR_ID.exec(id)
  if (floor !== null) {
    const c = Number(floor[1])
    const r = Number(floor[2])
    return c < size.cols && r < size.rows ? { id, kind: 'floor', c, r } : null
  }
  const wall = WALL_ID.exec(id)
  if (wall !== null) {
    const side = wall[1] as GridWall
    const i = Number(wall[2])
    return i < wallLength(side, size) ? { id, kind: 'wall', wall: side, i } : null
  }
  return null
}

/** Cells along a wall: the back wall spans the columns, the side walls the rows. */
export function wallLength(wall: GridWall, size: GridSize): number {
  return wall === 'back' ? size.cols : size.rows
}

/** Every slot of a grid: floor cells row by row from the back, then each wall's cells. */
export function gridSlots(size: GridSize): GridSlot[] {
  const slots: GridSlot[] = []
  for (let r = 0; r < size.rows; r++) {
    for (let c = 0; c < size.cols; c++) slots.push({ id: floorSlotId(c, r), kind: 'floor', c, r })
  }
  for (const wall of GRID_WALLS) {
    for (let i = 0; i < wallLength(wall, size); i++) {
      slots.push({ id: wallSlotId(wall, i), kind: 'wall', wall, i })
    }
  }
  return slots
}

/** Cells a footprint spans across (`w`, columns) and deep (`d`, rows) at `turn`. */
export function footprintSize(footprint: GridFootprint, turn: Turn): { w: number; d: number } {
  switch (footprint) {
    case '1x1':
      return { w: 1, d: 1 }
    case '2x2':
      return { w: 2, d: 2 }
    case '2x1':
      return turn % 2 === 0 ? { w: 2, d: 1 } : { w: 1, d: 2 }
  }
}

/** The floor cell ids an item with `footprint` covers from slot (c, r) at `turn`; null off the grid. */
export function footprintCells(
  c: number,
  r: number,
  footprint: GridFootprint,
  turn: Turn,
  size: GridSize,
): string[] | null {
  const { w, d } = footprintSize(footprint, turn)
  if (c < 0 || r < 0 || c + w > size.cols || r + d > size.rows) return null
  const cells: string[] = []
  for (let dr = 0; dr < d; dr++) {
    for (let dc = 0; dc < w; dc++) cells.push(floorSlotId(c + dc, r + dr))
  }
  return cells
}

/** What the grid needs to know about one item. */
export interface GridItem {
  readonly kind: 'floor' | 'wall'
  readonly footprint: GridFootprint
  readonly layer: GridLayer
}

/** One placement as the grid sees it: where, how turned, and what. */
export interface GridPlacement {
  readonly itemId: string
  readonly slotId: string
  readonly turn: Turn
}

export type GridRefusal =
  /** The slot is not a cell of this grid, or the item hangs on walls and this is the floor (or back). */
  | 'wrong-kind'
  /** The footprint runs off the grid. */
  | 'off-grid'
  /** The home keeps one of the cells free (a fixture, the doorway, a window, the avatar's spot). */
  | 'blocked'
  /** Another item already covers one of the cells. */
  | 'occupied'

/** The cells (floor or wall ids) a placement covers, or a refusal. */
export function placementCells(
  slotId: string,
  item: GridItem,
  turn: Turn,
  size: GridSize,
): { readonly cells: string[] } | { readonly refusal: GridRefusal } {
  const slot = parseSlot(slotId, size)
  if (slot === null || slot.kind !== item.kind) return { refusal: 'wrong-kind' }
  if (slot.kind === 'wall') return { cells: [slot.id] }
  const cells = footprintCells(slot.c, slot.r, item.footprint, turn, size)
  return cells === null ? { refusal: 'off-grid' } : { cells }
}

/**
 * Whether `item` fits at `slotId` turned `turn`, given the home's `blocked` cells and the other
 * placements (`others`, the item itself left out by the caller). `itemOf` describes a placed item.
 */
export function fitRefusal(
  slotId: string,
  item: GridItem,
  turn: Turn,
  size: GridSize,
  blocked: ReadonlySet<string>,
  others: readonly GridPlacement[],
  itemOf: (itemId: string) => GridItem | undefined,
): GridRefusal | null {
  const placed = placementCells(slotId, item, turn, size)
  if ('refusal' in placed) return placed.refusal
  // Blocked cells hold fixtures or must stay walkable, so they refuse rugs too.
  if (placed.cells.some((cell) => blocked.has(cell))) return 'blocked'
  // A placement is keyed by its slot, so no two items share one, whatever their layers.
  if (others.some((other) => other.slotId === slotId)) return 'occupied'
  const taken = occupiedCells(others, size, itemOf, item.layer)
  return placed.cells.some((cell) => taken.has(cell)) ? 'occupied' : null
}

/** Cells covered by `placements` on `layer` (wall cells always count as one layer). */
export function occupiedCells(
  placements: readonly GridPlacement[],
  size: GridSize,
  itemOf: (itemId: string) => GridItem | undefined,
  layer: GridLayer,
): Set<string> {
  const taken = new Set<string>()
  for (const placement of placements) {
    const item = itemOf(placement.itemId)
    if (item === undefined) continue
    if (item.kind === 'floor' && item.layer !== layer) continue
    const placed = placementCells(placement.slotId, item, placement.turn, size)
    if ('cells' in placed) for (const cell of placed.cells) taken.add(cell)
  }
  return taken
}

/** The turn after `turn`. */
export function nextTurn(turn: Turn): Turn {
  return ((turn + 1) % 4) as Turn
}

export function isTurn(value: unknown): value is Turn {
  return value === 0 || value === 1 || value === 2 || value === 3
}

/**
 * The turn that faces an item into the room from where it stands: away from the nearest wall
 * (the back wall wins a tie), so a sofa pushed against a side wall faces the middle.
 */
export function facingTurn(c: number, r: number, w: number, d: number, size: GridSize): Turn {
  const back = r
  const left = c
  const right = size.cols - (c + w)
  const nearest = Math.min(back, left, right)
  if (nearest === back) return 0
  return nearest === left ? 1 : 3
}

/**
 * The first slot (in grid order) where `item` fits at a turn facing into the room, trying each
 * turn, or null when it fits nowhere. Deterministic: the movers always set a room up the same way.
 */
export function firstFit(
  item: GridItem,
  size: GridSize,
  blocked: ReadonlySet<string>,
  others: readonly GridPlacement[],
  itemOf: (itemId: string) => GridItem | undefined,
): { readonly slotId: string; readonly turn: Turn } | null {
  for (const slot of gridSlots(size)) {
    if (slot.kind !== item.kind) continue
    if (slot.kind === 'wall') {
      if (fitRefusal(slot.id, item, 0, size, blocked, others, itemOf) === null) {
        return { slotId: slot.id, turn: 0 }
      }
      continue
    }
    const preferred = facingTurn(slot.c, slot.r, 1, 1, size)
    for (const turn of [preferred, ...TURNS.filter((t) => t !== preferred)]) {
      if (fitRefusal(slot.id, item, turn, size, blocked, others, itemOf) === null) {
        return { slotId: slot.id, turn }
      }
    }
  }
  return null
}
