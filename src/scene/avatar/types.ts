/**
 * What the look runtime (S16a) reads in its lazy chunk: data/avatar/scene.derived.json, the
 * avatar models the look options name (S04h manifest entries as ModelRefs), the colour of every
 * palette token they use, where each placed accessory sits, and the preview's studio light.
 * Derived at build time (src/lib/data/avatar-derived.test.ts, `npm run avatar:update`), so the
 * browser never loads the whole manifest or theme for an avatar.
 */
import type { SceneConfig } from '@/lib/data/schemas/scene'
import type { ModelRef } from '../models/types'

export interface AvatarSceneRefs {
  readonly version: 1
  /**
   * Avatar models by id: every face, rig, body and accessory the options name that exists and
   * is not pending its refit (S16b).
   */
  readonly models: Readonly<Record<string, ModelRef>>
  /** Palette token → sRGB hex, for every look token theme.json has. */
  readonly colors: Readonly<Record<string, string>>
  readonly attachments: SceneConfig['avatarLook']['attachments']
  readonly preview: SceneConfig['avatarLook']['preview']
}
