/**
 * Which 3D scene has the screen (S16): the city map, the player's apartment while the Home
 * panel shows it, or the creator's avatar preview while it is open (S16a). Session-only and deliberately tiny like playerHome.ts: the apartment mount
 * (in the Home panel's chunk) writes it, and the city's 3D chunk reads it without pulling in the
 * store, engine or catalogs.
 *
 * While another scene has the screen the city renders no frames at all (frameloop `never`) and is
 * hidden, so only one WebGL scene draws at a time; it draws one frame again when the room closes.
 */
import { useSyncExternalStore } from 'react'
import { createStore } from 'zustand/vanilla'

export type SceneFocus = 'city' | 'room' | 'creator'

interface SceneFocusState {
  readonly focus: SceneFocus
}

export const sceneFocusStore = createStore<SceneFocusState>()(() => ({ focus: 'city' }))

export function setSceneFocus(focus: SceneFocus): void {
  if (sceneFocusStore.getState().focus !== focus) sceneFocusStore.setState({ focus })
}

const focusNow = () => sceneFocusStore.getState().focus
const serverFocus = (): SceneFocus => 'city'

/** The scene with the screen; `city` on the server and during hydration. */
export function useSceneFocus(): SceneFocus {
  return useSyncExternalStore(sceneFocusStore.subscribe, focusNow, serverFocus)
}
