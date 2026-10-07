'use client'

/**
 * Whether the sound settings sheet is open, shared by the HUD's gear button and the sheet zone
 * (they live in different overlay zones).
 */
import { createStore } from 'zustand/vanilla'
import { HUD_MORE_SELECTOR, focusFirstVisible } from '@/components/overlay/focusVisible'

export const SOUND_SETTINGS_BUTTON_ID = 'sound-settings-button'
export const SOUND_SETTINGS_SHEET_ID = 'sound-settings'

export const soundSheetStore = createStore<{ readonly open: boolean }>()(() => ({ open: false }))

export function setSoundSheetOpen(open: boolean): void {
  soundSheetStore.setState({ open })
}

/**
 * Closes the sheet and puts focus back on what opened it: the gear on wide screens, or the
 * HUD's More button on phones, where the gear is hidden and the sheet opens from More (S05).
 */
export function closeSoundSheet(): void {
  setSoundSheetOpen(false)
  focusFirstVisible([`#${SOUND_SETTINGS_BUTTON_ID}`, HUD_MORE_SELECTOR, 'main'])
}
