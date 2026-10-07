'use client'

import { lazy, Suspense, useEffect } from 'react'
import { closeHudPanel, useHudPanel } from '@/state/hudPanel'
import { onPlaceOpened } from '@/state/placeSheet'

// DEC-11: each panel, with the game store, engine and copy helpers it needs, is its own chunk
// loaded the first time it opens. React.lazy for the same reason as PlaceSheetMount.
const InventoryPanel = lazy(() =>
  import('./InventoryPanel').then((module) => ({ default: module.InventoryPanel })),
)
const RentPanel = lazy(() =>
  import('./RentPanel').then((module) => ({ default: module.RentPanel })),
)

/**
 * The sheet zone's HUD-panel slot (S10a): nothing until a HUD button opens a panel. A place
 * opening closes the panel, so only one sheet shows at a time. The e2e hook is installed only
 * when Playwright sets the flag, from its own chunk.
 */
export function HudPanelMount() {
  const panel = useHudPanel()

  useEffect(() => onPlaceOpened(closeHudPanel), [])

  useEffect(() => {
    if (window.__CLOUTCITY_E2E__ !== true) return
    void import('./hudTestHook').then((module) => module.installHudTestHook())
  }, [])

  if (panel === null) return null
  return (
    <Suspense fallback={null}>
      {panel === 'inventory' ? <InventoryPanel /> : <RentPanel />}
    </Suspense>
  )
}
