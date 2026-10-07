'use client'

/**
 * The player's avatar placeholder at their home (S05). It stands on the land top and rescales
 * with the camera distance on every controls change, then requests one frame: the map renders
 * on demand, so the avatar never adds idle frames.
 */
import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
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
}

export function PlayerAvatar({ at, groundY, color, toonRamp, avatar }: PlayerAvatarProps) {
  const built = useMemo(() => buildAvatar(color, toonRamp, avatar), [color, toonRamp, avatar])
  const controls = useThree((state) => state.controls)
  const invalidate = useThree((state) => state.invalidate)

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

  return <primitive object={built.group} />
}
