'use client'

import { lazyIsland } from '@/components/overlay/lazyIsland'

// DEC-11: the shell carries only this mount. The toast host, with the game store it subscribes
// to, is a boot island: a level-up can land as soon as play starts. The toast itself and its copy
// load on the first level-up (LevelUpToast.tsx). Nothing shows while either loads, because most
// of the time there is no level-up to show.
const LevelUpToast = lazyIsland(
  () => import('./LevelUpToast').then((module) => module.LevelUpToast),
  { zone: 'toast', labelKey: 'loading.levelUp', eager: true, quiet: true },
)

/** The toast zone's level-up slot: nothing on the server, the lazily loaded toast after. */
export function LevelUpToastMount() {
  return <LevelUpToast />
}
