'use client'

/**
 * The sheet zone's sound settings slot: nothing until Sound settings is tapped in the HUD's More
 * panel, then the settings sheet. The sheet, with the audio stores and copy it needs, is a feature island: it loads in
 * its own chunk on the first open, with a loading state in the sheet zone (DEC-11).
 */
import { useSyncExternalStore } from 'react'
import { lazyIsland } from '@/components/overlay/lazyIsland'
import { soundSheetStore } from './soundSheet'

const SoundSettingsSheet = lazyIsland(
  () => import('./SoundSettingsSheet').then((module) => module.SoundSettingsSheet),
  { zone: 'sheet', labelKey: 'loading.soundSettings' },
)

const openNow = () => soundSheetStore.getState().open
const closed = () => false

export function SoundSheetMount() {
  const open = useSyncExternalStore(soundSheetStore.subscribe, openNow, closed)
  return open ? <SoundSettingsSheet /> : null
}
