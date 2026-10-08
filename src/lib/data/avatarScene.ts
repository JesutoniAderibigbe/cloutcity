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

/** Every swatch token the options use (skin, hair, garments) → its hex, sorted by token. */
export function swatchHexes(
  options: AvatarOptions,
  palette: Readonly<Record<string, string>>,
): Record<string, string> {
  const tokens = [...options.skinTones, ...options.hairColors, ...options.garmentColors].map(
    (swatch) => swatch.token,
  )
  const colors: Record<string, string> = {}
  for (const token of [...new Set(tokens)].sort()) {
    const hex = palette[token]
    if (hex !== undefined) colors[token] = hex
  }
  return colors
}

/**
 * data/avatar/swatches.derived.json: the creator's swatch colours (S16a A3), so its chunk paints
 * every swatch without the look runtime's model refs or the whole palette.
 */
export function deriveAvatarSwatches(
  options: AvatarOptions,
  palette: Readonly<Record<string, string>>,
): { readonly version: 1; readonly colors: Record<string, string> } {
  return { version: 1, colors: swatchHexes(options, palette) }
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
  const colors = swatchHexes(sources.options, sources.palette)
  return {
    version: 1,
    rig: toModelRef(rig),
    models,
    colors,
    attachments: sources.avatarLook.attachments,
    preview: sources.avatarLook.preview,
  }
}
