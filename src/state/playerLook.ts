/**
 * The player's look as the avatar draws it (S16a), for the 3D map, the apartment and the creator
 * preview. Session-only and deliberately tiny like playerHome.ts: the HUD's live island (which
 * holds the game store) writes the effective look (src/engine/appearance.ts `effectiveLook`), and
 * the 3D chunks read it without pulling the store, engine and catalogs into the scene chunk.
 * Null until the HUD has read the save; the scene shows its placeholder avatar meanwhile.
 */
import { useSyncExternalStore } from 'react'
import { createStore } from 'zustand/vanilla'
import type { EffectiveLook } from '@/engine/appearance'

interface PlayerLookState {
  readonly look: EffectiveLook | null
}

export const playerLookStore = createStore<PlayerLookState>()(() => ({ look: null }))

/** Same look, field by field (a re-render of the HUD must not wake the scene). */
function sameLook(a: EffectiveLook | null, b: EffectiveLook): boolean {
  return a !== null && JSON.stringify(a) === JSON.stringify(b)
}

export function setPlayerLook(look: EffectiveLook): void {
  if (!sameLook(playerLookStore.getState().look, look)) playerLookStore.setState({ look })
}

const lookNow = () => playerLookStore.getState().look
const serverLook = () => null

/** The player's effective look, or null before the HUD has read the save (and on the server). */
export function usePlayerLook(): EffectiveLook | null {
  return useSyncExternalStore(playerLookStore.subscribe, lookNow, serverLook)
}
