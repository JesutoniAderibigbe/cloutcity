/**
 * Which account sheet the player asked for (S19): saving progress ("Create account") or logging
 * in, with the email to start from when the sheet switches mode ("Log in instead" keeps what
 * the player typed, GR-6). Session-only and tiny like hudPanel.ts: the welcome card, the Me tab,
 * the save banner and the level-up nudge open it; the sheet itself loads lazily (HudPanelMount).
 */
import { useSyncExternalStore } from 'react'
import { createStore } from 'zustand/vanilla'
import { openHudPanel } from './hudPanel'

export type AccountSheetMode = 'save' | 'login'

export interface AccountSheetState {
  readonly mode: AccountSheetMode
  /** The email to fill in, exactly as the player typed it; null for an empty field. */
  readonly email: string | null
}

export const accountSheetStore = createStore<AccountSheetState>()(() => ({
  mode: 'save',
  email: null,
}))

/** Opens the account sheet in the sheet zone (replacing any panel or place sheet). */
export function openAccountSheet(mode: AccountSheetMode, email: string | null = null): void {
  accountSheetStore.setState({ mode, email })
  openHudPanel('account')
}

const sheetState = () => accountSheetStore.getState()

export function useAccountSheet(): AccountSheetState {
  return useSyncExternalStore(accountSheetStore.subscribe, sheetState, sheetState)
}
