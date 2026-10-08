'use client'

/**
 * The player's hand-made avatar with its own model provider. PlayerAvatar imports this module
 * lazily once the city has drawn, so the glTF loader, the meshopt decoder, the model runtime and
 * the look runtime (S16a: LookAvatar with the look options and the derived avatar refs) load in
 * their own chunk, off the playable path, instead of growing the 3D chunk. Until the HUD has read
 * the save (no look yet) it draws scene.json's default parts.
 */
import { useEffect, useMemo } from 'react'
import type { PublicAvatar } from '@/engine/appearance'
import { LookAvatar } from './LookAvatar'
import type { ResolvedLook } from './resolveLook'
import { createToonRamp } from '../toonRamp'
import { AvatarModel, type AvatarParts, type AvatarStatus } from '../models/AvatarModel'
import { ModelsProvider } from '../models/runtime'
import type { ModelsConfig, ModelTier } from '../models/types'

export default function PlayerAvatarModel({
  look,
  onResolved,
  parts,
  heightM,
  models,
  tier,
  toonRamp,
  onStatus,
}: {
  /** The player's look, or null before the HUD has read the save. */
  readonly look: PublicAvatar | null
  readonly onResolved: (resolved: ResolvedLook) => void
  readonly parts: AvatarParts
  readonly heightM: number
  readonly models: ModelsConfig
  readonly tier: ModelTier
  /** The city's toon steps, for `models.shading: toon`. */
  readonly toonRamp: readonly number[]
  readonly onStatus: (status: AvatarStatus) => void
}) {
  const gradientMap = useMemo(
    () => (models.shading === 'toon' ? createToonRamp(toonRamp) : undefined),
    [models.shading, toonRamp],
  )
  useEffect(() => () => gradientMap?.dispose(), [gradientMap])
  return (
    <ModelsProvider config={models} tier={tier} {...(gradientMap && { gradientMap })}>
      {/* The parent is scaled to the avatar's height over a unit-tall capsule, so the model is
          fitted to unit height inside it. */}
      {look === null ? (
        <group scale={1 / heightM}>
          <AvatarModel
            parts={parts}
            clip={models.player.clip}
            animate={false}
            onStatus={onStatus}
          />
        </group>
      ) : (
        <LookAvatar
          avatar={look}
          clip={models.player.clip}
          animate={false}
          fitHeight
          onStatus={onStatus}
          onResolved={onResolved}
        />
      )}
    </ModelsProvider>
  )
}
