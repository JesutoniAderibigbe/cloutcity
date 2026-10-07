/**
 * Which place's action sheet is open (S09). Session-only UI state, never persisted: a reload
 * starts with no sheet open.
 *
 * Every way into a place goes through `openPlace` (the 3D pins and the Places panel in S04c,
 * the e2e hook), so they all open the same sheet. This store is deliberately tiny and holds no
 * game data: the shell imports it to know when to load the sheet, and the sheet with its engine
 * and data loads only on first use (DEC-11).
 */
import { useSyncExternalStore } from 'react'
import { createStore } from 'zustand/vanilla'

interface PlaceSheetState {
  /** The place whose sheet is open, or null. An unknown id renders nothing and is cleared. */
  readonly placeId: string | null
}

export const placeSheetStore = createStore<PlaceSheetState>()(() => ({ placeId: null }))

/** Opens the action sheet for a venue or landmark (replacing any open one). */
export function openPlace(placeId: string): void {
  placeSheetStore.setState({ placeId })
}

/** Closes the action sheet. */
export function closePlace(): void {
  placeSheetStore.setState({ placeId: null })
}

const openPlaceId = () => placeSheetStore.getState().placeId
const serverPlaceId = () => null

/** The open place id; null during the server render and hydration. */
export function useOpenPlaceId(): string | null {
  return useSyncExternalStore(placeSheetStore.subscribe, openPlaceId, serverPlaceId)
}
