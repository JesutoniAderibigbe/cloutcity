'use client'

import { lazyIsland } from '@/components/overlay/lazyIsland'

// DEC-11: the shell carries only this mount. The offer, with the game store it reads, loads after
// the shell (not a boot island: it is never needed before the player's first action), and shows
// nothing while it loads, until the offer is due, or if its chunk cannot load (it is not
// precached, PERF-7: offline before it ever loaded, there is simply no offer; the HUD still
// opens the creator).
const CreatorOffer = lazyIsland(
  () => import('./CreatorOffer').then((module) => module.CreatorOffer),
  { zone: 'toast', labelKey: 'loading.creatorOffer', quiet: true, hideFailure: true },
)

/** The toast zone's creator offer slot (S16a). */
export function CreatorOfferMount() {
  return <CreatorOffer />
}
