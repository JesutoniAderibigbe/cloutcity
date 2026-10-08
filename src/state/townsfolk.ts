/**
 * The local (townsfolk NPC, S04o) whose card is open, and the bridge the card uses to reach the
 * living city: the map's townsfolk layer (src/scene/ambient/AmbientLife.tsx) sets it while it is
 * mounted. Session-only UI state, never persisted. Only the lazy living-city and card chunks
 * import this module, never the shell.
 */
import { useSyncExternalStore } from 'react'
import { createStore } from 'zustand/vanilla'
import type { TownsfolkProfile } from '@/lib/world/ambient/townsfolk'

interface TownsfolkState {
  readonly selected: TownsfolkProfile | null
}

export const townsfolkStore = createStore<TownsfolkState>()(() => ({ selected: null }))

export function selectLocal(profile: TownsfolkProfile | null): void {
  if (townsfolkStore.getState().selected?.id === (profile?.id ?? null)) return
  townsfolkStore.setState({ selected: profile })
}

const selectedNow = () => townsfolkStore.getState().selected
const none = () => null

export function useSelectedLocal(): TownsfolkProfile | null {
  return useSyncExternalStore(townsfolkStore.subscribe, selectedNow, none)
}

/** What the card asks of the map: locals in view (nearest first) and a local's head on screen. */
export interface TownsfolkBridge {
  nearby(): readonly TownsfolkProfile[]
  /** The local's head in client px, or null when not drawn. */
  headAt(id: string): { readonly x: number; readonly y: number } | null
}

export const townsfolkBridge: { current: TownsfolkBridge | null } = { current: null }
