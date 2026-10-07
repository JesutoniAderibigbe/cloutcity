'use client'

import { useMemo } from 'react'
import { cloutProgress } from '@/engine/clout'
import { engineConfig } from '@/engine/config'
import { cloutLevelName } from '@/lib/economyCopy'
import { useGameStore } from '@/state/store'
import { CloutMeter } from './CloutMeter'

/**
 * The store-backed adapter for the HUD's clout meter: the engine's `cloutProgress` turned into
 * CloutMeter's props. Loaded lazily by CloutHudMount (DEC-11), so the store and engine stay out
 * of the shell.
 */
export function CloutHudIsland() {
  const player = useGameStore((state) => state.player)
  const progress = useMemo(() => cloutProgress(player, engineConfig), [player])
  const { next } = progress
  return (
    <CloutMeter
      levelName={cloutLevelName(progress.level.id)}
      total={progress.total}
      next={next === null ? null : { name: cloutLevelName(next.id), minClout: next.minClout }}
      pct={progress.pct}
      atMax={progress.atMax}
    />
  )
}
