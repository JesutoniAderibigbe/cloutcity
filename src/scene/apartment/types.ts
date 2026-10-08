/**
 * What the apartment's 3D chunk (S16, S40) is given, as types only: the Home panel writes the
 * view (src/state/apartmentView.ts) without importing three, and the shell's mount passes it on.
 */
import type { GridFootprint, Turn } from '@/engine/homeGrid'
import type { HomeIdLiteral } from '@/lib/data/homes'
import type { QualityTier } from '@/lib/data/schemas/config'

/** One placed decor item: where it stands, how it is turned, its colour variant's palette token. */
export interface ApartmentPlacement {
  readonly itemId: string
  readonly slotId: string
  readonly turn: Turn
  readonly token: string
  /** On a wall cell, on floor cells, or on floor cells atop its own small table. */
  readonly mount: 'wall' | 'floor' | 'surface'
  readonly footprint: GridFootprint
}

/**
 * How buy mode's grid shows one cell: free, taken by an item, covered by the held item where it
 * fits, where it does not fit, or the selected item's cells. Cells left out are not drawn.
 */
export type CellState = 'free' | 'taken' | 'ghost' | 'refused' | 'selected'

/** What the room shows: everything the Home panel decides. */
export interface ApartmentView {
  readonly home: HomeIdLiteral
  /** Every item drawn, by item id: what is placed, with a held or moving item at its preview spot. */
  readonly placed: Readonly<Record<string, ApartmentPlacement>>
  /** The wall paint and floor finish shown (finish ids), a try-on included. */
  readonly finishes: { readonly wall: string; readonly floor: string }
  /** Buy mode's grid, cell id → how it shows; null when the grid is hidden. */
  readonly cells: Readonly<Record<string, CellState>> | null
  /** The canvas's accessible name ("Your apartment, Queens room"). */
  readonly label: string
  /** The personal-clock minute, for the lighting seam (S04f). */
  readonly minute: number
  readonly tier: QualityTier
}

export interface ApartmentViewProps extends ApartmentView {
  /** A tap on a cell of the room (a floor cell or a wall cell id). */
  readonly onCellTap: (slotId: string) => void
}

/** Name of the room avatar's group (S16a; the apartment test hook finds it by name). */
export const ROOM_AVATAR_NAME = 'apartment-avatar'
