/**
 * Hand-made models (public/models/**, S04h) are never precached on install: they load on
 * demand and the worker caches them at runtime. `npm run budget` checks the built worker's
 * precache list; this guards the inputs that feed it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { additionalPrecacheEntries } from './revision'

const ROUTE = join(import.meta.dirname, '../../app/serwist/[path]/route.ts')

describe('service-worker precache and model files', () => {
  it('lists no model file among the extra precache entries', () => {
    const urls = additionalPrecacheEntries('rev').map((entry) => entry.url)
    expect(urls.filter((url) => url.startsWith('/models/'))).toEqual([])
  })

  it('globs nothing under public/ but the icons, and no .glb anywhere', () => {
    const source = readFileSync(ROUTE, 'utf8')
    const block = /globPatterns:\s*\[([^\]]*)\]/.exec(source)?.[1]
    if (block === undefined) throw new Error('route.ts has no globPatterns array')
    const patterns = [...block.matchAll(/[`'"]([^`'"]+)[`'"]/g)].map((match) => match[1] ?? '')
    expect(patterns.length).toBeGreaterThan(0)
    for (const pattern of patterns) {
      expect(pattern).not.toMatch(/glb|models/)
      if (pattern.startsWith('public/')) expect(pattern).toMatch(/^public\/icons\//)
    }
  })
})
