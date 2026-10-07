/**
 * Whether the Icon moment (S15) is waiting to be shown. Session-only UI state, never persisted,
 * and deliberately tiny like hudPanel.ts: the shell's modal mount reads it, so the victory
 * screen with the store, engine and goals copy loads only when the moment comes (DEC-11).
 *
 * The HUD's live island (which already holds the game store) sets it from the save: true while
 * `goals.icon` has been reached and not acknowledged. Closing the screen or prestiging clears
 * it through the store, and the island follows.
 */
import { useSyncExternalStore } from 'react'
import { createStore } from 'zustand/vanilla'

interface IconMomentState {
  readonly pending: boolean
}

export const iconMomentStore = createStore<IconMomentState>()(() => ({ pending: false }))

export function setIconMomentPending(pending: boolean): void {
  if (iconMomentStore.getState().pending !== pending) iconMomentStore.setState({ pending })
}

const isPending = () => iconMomentStore.getState().pending
const serverPending = () => false

/** True while the Icon moment should show; false during the server render and hydration. */
export function useIconMomentPending(): boolean {
  return useSyncExternalStore(iconMomentStore.subscribe, isPending, serverPending)
}
