'use client'

/**
 * The locals inside a venue (S43): its own lazy chunk with the kit bakers (crowdLayer.ts), loaded
 * once the interior is up. It bakes the tier's kits from the pedestrian models (cached by the model
 * runtime, never precached) and shows whoever the planner put inside (src/lib/world/venueCrowd.ts).
 * If the models cannot load (offline before they were ever fetched) the venue is simply empty of
 * locals: an expected condition, logged at info.
 */
import { useEffect, useMemo, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { MeshToonMaterial } from 'three'
import type { QualityTier } from '@/lib/data/schemas/config'
import { log } from '@/lib/log'
import { useReducedMotion } from '@/lib/useReducedMotion'
import type { CrowdMember } from '@/lib/world/venueCrowd'
import { toonRamp } from '../apartment/data'
import { modelsConfig } from '../apartment/modelsConfig'
import { createToonRamp } from '../toonRamp'
import { bakeCrowdKits, createCrowdLayer, type CrowdLayer } from './crowdLayer'
import { crowdConfig } from './data'

/** Logged when the locals' models cannot load or bake. */
export const CROWD_FAILED_MESSAGE = 'venue crowd: the locals could not load; the venue stays empty'

export default function VenueCrowd({
  interiorId,
  members,
  tier,
  bpm,
}: {
  readonly interiorId: string
  readonly members: readonly CrowdMember[]
  readonly tier: QualityTier
  readonly bpm: number
}) {
  const invalidate = useThree((state) => state.invalidate)
  const reduced = useReducedMotion()
  const [layer, setLayer] = useState<{ tier: QualityTier; layer: CrowdLayer } | null>(null)
  const material = useMemo(() => {
    const gradientMap = createToonRamp(toonRamp)
    // Instanced toon with instance colours, as the townsfolk: never a new kind of program.
    return { material: new MeshToonMaterial({ gradientMap }), gradientMap }
  }, [])
  useEffect(
    () => () => {
      material.material.dispose()
      material.gradientMap.dispose()
    },
    [material],
  )

  useEffect(() => {
    let active = true
    let built: CrowdLayer | null = null
    let dispose = () => {}
    const config = crowdConfig(tier, interiorId)
    if (config.max === 0) return
    bakeCrowdKits(tier, config, modelsConfig().cacheMaxEntries).then(
      (kits) => {
        dispose = () => {
          for (const kit of kits) kit.baked.dispose()
        }
        if (!active) {
          dispose()
          return
        }
        built = createCrowdLayer(kits, material.material, config, bpm, config.max)
        setLayer({ tier, layer: built })
      },
      (error: unknown) => {
        log.info(CROWD_FAILED_MESSAGE, {
          error: error instanceof Error ? error.message : String(error),
        })
      },
    )
    return () => {
      active = false
      built?.dispose()
      dispose()
    }
  }, [tier, interiorId, bpm, material])

  const shown = layer !== null && layer.tier === tier ? layer.layer : null
  useEffect(() => {
    if (shown === null) return
    shown.setMembers(members)
    invalidate()
  }, [shown, members, invalidate])

  useFrame((state) => {
    if (shown === null) return
    if (shown.update(state.clock.elapsedTime, reduced) && reduced) invalidate()
  })

  return shown === null ? null : <primitive object={shown.group} />
}
