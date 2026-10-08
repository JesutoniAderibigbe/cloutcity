'use client'

import { lazyIsland } from '@/components/overlay/lazyIsland'
import { useCreatorOpen } from '@/state/creatorOpen'

// DEC-11: the shell carries only this mount and the tiny creatorOpen signal. The creator, with
// its engine flow, look runtime and copy, is a feature island loaded the first time the player
// opens it, with its loading state in the modal zone.
const CreatorModal = lazyIsland(
  () => import('./CreatorModal').then((module) => module.CreatorModal),
  { zone: 'modal', labelKey: 'loading.creator' },
)

/** The modal slot's "Make it you" creator (S16a): nothing until the player opens it. */
export function CreatorMount() {
  return useCreatorOpen() ? <CreatorModal /> : null
}
