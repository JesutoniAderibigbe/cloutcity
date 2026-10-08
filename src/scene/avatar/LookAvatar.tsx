'use client'

/**
 * The player's look as a hand-made avatar (S16a, D9), for every place that draws one: the map
 * (PlayerAvatarModel), the apartment, the creator preview and later other players (S31). It
 * repairs the look (an older build's or another player's ids), lays worn items over it
 * (src/engine/avatarLook.ts `effectiveLook`), resolves models and colours (resolveLook.ts) and
 * draws them with AvatarModel. It imports the full look options and the derived avatar refs, so
 * it only ever loads in lazy chunks, never on the playable path (PERF-6).
 */
import { useEffect, useMemo } from 'react'
import avatarRefsJson from '@data/avatar/scene.derived.json'
import { repairLook, type PublicAvatar } from '@/engine/appearance'
import { effectiveLook } from '@/engine/avatarLook'
import { engineConfig } from '@/engine/config'
import { creatorConfig } from '@/engine/creatorConfig'
import { AvatarModel, type AssembledAvatar, type AvatarStatus } from '../models/AvatarModel'
import { resolveLook, type ResolvedLook } from './resolveLook'
import type { AvatarSceneRefs } from './types'

/** The derived refs (validated by AvatarSceneFileSchema in the data tests). */
export const avatarRefs = avatarRefsJson as unknown as AvatarSceneRefs

/** The look as models and colours, from a public avatar (repaired first). */
export function resolveAvatar(avatar: PublicAvatar): ResolvedLook {
  const look = repairLook(avatar.look, engineConfig).look
  const drawn = effectiveLook({ look, worn: avatar.worn }, engineConfig, creatorConfig)
  return resolveLook(drawn, creatorConfig.options, avatarRefs)
}

export function LookAvatar({
  avatar,
  clip,
  animate,
  name,
  fitHeight = false,
  shadows,
  onStatus,
  onAssembled,
  onResolved,
}: {
  readonly avatar: PublicAvatar
  readonly clip: string
  readonly animate: boolean
  readonly name?: string
  /** Scales the avatar to unit height (the map fits it inside its unit-tall capsule). */
  readonly fitHeight?: boolean
  readonly shadows?: boolean
  readonly onStatus?: (status: AvatarStatus) => void
  readonly onAssembled?: (avatar: AssembledAvatar | null) => void
  /** What the look resolved to (the test hooks read it). */
  readonly onResolved?: (resolved: ResolvedLook) => void
}) {
  const key = JSON.stringify(avatar)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const resolved = useMemo(() => resolveAvatar(avatar), [key])
  useEffect(() => onResolved?.(resolved), [resolved, onResolved])
  const scale = fitHeight ? resolved.scale / resolved.heightM : resolved.scale
  return (
    <AvatarModel
      parts={resolved.parts}
      colors={resolved.colors}
      clip={clip}
      animate={animate}
      scale={scale}
      {...(name === undefined ? {} : { name })}
      {...(shadows === undefined ? {} : { shadows })}
      {...(onStatus === undefined ? {} : { onStatus })}
      {...(onAssembled === undefined ? {} : { onAssembled })}
    />
  )
}
