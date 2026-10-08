/**
 * Derives data/avatar/scene.derived.json (src/scene/avatar/types.ts `AvatarSceneRefs`) from the
 * look options, the S04h manifest, theme.json `models` and scene.json `avatarLook`. Tests and
 * the update script use it; the game reads the derived file.
 */
import type { AvatarSceneRefs } from '@/scene/avatar/types'
import type { ModelManifestEntry } from './schemas/assets'
import type { AvatarOptions } from './schemas/avatar'
import type { SceneConfig } from './schemas/scene'
import { toModelRef } from './models'

/** Every model id the options name (heads, hair pieces, attachments, bodies). */
export function optionModelIds(options: AvatarOptions): string[] {
  const ids = [
    ...options.hairStyles.flatMap((style) => [style.head, ...(style.piece ? [style.piece] : [])]),
    ...[...options.facialHair, ...options.headwear, ...options.eyewear, ...options.ears].flatMap(
      (option) => (option.model === undefined ? [] : [option.model]),
    ),
    ...options.outfits.map((outfit) => outfit.body),
  ]
  return [...new Set(ids)]
}

export function deriveAvatarSceneRefs(sources: {
  readonly options: AvatarOptions
  readonly manifest: readonly ModelManifestEntry[]
  /** theme.json `models`: token → hex. */
  readonly palette: Readonly<Record<string, string>>
  readonly avatarLook: SceneConfig['avatarLook']
  /** Item attachment models (items.json wearables' `look`). */
  readonly itemModels: readonly string[]
}): AvatarSceneRefs {
  const byId = new Map(sources.manifest.map((model) => [model.id, model]))
  const rig = byId.get('avatar-rig')
  if (rig === undefined) throw new Error('the manifest has no avatar-rig')
  const models: Record<string, ReturnType<typeof toModelRef>> = {}
  for (const id of [...optionModelIds(sources.options), ...sources.itemModels].sort()) {
    const model = byId.get(id)
    if (model !== undefined) models[id] = toModelRef(model)
  }
  const tokens = [
    ...sources.options.skinTones,
    ...sources.options.hairColors,
    ...sources.options.garmentColors,
  ].map((swatch) => swatch.token)
  const colors: Record<string, string> = {}
  for (const token of [...new Set(tokens)].sort()) {
    const hex = sources.palette[token]
    if (hex !== undefined) colors[token] = hex
  }
  return {
    version: 1,
    rig: toModelRef(rig),
    models,
    colors,
    attachments: sources.avatarLook.attachments,
    preview: sources.avatarLook.preview,
  }
}
