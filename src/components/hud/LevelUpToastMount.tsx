'use client'

import { lazy, Suspense } from 'react'
import { useHydrated } from '@/components/overlay/useHydrated'

// DEC-11: the shell carries only this mount. The toast, with the store it subscribes to,
// loads in its own chunk after hydration.
const LevelUpToast = lazy(() =>
  import('./LevelUpToast').then((module) => ({ default: module.LevelUpToast })),
)

/** The toast zone's level-up slot: nothing on the server, the lazily loaded toast after. */
export function LevelUpToastMount() {
  if (!useHydrated()) return null
  return (
    <Suspense fallback={null}>
      <LevelUpToast />
    </Suspense>
  )
}
