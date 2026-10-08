/**
 * data/homes/engine.derived.json is the S40 home sources as the engine reads them on the playable
 * path (src/lib/data/homesDerive.ts; PERF-6). It must always equal what `deriveHomeEngineTables`
 * makes of the sources: after editing data/homes/interiors.json or finishes.json, run
 * `npm run homes:update` and commit the result.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deriveHomeEngineTables } from './homesDerive'
import { FinishesFileSchema, HomeInteriorsFileSchema } from './schemas/content'

const DATA = join(import.meta.dirname, '../../../data')
const DERIVED = '../../../data/homes/engine.derived.json'
const readJson = (file: string): unknown => JSON.parse(readFileSync(join(DATA, file), 'utf8'))

// toMatchFileSnapshot would quietly write a missing file, so a deleted one would pass.
if (!existsSync(new URL(DERIVED, import.meta.url))) {
  throw new Error(`${DERIVED} is missing: run \`npm run homes:update\` and commit it`)
}

describe('data/homes/engine.derived.json', () => {
  it('is what the home sources derive to (run `npm run homes:update` after editing them)', async () => {
    const tables = deriveHomeEngineTables({
      interiors: HomeInteriorsFileSchema.parse(readJson('homes/interiors.json')).homes,
      finishes: FinishesFileSchema.parse(readJson('homes/finishes.json')).finishes,
    })
    await expect(`${JSON.stringify(tables, null, 2)}\n`).toMatchFileSnapshot(
      DERIVED,
      'The S40 home sources changed: run `npm run homes:update` and commit the derived file.',
    )
  })
})
