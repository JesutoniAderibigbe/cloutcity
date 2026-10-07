'use client'

import { lazy, Suspense } from 'react'
import { useHydrated } from '@/components/overlay/useHydrated'

// DEC-11: the shell carries only this mount. The meter, with the store and engine it reads,
// loads in its own chunk after hydration (the store is browser-only state).
const CloutHudIsland = lazy(() =>
  import('./CloutHudIsland').then((module) => ({ default: module.CloutHudIsland })),
)

/** The HUD's clout slot: nothing on the server, the lazily loaded meter in the browser. */
export function CloutHudMount() {
  if (!useHydrated()) return null
  // Pinned to the right of the HUD header, so the header's own layout stays as it is.
  return (
    <div className="absolute inset-y-0 right-4 flex items-center">
      <Suspense fallback={null}>
        <CloutHudIsland />
      </Suspense>
    </div>
  )
}
