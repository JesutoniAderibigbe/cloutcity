/**
 * Whether the "Make it you" creator (S16a) is open. Session-only UI state, never persisted, and
 * deliberately tiny like hudPanel.ts: the shell's modal mount reads it, so the creator with its
 * engine flow, look runtime and copy loads only when the player opens it (DEC-11). The offer
 * toast, the HUD's "Your look" button and the More panel open it.
 */
import { useSyncExternalStore } from 'react'
import { createStore } from 'zustand/vanilla'
import { closeHudPanel } from './hudPanel'
import { closePlace } from './placeSheet'

interface CreatorOpenState {
  readonly open: boolean
}

export const creatorOpenStore = createStore<CreatorOpenState>()(() => ({ open: false }))

/** Opens the creator over the game; any HUD panel or place sheet closes first. */
export function openCreator(): void {
  closeHudPanel()
  closePlace()
  if (!creatorOpenStore.getState().open) creatorOpenStore.setState({ open: true })
}

export function closeCreator(): void {
  if (creatorOpenStore.getState().open) creatorOpenStore.setState({ open: false })
}

const isOpen = () => creatorOpenStore.getState().open
const serverClosed = () => false

/** True while the creator is open; false during the server render and hydration. */
export function useCreatorOpen(): boolean {
  return useSyncExternalStore(creatorOpenStore.subscribe, isOpen, serverClosed)
}
