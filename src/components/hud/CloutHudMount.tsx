'use client'

import { lazyIsland } from '@/components/overlay/lazyIsland'

// DEC-11: the shell carries only this mount. The meter, with the game store and engine it reads
// and the hud and clout copy, is a boot island: the HUD shows from the start, so it starts
// loading as soon as the shell runs, with a compact loading state in the HUD row.
const CloutHudIsland = lazyIsland(
  () => import('./CloutHudIsland').then((module) => module.CloutHudIsland),
  { zone: 'hud', labelKey: 'loading.clout', eager: true },
)

/** The HUD's clout slot: nothing on the server, the lazily loaded meter in the browser. */
export function CloutHudMount() {
  // Sits in the HUD row's right-hand group, beside the sound control.
  return (
    <div className="flex shrink-0 items-center">
      <CloutHudIsland />
    </div>
  )
}
