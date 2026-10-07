import { describe, expect, it } from 'vitest'
import audioManifestJson from '@data/audio/manifest.json'
import { geoVersion } from '@/lib/data/geo'
import {
  PRECACHED_PAGES,
  additionalPrecacheEntries,
  audioVersionOf,
  buildRevision,
  serviceWorkerConfig,
} from './revision'

const INPUTS = {
  commit: 'a'.repeat(40),
  staticFiles: ['chunks/b.js', 'chunks/a.js'],
  geoVersion: '57ef63e13a99',
  audioVersion: '93d2162be08b',
}

describe('buildRevision', () => {
  it('is deterministic and ignores file order', () => {
    expect(buildRevision(INPUTS)).toMatch(/^[0-9a-f]{16}$/)
    expect(buildRevision(INPUTS)).toBe(
      buildRevision({ ...INPUTS, staticFiles: [...INPUTS.staticFiles].reverse() }),
    )
  })

  it('changes with the commit, the chunks, the geo and the audio', () => {
    const base = buildRevision(INPUTS)
    expect(buildRevision({ ...INPUTS, commit: 'b'.repeat(40) })).not.toBe(base)
    expect(buildRevision({ ...INPUTS, commit: null })).not.toBe(base)
    expect(buildRevision({ ...INPUTS, staticFiles: ['chunks/c.js'] })).not.toBe(base)
    expect(buildRevision({ ...INPUTS, geoVersion: '000000000000' })).not.toBe(base)
    expect(buildRevision({ ...INPUTS, audioVersion: '000000000000' })).not.toBe(base)
  })
})

describe('audioVersionOf', () => {
  it('hashes the source hashes, whatever their order', () => {
    const manifest = { tracks: [{ sources: [{ sha256: 'a' }, { sha256: 'b' }] }] }
    const swapped = { tracks: [{ sources: [{ sha256: 'b' }] }, { sources: [{ sha256: 'a' }] }] }
    expect(audioVersionOf(manifest)).toMatch(/^[0-9a-f]{12}$/)
    expect(audioVersionOf(swapped)).toBe(audioVersionOf(manifest))
    expect(audioVersionOf({ tracks: [{ sources: [{ sha256: 'c' }] }] })).not.toBe(
      audioVersionOf(manifest),
    )
  })
})

describe('additionalPrecacheEntries', () => {
  it('lists the pages at the revision and the geo at its version, never audio or the API', () => {
    const entries = additionalPrecacheEntries('rev1', 'v1')
    expect(entries).toEqual([
      ...PRECACHED_PAGES.map((url) => ({ url, revision: 'rev1' })),
      { url: '/geo/base?v=v1', revision: null },
      { url: '/geo/fallback?v=v1', revision: 'rev1' },
    ])
    expect(PRECACHED_PAGES).toEqual(expect.arrayContaining(['/', '/offline']))
    for (const { url } of entries) expect(url).not.toMatch(/^\/(?:audio|api|mod|serwist)\b/)
  })
})

describe('serviceWorkerConfig', () => {
  it('names the versioned caches after the current geo and audio', () => {
    const config = serviceWorkerConfig()
    expect(config.geoCache).toBe(`cc-geo-${geoVersion}`)
    expect(config.audioCache).toBe(`cc-audio-${audioVersionOf(audioManifestJson)}`)
    expect(config.revision).toMatch(/^[0-9a-f]{16}$/)
    expect(config.districtUrls).toEqual({ low: [], mid: [], high: [] })
  })
})
