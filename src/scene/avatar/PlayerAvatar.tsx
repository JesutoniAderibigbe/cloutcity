'use client'

/**
 * The player's avatar placeholder where they stand: home (S05) or a place after a trip (S08). It stands on the land top and rescales
 * with the camera distance on every controls change, then requests one frame: the map renders
 * on demand, so the avatar never adds idle frames.
 */
import { useEffect, useMemo, type RefObject } from 'react'
import { useThree } from '@react-three/fiber'
import type { Group } from 'three'
import { MapControls } from 'three/addons/controls/MapControls.js'
import type { LocalPoint } from '@/lib/geo/projection'
import { toScene } from '../geo/coords'
import { avatarSize, buildAvatar, type AvatarConfig } from './buildAvatar'

interface PlayerAvatarProps {
  /** The home's point in local metres. */
  readonly at: LocalPoint
  /** The land top the avatar stands on. */
  readonly groundY: number
  readonly color: string
  readonly toonRamp: readonly number[]
  readonly avatar: AvatarConfig
  /** Called once the avatar stands at its home (the map is playable from its next frame). */
  readonly onPlaced?: () => void
  /** Receives the avatar's group, which a trip moves along its route (S08). */
  readonly groupRef?: RefObject<Group | null>
}

export function PlayerAvatar({
  at,
  groundY,
  color,
  toonRamp,
  avatar,
  onPlaced,
  groupRef,
}: PlayerAvatarProps) {
  const built = useMemo(() => buildAvatar(color, toonRamp, avatar), [color, toonRamp, avatar])
  const controls = useThree((state) => state.controls)
  const invalidate = useThree((state) => state.invalidate)

  useEffect(() => () => built.dispose(), [built])

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
      built.setHeight(avatarSize(controls.getDistance(), avatar))
      invalidate()
    }
    update()
    controls.addEventListener('change', update)
    return () => controls.removeEventListener('change', update)
  }, [built, controls, avatar, invalidate])

  return <primitive object={built.group} />
}
