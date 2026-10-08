/**
 * Whether the S06 tour is running, as a tiny session signal (S16a): the tour host reports it, and
 * the creator offer waits for the tour to end without loading the tour's persisted store and its
 * schema into the offer's chunk.
 */
import { useSyncExternalStore } from 'react'
import { createStore } from 'zustand/vanilla'

export const tourActiveStore = createStore<{ readonly active: boolean }>()(() => ({
  active: false,
}))

export function setTourActive(active: boolean): void {
  if (tourActiveStore.getState().active !== active) tourActiveStore.setState({ active })
}

const isActive = () => tourActiveStore.getState().active
const serverInactive = () => false

/** True while the tour runs; false during the server render and hydration. */
export function useTourActive(): boolean {
  return useSyncExternalStore(tourActiveStore.subscribe, isActive, serverInactive)
}
