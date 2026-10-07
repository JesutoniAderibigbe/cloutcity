'use client'

import { useState } from 'react'
import { copy, type CopyKey } from '@/lib/copy'
import { closeHudPanel, openHudPanel, useHudPanel } from '@/state/hudPanel'

export const TABS = [
  { id: 'map', labelKey: 'tabs.map', icon: '🗺️' },
  { id: 'phone', labelKey: 'tabs.phone', icon: '📱' },
  { id: 'shop', labelKey: 'tabs.shop', icon: '🛍️' },
  { id: 'me', labelKey: 'tabs.me', icon: '🙂' },
] as const satisfies readonly { id: string; labelKey: CopyKey; icon: string }[]

export type TabId = (typeof TABS)[number]['id']

/**
 * Bottom tab bar. The Me tab opens the Me panel in the sheet zone (S18a) and is current while
 * that panel is open; the other tabs only change the selection for now. Choosing another tab
 * closes the Me panel. The Me tab carries `data-hud-panel="me"`, so focus comes back to it when
 * the panel closes (PanelDialog).
 */
export function BottomTabs() {
  const [selected, setSelected] = useState<Exclude<TabId, 'me'>>('map')
  const panel = useHudPanel()
  const active: TabId = panel === 'me' ? 'me' : selected

  const choose = (id: TabId) => {
    if (id === 'me') {
      openHudPanel('me')
      return
    }
    if (panel === 'me') closeHudPanel()
    setSelected(id)
  }

  return (
    <nav
      aria-label={copy('nav.main')}
      className="h-full border-t border-night-700 bg-night-900/95 pb-[env(safe-area-inset-bottom,0px)]"
    >
      <ul className="grid h-full grid-cols-4">
        {TABS.map((tab) => {
          const isActive = tab.id === active
          return (
            <li key={tab.id} className="flex">
              <button
                type="button"
                data-tab={tab.id}
                data-hud-panel={tab.id === 'me' ? 'me' : undefined}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => choose(tab.id)}
                className={`flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-taxi-400 ${
                  isActive ? 'text-taxi-400' : 'text-ink-300'
                }`}
              >
                <span aria-hidden="true" className="text-xl leading-none">
                  {tab.icon}
                </span>
                {copy(tab.labelKey)}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
