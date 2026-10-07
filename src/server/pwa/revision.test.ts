import { describe, expect, it } from 'vitest'
import audioManifestJson from '@data/audio/manifest.json'
import modelManifestJson from '@data/assets/manifest.json'
import { districtAssetUrls } from '@/lib/data/districts'
import { geoVersion } from '@/lib/data/geo'
import { QUALITY_TIERS } from '@/lib/data/schemas/config'
import { isVersionedGeo, warmTierUrls } from '@/sw/policy'
import {
  PRECACHED_PAGES,
  additionalPrecacheEntries,
  audioVersionOf,
  buildRevision,
  precacheGlobs,
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
  it('names the versioned caches after the current geo, audio and models', () => {
    const config = serviceWorkerConfig()
    expect(config.geoCache).toBe(`cc-geo-${geoVersion}`)
    expect(config.audioCache).toBe(`cc-audio-${audioVersionOf(audioManifestJson)}`)
    expect(config.modelsCache).toBe(`cc-models-${modelManifestJson.assetVersion}`)
    expect(config.revision).toMatch(/^[0-9a-f]{16}$/)
  })

  it("bakes in each tier's district URLs exactly as the scene loads them", () => {
    const config = serviceWorkerConfig()
    const origin = 'https://cloutcity.example'
    for (const tier of QUALITY_TIERS) {
      const urls = districtAssetUrls(tier)
      expect(urls.length, tier).toBeGreaterThan(1)
      expect(config.districtUrls[tier]).toEqual(urls)
      // Every URL is versioned geo the worker's geo route caches, and none is dropped.
      expect(warmTierUrls(config, tier, origin)).toEqual(urls)
      for (const url of urls) {
        const facts = { url: new URL(url, origin), method: 'GET', mode: 'cors' as const }
        expect(isVersionedGeo({ ...facts, sameOrigin: true }), url).toBe(true)
        expect(url, url).toMatch(new RegExp(`^/geo/(?:districts|blocks)/${tier}\\b`))
      }
    }
  })
})

describe('precacheGlobs', () => {
  it('takes code, styles and fonts from the build and only the icons from public/', () => {
    expect(precacheGlobs('.next-x')).toEqual([
      '.next-x/static/**/*.{js,css,svg,woff2}',
      'public/icons/**/*',
    ])
    // Models and audio load on demand: nothing under public/models or public/audio, no .glb.
    for (const glob of precacheGlobs()) {
      expect(glob).not.toMatch(/models|audio|glb|public\/\*\*/)
    }
  })
})
