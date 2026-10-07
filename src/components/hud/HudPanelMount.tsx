'use client'

import { useEffect } from 'react'
import { lazyIsland } from '@/components/overlay/lazyIsland'
import { closeHudPanel, useHudPanel } from '@/state/hudPanel'
import { onPlaceOpened } from '@/state/placeSheet'

// DEC-11: the shell carries only this mount. Each panel, with the game store, engine and copy
// it needs, is a feature island loaded the first time it opens, with a loading state in the
// sheet zone.
const InventoryPanel = lazyIsland(
  () => import('./InventoryPanel').then((module) => module.InventoryPanel),
  { zone: 'sheet', labelKey: 'loading.inventory' },
)
const RentPanel = lazyIsland(() => import('./RentPanel').then((module) => module.RentPanel), {
  zone: 'sheet',
  labelKey: 'loading.rent',
})

/**
 * The sheet zone's HUD-panel slot (S10a): nothing until a HUD button opens a panel. A place
 * opening closes the panel, so only one sheet shows at a time. In builds with test hooks the
 * e2e hook is installed from its own chunk, so no test code ships in the shell (or at all in
 * production).
 */
export function HudPanelMount() {
  const panel = useHudPanel()

  useEffect(() => onPlaceOpened(closeHudPanel), [])

  useEffect(() => {
    // Inlined at build time (next.config.ts): production builds drop the hook entirely.
    if (process.env.NEXT_PUBLIC_TEST_HOOKS !== '1') return
    void import('./hudTestHook').then((module) => module.installHudTestHook())
  }, [])

  if (panel === null) return null
  return panel === 'inventory' ? <InventoryPanel /> : <RentPanel />
}
