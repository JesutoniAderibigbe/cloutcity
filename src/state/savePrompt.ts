/**
 * Whether the save-progress banner may load (S19): armed once the guest session has connected
 * (src/lib/supabase/accountSession.ts), so the banner's chunk never loads on the way to a playable map
 * nor for a player with no server session. Session-only and tiny: the shell's banner mount
 * reads it; whether the banner actually shows is decided inside its island (`savePromptDue`).
 */
import { useSyncExternalStore } from 'react'
import { createStore } from 'zustand/vanilla'

export const savePromptStore = createStore<{ readonly armed: boolean }>()(() => ({ armed: false }))

export function armSavePrompt(): void {
  if (!savePromptStore.getState().armed) savePromptStore.setState({ armed: true })
}

const armed = () => savePromptStore.getState().armed
const serverArmed = () => false

export function useSavePromptArmed(): boolean {
  return useSyncExternalStore(savePromptStore.subscribe, armed, serverArmed)
}
