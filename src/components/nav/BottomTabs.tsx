'use client'

import { useState } from 'react'

// Placeholder labels until S02 moves player-facing copy into /data/copy.
export const TABS = [
  { id: 'map', label: 'Map', icon: '🗺️' },
  { id: 'phone', label: 'Phone', icon: '📱' },
  { id: 'shop', label: 'Shop', icon: '🛍️' },
  { id: 'me', label: 'Me', icon: '🙂' },
] as const

export type TabId = (typeof TABS)[number]['id']

/** Bottom tab bar. Shell only: switching tabs changes the selection, not the screen yet. */
export function BottomTabs() {
  const [active, setActive] = useState<TabId>('map')

  return (
    <nav
      aria-label="Main"
      className="h-full border-t border-night-700 bg-night-900/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur"
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
                className={`flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-taxi-400 ${
                  isActive ? 'text-taxi-400' : 'text-ink-300'
                }`}
              >
                <span aria-hidden="true" className="text-xl leading-none">
                  {tab.icon}
                </span>
                {tab.label}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
