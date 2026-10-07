'use client'

/**
 * The player's avatar at their home (S05). The toon capsule placeholder stands there at once;
 * the hand-made avatar (S04h: the shared rig with a head and a body) loads after the map is
 * playable and replaces it once assembled. The capsule stays while the model loads, when it
 * fails, on devices reporting little memory and on the tiers in scene.json
 * `models.player.capsuleTiers`. Both rescale with the camera distance on every controls change,
 * then request one frame: the map renders on demand, so the avatar never adds idle frames.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { MapControls } from 'three/addons/controls/MapControls.js'
import type { LocalPoint } from '@/lib/geo/projection'
import { toScene } from '../geo/coords'
import type { AvatarParts, AvatarStatus } from '../models/AvatarModel'
import type { ModelsConfig, ModelTier } from '../models/types'
import { avatarSize, buildAvatar, type AvatarConfig } from './buildAvatar'

const PlayerAvatarModel = lazy(() => import('./PlayerAvatarModel'))

/** The hand-made avatar for the map, resolved on the server (CityScene.tsx). */
export interface PlayerModel {
  readonly parts: AvatarParts
  /** The assembled avatar's height in metres (its head's top), to fit the capsule's height. */
  readonly heightM: number
}

interface PlayerAvatarProps {
  /** The home's point in local metres. */
  readonly at: LocalPoint
  /** The land top the avatar stands on. */
  readonly groundY: number
  readonly color: string
  readonly toonRamp: readonly number[]
  readonly avatar: AvatarConfig
  readonly model: PlayerModel
  readonly models: ModelsConfig
  readonly tier: ModelTier
  /** False until the city has drawn: the model never competes with the playable path. */
  readonly loadModel: boolean
}

/** navigator.deviceMemory (GB, Chromium only); undefined where the browser does not say. */
function deviceMemoryGB(): number | undefined {
  if (typeof navigator === 'undefined') return undefined
  const memory: unknown = (navigator as Navigator & { deviceMemory?: unknown }).deviceMemory
  return typeof memory === 'number' ? memory : undefined
}

/** Whether this device and tier draw the hand-made avatar instead of the capsule. */
export function wantsAvatarModel(
  player: ModelsConfig['player'],
  tier: ModelTier,
  memoryGB: number | undefined,
): boolean {
  if (player.capsuleTiers.includes(tier)) return false
  return memoryGB === undefined || memoryGB >= player.minDeviceMemoryGB
}

export function PlayerAvatar({
  at,
  groundY,
  color,
  toonRamp,
  avatar,
  model,
  models,
  tier,
  loadModel,
}: PlayerAvatarProps) {
  const built = useMemo(() => buildAvatar(color, toonRamp, avatar), [color, toonRamp, avatar])
  const controls = useThree((state) => state.controls)
  const invalidate = useThree((state) => state.invalidate)
  const [showModel] = useState(() => wantsAvatarModel(models.player, tier, deviceMemoryGB()))

  useEffect(() => () => built.dispose(), [built])

  useEffect(() => {
    toScene(at, groundY, built.group.position)
    invalidate()
  }, [built, at, groundY, invalidate])

  useEffect(() => {
    if (!(controls instanceof MapControls)) return
    const update = () => {
      built.setHeight(avatarSize(controls.getDistance(), avatar))
      invalidate()
    }
    update()
    controls.addEventListener('change', update)
    return () => controls.removeEventListener('change', update)
  }, [built, controls, avatar, invalidate])

  const onStatus = useCallback(
    (status: AvatarStatus) => {
      built.setCapsuleVisible(status !== 'ready')
      invalidate()
    },
    [built, invalidate],
  )

  return (
    <primitive object={built.group}>
      {showModel && loadModel && (
        <Suspense fallback={null}>
          <PlayerAvatarModel
            parts={model.parts}
            heightM={model.heightM}
            models={models}
            tier={tier}
            onStatus={onStatus}
          />
        </Suspense>
      )}
    </primitive>
  )
}
