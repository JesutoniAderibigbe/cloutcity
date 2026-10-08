'use client'

import { lazyIsland } from '@/components/overlay/lazyIsland'
import { useSavePromptArmed } from '@/state/savePrompt'

// DEC-11: the shell carries only this mount. The banner, with the game, tour and account stores
// it reads, loads once the guest session has connected (after the map is playable).
const SaveProgressBanner = lazyIsland(
  () => import('./SaveProgressBanner').then((module) => module.SaveProgressBanner),
  { zone: 'banner', labelKey: 'loading.account', quiet: true },
)

/** The banner zone's save-progress slot (S19, GR-4): nothing until a guest session exists. */
export function SaveProgressMount() {
  return useSavePromptArmed() ? <SaveProgressBanner /> : null
}
