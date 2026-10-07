import { useSyncExternalStore } from 'react'

const noSubscribe = () => () => {}

/** False during the server render and hydration, true after: the store is browser-only state. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  )
}
