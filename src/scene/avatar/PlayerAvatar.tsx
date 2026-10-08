'use client'

/**
 * The player's avatar where they stand: home (S05) or a place after a trip (S08). The toon
 * capsule placeholder stands there at once; the hand-made avatar (S04h: the shared rig with a
 * head and a body) loads after the city has drawn and replaces it once assembled. The capsule
 * stays while the model loads, when it fails, on devices reporting little memory and on the
 * tiers in scene.json `models.player.capsuleTiers`. Both rescale with the camera distance on
 * every controls change, then request one frame: the map renders on demand, so the avatar never
 * adds idle frames.
 *
 * S16a: the avatar follows the player's look (src/state/playerLook.ts, written by the HUD), and
 * the capsule body takes the colour of the top they wear (`lookTint`), so the look still shows
 * on the low tier and while the model loads. The look's models resolve in the lazy model chunk.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, type RefObject } from 'react'
import { useThree } from '@react-three/fiber'
import type { Group } from 'three'
import { MapControls } from 'three/addons/controls/MapControls.js'
import type { LocalPoint } from '@/lib/geo/projection'
import { usePlayerLook } from '@/state/playerLook'
import { toScene } from '../geo/coords'
import type { AvatarParts, AvatarStatus } from '../models/AvatarModel'
import type { ModelsConfig, ModelTier } from '../models/types'
import { buildAvatar, mapCharacterHeight, type AvatarConfig } from './buildAvatar'
import { lookTint, type LookTintTable } from './lookTint'
import type { ResolvedLook } from './resolveLook'

const PlayerAvatarModel = lazy(() => import('./PlayerAvatarModel'))

/** The hand-made avatar for the map, resolved on the server (CityScene.tsx). */
export interface PlayerModel {
  readonly parts: AvatarParts
  /** The assembled avatar's height in metres (its head's top), to fit the capsule's height. */
  readonly heightM: number
  /** The capsule colour of each top (S16a `lookTint`). */
  readonly tint: LookTintTable
}

interface PlayerAvatarProps {
  /** The home's point in local metres. */
  readonly at: LocalPoint
  /** The land top the avatar stands on. */
  readonly groundY: number
  readonly color: string
  readonly toonRamp: readonly number[]
  readonly avatar: AvatarConfig
  /** The map style's tallest person (scene.json `mapStyles.*.characterMaxM`). */
  readonly characterMaxM: number
  readonly model: PlayerModel
  readonly models: ModelsConfig
  readonly tier: ModelTier
  /** False until the city has drawn: the model never competes with the playable path. */
  readonly loadModel: boolean
  /** Called once the avatar stands at its home (the map is playable from its next frame). */
  readonly onPlaced?: () => void
  /** Receives the avatar's group, which a trip moves along its route (S08). */
  readonly groupRef?: RefObject<Group | null>
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
  characterMaxM,
  model,
  models,
  tier,
  loadModel,
  onPlaced,
  groupRef,
}: PlayerAvatarProps) {
  const built = useMemo(() => buildAvatar(color, toonRamp, avatar), [color, toonRamp, avatar])
  const look = usePlayerLook()
  const tint = look === null ? null : lookTint(look, model.tint)
  const controls = useThree((state) => state.controls)
  const invalidate = useThree((state) => state.invalidate)
  // Follows the active tier: a runtime step-down to a capsule tier swaps the capsule back in.
  const showModel = useMemo(
    () => wantsAvatarModel(models.player, tier, deviceMemoryGB()),
    [models.player, tier],
  )

  useEffect(() => () => built.dispose(), [built])

  useEffect(() => {
    built.setBodyColor(tint ?? color)
    invalidate()
  }, [built, tint, color, invalidate])

  const onResolved = useCallback(
    (resolved: ResolvedLook) => {
      // The scene test hook reads what the look resolved to from the avatar's group.
      built.setLookInfo({
        head: resolved.parts.head.id,
        body: resolved.parts.body.id,
        attachments: (resolved.parts.attachments ?? []).map((part) => part.ref.id),
        colors: resolved.colors,
        scale: resolved.scale,
        missing: resolved.missing,
      })
    },
    [built],
  )

  useEffect(() => {
    if (groupRef === undefined) return
    groupRef.current = built.group
    return () => {
      if (groupRef.current === built.group) groupRef.current = null
    }
  }, [built, groupRef])

  useEffect(() => {
    toScene(at, groundY, built.group.position)
    onPlaced?.()
    invalidate()
  }, [built, at, groundY, onPlaced, invalidate])

  useEffect(() => {
    if (!(controls instanceof MapControls)) return
    const update = () => {
      built.setHeight(mapCharacterHeight(controls.getDistance(), avatar, characterMaxM))
      invalidate()
    }
    update()
    controls.addEventListener('change', update)
    return () => controls.removeEventListener('change', update)
  }, [built, controls, avatar, characterMaxM, invalidate])

  const onStatus = useCallback(
    (status: AvatarStatus) => {
      built.setCapsuleVisible(status !== 'ready')
      invalidate()
    },
    [built, invalidate],
  )

  const drawModel = showModel && loadModel
  // 3D-1: whenever the hand-made avatar is not drawn (a step-down to a capsule tier unmounts
  // it), the capsule comes back, whatever the model last reported.
  useEffect(() => {
    if (drawModel) return
    built.setCapsuleVisible(true)
    invalidate()
  }, [built, drawModel, invalidate])

  return (
    <primitive object={built.group}>
      {drawModel && (
        <Suspense fallback={null}>
          <PlayerAvatarModel
            look={look}
            onResolved={onResolved}
            parts={model.parts}
            heightM={model.heightM}
            models={models}
            tier={tier}
            toonRamp={toonRamp}
            onStatus={onStatus}
          />
        </Suspense>
      )}
    </primitive>
  )
}
