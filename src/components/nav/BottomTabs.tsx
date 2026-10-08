'use client'

import { useEffect } from 'react'
import { modalStore } from '@/components/overlay/modalState'
import { copy, type CopyKey } from '@/lib/copy'
import {
  dismissHudPanel,
  hudPanelStore,
  openHudPanel,
  useHudPanel,
  type HudPanel,
} from '@/state/hudPanel'
import { showMap } from '@/state/mapTab'

export const TABS = [
  { id: 'home', labelKey: 'tabs.home', icon: '🏠' },
  { id: 'map', labelKey: 'tabs.map', icon: '🗺️' },
  { id: 'phone', labelKey: 'tabs.phone', icon: '📱' },
  { id: 'shop', labelKey: 'tabs.shop', icon: '🛍️' },
  { id: 'me', labelKey: 'tabs.me', icon: '🙂' },
] as const satisfies readonly { id: string; labelKey: CopyKey; icon: string }[]

export type TabId = (typeof TABS)[number]['id']

/** The Phone app the `?` key opens (S58): Settings & Help, at the keyboard shortcuts. */
export const SHORTCUTS_APP = 'shortcuts'

/** The tab a HUD panel belongs to: its own tab, or Map for every other panel. */
function tabOf(panel: HudPanel | null): TabId {
  return panel === 'home' || panel === 'me' || panel === 'phone' || panel === 'shop' ? panel : 'map'
}

/** True when a key press is typing into a field, so it is not a shortcut. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
}

/**
 * Bottom tab bar. Home (first, DEC-59) opens the Home panel with the 3D room, where the game
 * starts (S40). Map always brings the city to the front, closing any panel or sheet, and on the
 * map already glides the camera back to the player (src/state/mapTab.ts). Phone opens the
 * phone's app grid, Shop the store directory and Me the Me panel, all in the sheet zone (S18a,
 * S58). A tab is current
 * while its panel is open, and tapping it again closes it. Each tab carries `data-hud-panel`, so
 * focus comes back to it when its panel closes (PanelDialog). The `?` key opens the keyboard
 * shortcuts in the phone's Settings & Help (S58), unless the player is typing or a modal is up.
 */
export function BottomTabs() {
  const panel = useHudPanel()
  const active = tabOf(panel)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '?' || event.ctrlKey || event.metaKey || event.altKey) return
      const modal = modalStore.getState()
      if (!modal.settled || modal.openCount > 0 || isTyping(event.target)) return
      event.preventDefault()
      openHudPanel('phone', { phoneApp: SHORTCUTS_APP })
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const choose = (id: TabId) => {
    if (id === 'map') showMap()
    else if (hudPanelStore.getState().panel === id) dismissHudPanel()
    else openHudPanel(id)
  }

  return (
    <nav
      aria-label={copy('nav.main')}
      className="h-full border-t border-line glass pb-[env(safe-area-inset-bottom,0px)]"
    >
      <ul className="grid h-full grid-cols-5">
        {TABS.map((tab) => {
          const isActive = tab.id === active
          return (
            <li key={tab.id} className="flex">
              <button
                type="button"
                data-tab={tab.id}
                data-hud-panel={tab.id === 'map' ? undefined : tab.id}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => choose(tab.id)}
                className={`relative flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${
                  isActive ? 'text-taxi-ink' : 'text-muted'
                }`}
              >
                <span aria-hidden="true" className="text-xl leading-none">
                  {tab.icon}
                </span>
                {copy(tab.labelKey)}
                {isActive ? (
                  <span
                    aria-hidden="true"
                    className="absolute top-0 left-1/2 h-1 w-8 -translate-x-1/2 rounded-b-full bg-taxi"
                  />
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
