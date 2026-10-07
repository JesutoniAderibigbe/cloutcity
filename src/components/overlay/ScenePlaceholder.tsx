'use client'

import { useEffect } from 'react'
import { markMapPlayable } from '@/state/mapPlayable'

/**
 * The scene placeholder until the 3D city lands (S04a). It is the whole "map" for now, so it
 * marks the map playable as soon as it mounts; audio waits for that (src/state/mapPlayable.ts).
 */
export function ScenePlaceholder() {
  useEffect(() => markMapPlayable(), [])
  return (
    <div
      aria-hidden="true"
      className="h-full w-full bg-gradient-to-b from-night-800 via-night-900 to-night-950"
    />
  )
}
