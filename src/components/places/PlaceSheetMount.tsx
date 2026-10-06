'use client'

import { lazy, Suspense, useEffect } from 'react'
import { useOpenPlaceId } from '@/state/placeSheet'

// DEC-11: the shell carries only the boot path. The action sheet, with the game store, engine,
// place data and copy helpers it needs, loads in its own chunk the first time a place opens.
// React.lazy rather than next/dynamic: the sheet only ever renders in the browser (the open
// place is client state), so next/dynamic's SSR bail-out machinery would be dead weight here.
const PlaceSheet = lazy(() =>
  import('./PlaceSheet').then((module) => ({ default: module.PlaceSheet })),
)

/**
 * The sheet zone's place slot: nothing until a place is opened (`openPlace`), then the lazily
 * loaded action sheet. The e2e hook is installed only when Playwright sets the flag, and is
 * itself a separate chunk, so no test code ships in the shell.
 */
export function PlaceSheetMount() {
  const placeId = useOpenPlaceId()

  useEffect(() => {
    if (window.__CLOUTCITY_E2E__ !== true) return
    void import('./placeTestHook').then((module) => module.installPlaceTestHook())
  }, [])

  if (placeId === null) return null
  return (
    <Suspense fallback={null}>
      <PlaceSheet placeId={placeId} />
    </Suspense>
  )
}
