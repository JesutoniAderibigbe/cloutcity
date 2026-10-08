/**
 * data/avatar/engine.derived.json is the S16a source files as the engine reads them on the
 * playable path (src/lib/data/avatarIds.ts `AvatarEngineTables`; PERF-6). It must always equal
 * what `deriveAvatarEngineTables` makes of the sources: after editing options.json, traits.json,
 * creator.json or neighborhoods.json, run `npm run avatar:update` and commit the result.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deriveAvatarEngineTables } from './avatarDerive'
import { deriveAvatarSceneRefs, deriveAvatarSwatches } from './avatarScene'
import { scene, theme } from './config'
import { items } from './content'
import { modelManifest } from './models'
import { AvatarOptionsSchema, TraitsFileSchema } from './schemas/avatar'
import { NeighborhoodsFileSchema } from './schemas/content'
import { CreatorConfigSchema } from './schemas/creator'

const DATA = join(import.meta.dirname, '../../../data')
const DERIVED = '../../../data/avatar/engine.derived.json'
const SCENE_DERIVED = '../../../data/avatar/scene.derived.json'
const SWATCHES_DERIVED = '../../../data/avatar/swatches.derived.json'
const readJson = (file: string): unknown => JSON.parse(readFileSync(join(DATA, file), 'utf8'))

// toMatchFileSnapshot would quietly write a missing file, so a deleted one would pass.
for (const file of [DERIVED, SCENE_DERIVED, SWATCHES_DERIVED]) {
  if (!existsSync(new URL(file, import.meta.url))) {
    throw new Error(`${file} is missing: run \`npm run avatar:update\` and commit it`)
  }
}

describe('data/avatar/engine.derived.json', () => {
  it('is what the source files derive to (run `npm run avatar:update` after editing them)', async () => {
    const tables = deriveAvatarEngineTables({
      options: AvatarOptionsSchema.parse(readJson('avatar/options.json')),
      traits: TraitsFileSchema.parse(readJson('avatar/traits.json')),
      creator: CreatorConfigSchema.parse(readJson('config/creator.json')),
      neighborhoods: NeighborhoodsFileSchema.parse(readJson('homes/neighborhoods.json'))
        .neighborhoods,
    })
    await expect(`${JSON.stringify(tables, null, 2)}\n`).toMatchFileSnapshot(
      DERIVED,
      'The S16a sources changed: run `npm run avatar:update` and commit the derived file.',
    )
  })

  it('data/avatar/scene.derived.json is the avatar models, colours and placement (run `npm run avatar:update`)', async () => {
    const refs = deriveAvatarSceneRefs({
      options: AvatarOptionsSchema.parse(readJson('avatar/options.json')),
      manifest: modelManifest.models,
      palette: theme.models,
      avatarLook: scene.avatarLook,
      itemModels: items.flatMap((item) =>
        item.look?.part === 'attachment' ? [item.look.model] : [],
      ),
    })
    await expect(`${JSON.stringify(refs, null, 2)}\n`).toMatchFileSnapshot(
      SCENE_DERIVED,
      'The avatar sources changed: run `npm run avatar:update` and commit the derived file.',
    )
  })

  it('data/avatar/swatches.derived.json is the creator swatch colours (run `npm run avatar:update`)', async () => {
    const swatches = deriveAvatarSwatches(
      AvatarOptionsSchema.parse(readJson('avatar/options.json')),
      theme.models,
    )
    await expect(`${JSON.stringify(swatches, null, 2)}\n`).toMatchFileSnapshot(
      SWATCHES_DERIVED,
      'The avatar swatches changed: run `npm run avatar:update` and commit the derived file.',
    )
  })
})
