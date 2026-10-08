'use client'

/**
 * The player's avatar in their apartment (S16a): their look (src/state/playerLook.ts) as a
 * hand-made avatar standing at the home's `avatarAnchor`, posed once (no idle frames). It is its
 * own lazy chunk, loaded after the room is up, with the model runtime and the look runtime, so
 * the apartment chunk does not grow. On every tier it fits perf.json `apartment.avatarReserve`
 * (two parts and at most four attachments: six draw calls; about a thousand triangles); on a
 * device reporting little memory nothing is drawn, as on the map's capsule rule.
 */
import { useEffect, useMemo } from 'react'
import type { QualityTier } from '@/lib/data/schemas/config'
import { usePlayerLook } from '@/state/playerLook'
import { ModelsProvider } from '../models/runtime'
import { LookAvatar } from '../avatar/LookAvatar'
import { createToonRamp } from '../toonRamp'
import { modelsConfig } from './modelsConfig'
import type { RoomInterior } from './data'
import { ROOM_AVATAR_NAME } from './types'

const DEG = Math.PI / 180

function deviceMemoryGB(): number | undefined {
  if (typeof navigator === 'undefined') return undefined
  const memory: unknown = (navigator as Navigator & { deviceMemory?: unknown }).deviceMemory
  return typeof memory === 'number' ? memory : undefined
}

export default function RoomAvatar({
  interior,
  tier,
  toonRamp,
  avatarHeightM,
}: {
  readonly interior: RoomInterior
  readonly tier: QualityTier
  readonly toonRamp: readonly number[]
  /** How tall the avatar stands in the room (scene.json `apartment.avatarHeightM`). */
  readonly avatarHeightM: number
}) {
  const look = usePlayerLook()
  const config = useMemo(() => modelsConfig(), [])
  const gradientMap = useMemo(
    () => (config.shading === 'toon' ? createToonRamp(toonRamp) : undefined),
    [config.shading, toonRamp],
  )
  useEffect(() => () => gradientMap?.dispose(), [gradientMap])
  const memory = deviceMemoryGB()
  if (look === null || (memory !== undefined && memory < config.player.minDeviceMemoryGB)) {
    return null
  }
  const { position, rotationDeg } = interior.avatarAnchor
  return (
    <ModelsProvider config={config} tier={tier} {...(gradientMap && { gradientMap })}>
      <group
        name={ROOM_AVATAR_NAME}
        position={position}
        rotation={[0, rotationDeg * DEG, 0]}
        scale={avatarHeightM}
      >
        <LookAvatar
          fitHeight
          avatar={look}
          clip={config.player.clip}
          animate={false}
          shadows={tier === 'high'}
        />
      </group>
    </ModelsProvider>
  )
}
