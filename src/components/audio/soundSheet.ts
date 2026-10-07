'use client'

/**
 * Whether the sound settings sheet is open, shared by the HUD's gear button and the sheet zone
 * (they live in different overlay zones).
 */
import { createStore } from 'zustand/vanilla'

export const SOUND_SETTINGS_BUTTON_ID = 'sound-settings-button'
export const SOUND_SETTINGS_SHEET_ID = 'sound-settings'

export const soundSheetStore = createStore<{ readonly open: boolean }>()(() => ({ open: false }))

export function setSoundSheetOpen(open: boolean): void {
  soundSheetStore.setState({ open })
}

/** Closes the sheet and puts focus back on the gear that opened it. */
export function closeSoundSheet(): void {
  setSoundSheetOpen(false)
  document.getElementById(SOUND_SETTINGS_BUTTON_ID)?.focus()
}
