'use client'

import { useState } from 'react'
import { copy, type CopyKey } from '@/lib/copy'

export const TABS = [
  { id: 'map', labelKey: 'tabs.map', icon: '🗺️' },
  { id: 'phone', labelKey: 'tabs.phone', icon: '📱' },
  { id: 'shop', labelKey: 'tabs.shop', icon: '🛍️' },
  { id: 'me', labelKey: 'tabs.me', icon: '🙂' },
] as const satisfies readonly { id: string; labelKey: CopyKey; icon: string }[]

export type TabId = (typeof TABS)[number]['id']

/** Bottom tab bar. Shell only: switching tabs changes the selection, not the screen yet. */
export function BottomTabs() {
  const [active, setActive] = useState<TabId>('map')

  return (
    <nav
      aria-label={copy('nav.main')}
      className="h-full border-t border-line glass pb-[env(safe-area-inset-bottom,0px)]"
    >
      <ul className="grid h-full grid-cols-4">
        {TABS.map((tab) => {
          const isActive = tab.id === active
          return (
            <li key={tab.id} className="flex">
              <button
                type="button"
                data-tab={tab.id}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => setActive(tab.id)}
                className={`flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${
                  isActive ? 'text-taxi-ink' : 'text-muted'
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
