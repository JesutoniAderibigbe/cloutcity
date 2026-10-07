/**
 * The player's look (S16a), for the 3D map, the apartment and the creator preview: the look ids
 * and the worn item ids, as other players would see them (src/engine/appearance.ts
 * `publicAvatar`). Session-only and deliberately tiny like playerHome.ts: the HUD's live island
 * (which holds the game store) writes it, and the avatar's lazy chunk resolves the models
 * (src/engine/avatarLook.ts `effectiveLook`), so neither the look options nor the store land in
 * the other's chunk. Null until the HUD has read the save; the scene shows its placeholder
 * avatar meanwhile.
 */
import { useSyncExternalStore } from 'react'
import { createStore } from 'zustand/vanilla'
import type { PublicAvatar } from '@/engine/appearance'

interface PlayerLookState {
  readonly look: PublicAvatar | null
}

export const playerLookStore = createStore<PlayerLookState>()(() => ({ look: null }))

/** Same look, field by field (a re-render of the HUD must not wake the scene). */
function sameLook(a: PublicAvatar | null, b: PublicAvatar): boolean {
  return a !== null && JSON.stringify(a) === JSON.stringify(b)
}

export function setPlayerLook(look: PublicAvatar): void {
  if (!sameLook(playerLookStore.getState().look, look)) playerLookStore.setState({ look })
}

const lookNow = () => playerLookStore.getState().look
const serverLook = () => null

/** The player's effective look, or null before the HUD has read the save (and on the server). */
export function usePlayerLook(): PublicAvatar | null {
  return useSyncExternalStore(playerLookStore.subscribe, lookNow, serverLook)
}
