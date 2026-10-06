'use client'

import dynamic from 'next/dynamic'
import { useSyncExternalStore } from 'react'

// DEC-11: the shell carries only the boot path. The event sheet, and the store, engine and
// zod/mini it needs (nothing else in the shell uses them yet), load in their own chunk after
// hydration. It must load at boot rather than on a tap: an event left open before a reload
// has to reappear. Once a boot-path component (the HUD) imports the store, that chunk keeps
// only the dialog code.
const EventSheet = dynamic(() => import('./EventSheet').then((module) => module.EventSheet), {
  ssr: false,
  loading: () => null,
})

const noSubscribe = () => () => {}

/** False during the server render and hydration, true after: the store is browser-only state. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  )
}

/** The sheet zone's event slot: nothing on the server, the lazily loaded sheet in the browser. */
export function EventSheetMount() {
  return useHydrated() ? <EventSheet /> : null
}
