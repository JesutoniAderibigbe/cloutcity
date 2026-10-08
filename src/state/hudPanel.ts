/**
 * Which HUD panel (inventory or rent, S10a; goals, S15; more, S05; home, S16; me, opened by the
 * Me tab, S18a; cloud, S18c; account, S19; phone and shop, opened by their tabs, S58) is open in
 * the sheet zone. Session-only UI state, never persisted,
 * and deliberately tiny like placeSheet.ts: the shell imports it for the HUD buttons, and each
 * panel with its engine, data and copy loads only on first use (DEC-11).
 *
 * One sheet at a time: opening a panel closes any place sheet, and the panel mount closes the
 * panel when a place opens.
 */
import { useSyncExternalStore } from 'react'
import { createStore } from 'zustand/vanilla'
import { closePlace } from './placeSheet'

export const HUD_PANELS = [
  'inventory',
  'rent',
  'goals',
  'more',
  'home',
  'me',
  'cloud',
  'phone',
  'shop',
] as const
export type HudPanel = (typeof HUD_PANELS)[number]

interface HudPanelState {
  readonly panel: HudPanel | null
  /** The panel was launched from a Phone app (S58): closing it goes back to the phone. */
  readonly fromPhone: boolean
  /** The Phone app to show when the phone opens (null: its home screen). */
  readonly phoneApp: string | null
}

export const hudPanelStore = createStore<HudPanelState>()(() => ({
  panel: null,
  fromPhone: false,
  phoneApp: null,
}))

export interface OpenHudPanelOptions {
  readonly fromPhone?: boolean
  readonly phoneApp?: string
}

/** Opens a HUD panel, replacing any open panel or place sheet. */
export function openHudPanel(panel: HudPanel, options: OpenHudPanelOptions = {}): void {
  closePlace()
  hudPanelStore.setState({
    panel,
    fromPhone: options.fromPhone === true,
    phoneApp: options.phoneApp ?? null,
  })
}

/** The open panel's own Close: back to the phone when a Phone app opened it, else closed. */
export function closeHudPanel(): void {
  const { panel, fromPhone } = hudPanelStore.getState()
  hudPanelStore.setState(
    fromPhone && panel !== 'phone'
      ? { panel: 'phone', fromPhone: false, phoneApp: null }
      : { panel: null, fromPhone: false, phoneApp: null },
  )
}

/** Closes whatever panel is open, never going back to the phone (a place, the Map tab). */
export function dismissHudPanel(): void {
  hudPanelStore.setState({ panel: null, fromPhone: false, phoneApp: null })
}

const openPanel = () => hudPanelStore.getState().panel
const serverPanel = () => null

/** The open panel; null during the server render and hydration. */
export function useHudPanel(): HudPanel | null {
  return useSyncExternalStore(hudPanelStore.subscribe, openPanel, serverPanel)
}
