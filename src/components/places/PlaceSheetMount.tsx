'use client'

import { useEffect } from 'react'
import { lazyIsland } from '@/components/overlay/lazyIsland'
import { useOpenPlaceId } from '@/state/placeSheet'

// DEC-11: the shell carries only the boot path. The action sheet, with the game store, engine,
// place data and copy it needs, loads in its own chunk the first time a place opens, with a
// loading state in the sheet zone.
const PlaceSheet = lazyIsland(() => import('./PlaceSheet').then((module) => module.PlaceSheet), {
  zone: 'sheet',
  labelKey: 'loading.place',
})

/**
 * The sheet zone's place slot: nothing until a place is opened (`openPlace`), then the lazily
 * loaded action sheet. In builds with test hooks the e2e hook is installed from its own chunk,
 * so no test code ships in the shell (or at all in production).
 */
export function PlaceSheetMount() {
  const placeId = useOpenPlaceId()

  useEffect(() => {
    // Inlined at build time (next.config.ts): production builds drop the hook entirely.
    if (process.env.NEXT_PUBLIC_TEST_HOOKS !== '1') return
    void import('./placeTestHook').then((module) => module.installPlaceTestHook())
  }, [])

  return placeId === null ? null : <PlaceSheet placeId={placeId} />
}
