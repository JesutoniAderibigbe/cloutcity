/**
 * Determinism against the real data. Always: the committed geo files hash to the committed
 * manifest. With a valid download cache (after `npm run geo:build`): rebuilding from the cache
 * gives byte-identical files. Without the cache that part is skipped (npm test stays offline).
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GeoManifestSchema } from '../../src/lib/data/schemas/world'
import { CACHE_DIR, buildFromSources, readLock } from './build'
import { SOURCE_DEFINITIONS } from './lock'
import { OUTPUT_FILES } from './transform'

const DATA = join(import.meta.dirname, '../../data')
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const manifest = GeoManifestSchema.parse(
  JSON.parse(readFileSync(join(DATA, OUTPUT_FILES.manifest), 'utf8')),
)

const lock = await readLock()
const cached = new Map<string, Uint8Array>()
for (const definition of SOURCE_DEFINITIONS) {
  const path = join(CACHE_DIR, definition.file)
  if (existsSync(path)) cached.set(definition.id, new Uint8Array(readFileSync(path)))
}
const cacheValid =
  lock !== undefined &&
  lock.sources.every((entry) => {
    const bytes = cached.get(entry.id)
    return bytes !== undefined && sha256(bytes) === entry.sha256
  })

describe('committed geo files', () => {
  it('hash to the committed manifest, which lists every output', () => {
    expect(manifest.files.map((f) => f.path)).toEqual(
      Object.values(OUTPUT_FILES)
        .filter((path) => path !== OUTPUT_FILES.manifest)
        .sort(),
    )
    for (const file of manifest.files) {
      const bytes = readFileSync(join(DATA, file.path))
      expect({ path: file.path, bytes: bytes.byteLength, sha256: sha256(bytes) }).toEqual({
        path: file.path,
        bytes: file.bytes,
        sha256: file.sha256,
      })
    }
  })

  it('the retired zones/zones.json is gone', () => {
    expect(existsSync(join(DATA, 'zones/zones.json'))).toBe(false)
  })

  it.skipIf(cached.size === 0)('cached raw files are unmodified: they match the lock', () => {
    for (const [id, bytes] of cached) {
      const entry = lock?.sources.find((source) => source.id === id)
      expect({ id, sha256: sha256(bytes), bytes: bytes.byteLength }).toEqual({
        id,
        sha256: entry?.sha256,
        bytes: entry?.bytes,
      })
    }
  })

  it.skipIf(!cacheValid)(
    'rebuild from the real download cache is byte-identical to the committed files',
    async () => {
      if (lock === undefined) throw new Error('no lock')
      const result = await buildFromSources(lock, cached)
      for (const [path, text] of result.files) {
        expect(sha256(text), path).toBe(sha256(readFileSync(join(DATA, path))))
      }
    },
    120_000,
  )
})
