'use client'

/**
 * The decor models at a tier for a room scene (the apartment, S16/S40; a venue interior, S43),
 * loaded in their own lazy chunk (decorModels.ts) after the room is up; null until then, and for
 * good if they fail (the code-built stand-ins stay: an expected condition, e.g. offline, so it
 * logs at info). Their lamps glow with `glow` (the scene's night-glow uniform).
 */
import { useEffect, useState } from 'react'
import type { IUniform } from 'three'
import type { QualityTier } from '@/lib/data/schemas/config'
import { log } from '@/lib/log'
import type { DecorModels } from './decorModels'

export function useDecorModels(tier: QualityTier, glow: IUniform<number>): DecorModels | null {
  const [decor, setDecor] = useState<{ tier: QualityTier; models: DecorModels } | null>(null)
  useEffect(() => {
    let active = true
    let loaded: DecorModels | null = null
    import('./decorModels')
      .then((module) => module.loadDecorModels(tier, glow))
      .then(
        (models) => {
          if (!active) {
            models.dispose()
            return
          }
          loaded = models
          setDecor({ tier, models })
        },
        (error: unknown) => {
          log.info('room decor models failed to load', {
            error: error instanceof Error ? error.message : String(error),
          })
        },
      )
    return () => {
      active = false
      loaded?.dispose()
    }
  }, [tier, glow])
  return decor !== null && decor.tier === tier ? decor.models : null
}
