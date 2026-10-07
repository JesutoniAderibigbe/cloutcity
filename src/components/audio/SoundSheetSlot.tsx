'use client'

/**
 * The sheet zone's sound settings slot: nothing until the gear is tapped, then the settings
 * sheet, loaded on demand in its own chunk (React.lazy, so it stays out of the shell and out of
 * the next/dynamic 3D chunk).
 */
import { Suspense, lazy, useSyncExternalStore } from 'react'
import { soundSheetStore } from './soundSheet'

const SoundSettingsSheet = lazy(() =>
  import('./SoundSettingsSheet').then((module) => ({ default: module.SoundSettingsSheet })),
)

const openNow = () => soundSheetStore.getState().open
const closed = () => false

export function SoundSheetSlot() {
  const open = useSyncExternalStore(soundSheetStore.subscribe, openNow, closed)
  if (!open) return null
  return (
    <Suspense fallback={null}>
      <SoundSettingsSheet />
    </Suspense>
  )
}
