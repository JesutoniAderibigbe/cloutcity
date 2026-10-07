import { describe, expect, it } from 'vitest'
import modelManifestJson from '@data/assets/manifest.json'
import { SAME_ORIGIN_AUDIO, audioManifest } from '@/lib/audio/manifest'
import { ModelManifestSchema } from '@/lib/data/schemas/assets'
import {
  AUDIO_PATH,
  MODEL_PATH,
  NAVIGATION_DENYLIST,
  WARM_TIER_MESSAGE,
  isOwnAudio,
  isPageNavigation,
  isSensitive,
  isVersionedGeo,
  isVersionedModel,
  parseWarmTierMessage,
  refuseSensitive,
  runtimeCacheName,
  staleCacheNames,
  warmTierUrls,
  type CacheCandidate,
  type RequestFacts,
  type ServiceWorkerConfig,
} from './policy'

const ORIGIN = 'https://cloutcity.example'

function facts(path: string, overrides: Partial<Omit<RequestFacts, 'url'>> = {}): RequestFacts {
  return {
    url: new URL(path, ORIGIN),
    method: 'GET',
    mode: 'cors',
    sameOrigin: true,
    ...overrides,
  }
}

describe('runtime cache names', () => {
  it('carry the kind and the content version', () => {
    expect(runtimeCacheName('geo', '57ef63e13a99')).toBe('cc-geo-57ef63e13a99')
    expect(runtimeCacheName('audio', 'abc123')).toBe('cc-audio-abc123')
    expect(runtimeCacheName('models', '2f59d8d46a436cef')).toBe('cc-models-2f59d8d46a436cef')
  })

  it('refuse a version that could name another cache', () => {
    for (const version of ['', 'ABC', 'a-b', 'a/b', 'x'.repeat(65)]) {
      expect(() => runtimeCacheName('geo', version), version).toThrow(/Invalid geo cache version/)
    }
  })
})

describe('staleCacheNames', () => {
  it('lists every app-owned cache that is not current, and nothing else', () => {
    const existing = [
      'cc-geo-new',
      'cc-geo-old',
      'cc-audio-new',
      'cc-audio-old',
      'cc-something-unknown',
      'serwist-precache-v2-https://cloutcity.example/',
      'another-app',
    ]
    expect(staleCacheNames(existing, ['cc-geo-new', 'cc-audio-new'])).toEqual([
      'cc-geo-old',
      'cc-audio-old',
      'cc-something-unknown',
    ])
  })

  it('keeps everything when nothing is stale', () => {
    expect(staleCacheNames(['cc-geo-a', 'serwist-precache-v2-x'], ['cc-geo-a'])).toEqual([])
    expect(staleCacheNames([], ['cc-geo-a'])).toEqual([])
  })
})

describe('isVersionedGeo', () => {
  it('matches same-origin GET geo with a ?v= version', () => {
    expect(isVersionedGeo(facts('/geo/base?v=57ef63e13a99'))).toBe(true)
    expect(isVersionedGeo(facts('/geo/districts/qn01?v=abc'))).toBe(true)
  })

  it('refuses unversioned, other paths, other origins and other methods', () => {
    expect(isVersionedGeo(facts('/geo/base'))).toBe(false)
    expect(isVersionedGeo(facts('/geo/base?v='))).toBe(false)
    expect(isVersionedGeo(facts('/geography?v=1'))).toBe(false)
    expect(isVersionedGeo(facts('/api/geo?v=1'))).toBe(false)
    expect(isVersionedGeo(facts('/geo/base?v=1', { sameOrigin: false }))).toBe(false)
    expect(isVersionedGeo(facts('/geo/base?v=1', { method: 'POST' }))).toBe(false)
  })
})

describe('isOwnAudio', () => {
  it('agrees with the audio manifest rule and matches every manifest file', () => {
    expect(AUDIO_PATH.source).toBe(SAME_ORIGIN_AUDIO.source)
    const files = audioManifest.tracks.flatMap((track) => track.sources.map((s) => s.file))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) expect(isOwnAudio(facts(file)), file).toBe(true)
  })

  it('refuses other origins, queries, other types and other methods', () => {
    expect(isOwnAudio(facts('/audio/music/a.webm', { sameOrigin: false }))).toBe(false)
    expect(isOwnAudio(facts('/audio/music/a.webm?x=1'))).toBe(false)
    expect(isOwnAudio(facts('/audio/music/a.mp3'))).toBe(false)
    expect(isOwnAudio(facts('/audio/../api/a.webm'))).toBe(false)
    expect(isOwnAudio(facts('/audio/music/a.webm', { method: 'POST' }))).toBe(false)
  })
})

describe('isVersionedModel', () => {
  const modelFiles = ModelManifestSchema.parse(modelManifestJson).models.flatMap((model) =>
    Object.values(model.tiers).map((tier) => tier.file),
  )

  it('agrees with the model manifest rule and matches every manifest file', () => {
    expect(modelFiles.length).toBeGreaterThan(0)
    for (const file of modelFiles) {
      expect(MODEL_PATH.test(file), file).toBe(true)
      expect(isVersionedModel(facts(file)), file).toBe(true)
    }
  })

  it('refuses unversioned names, queries, other origins, other methods and other paths', () => {
    const file = modelFiles[0] ?? ''
    for (const path of [
      '/models/taxi.glb',
      '/models/taxi.low.glb',
      '/models/taxi.ultra.752dce5e.glb',
      '/models/taxi.low.752DCE5E.glb',
      '/models/taxi.low.752dce5.glb',
      '/models/taxi.low.752dce5e.gltf',
      '/models/sub/taxi.low.752dce5e.glb',
      '/models/../api/x.low.752dce5e.glb',
      '/api/models/taxi.low.752dce5e.glb',
      '/mod/models/taxi.low.752dce5e.glb',
      '/models/',
    ]) {
      expect(isVersionedModel(facts(path)), path).toBe(false)
    }
    expect(isVersionedModel(facts(`${file}?v=1`))).toBe(false)
    expect(isVersionedModel(facts(file, { sameOrigin: false }))).toBe(false)
    expect(isVersionedModel(facts(file, { method: 'POST' }))).toBe(false)
    expect(isVersionedModel(facts(file, { method: 'PUT' }))).toBe(false)
  })

  it('never overlaps the geo, audio or navigation rules', () => {
    for (const file of modelFiles) {
      expect(isVersionedGeo(facts(file)), file).toBe(false)
      expect(isOwnAudio(facts(file)), file).toBe(false)
    }
  })
})

describe('warmTierUrls', () => {
  const config: ServiceWorkerConfig = {
    revision: 'r',
    geoCache: 'cc-geo-a',
    audioCache: 'cc-audio-a',
    modelsCache: 'cc-models-a',
    districtUrls: {
      low: [
        '/geo/districts/low/queens?v=abc',
        '/geo/blocks/low?v=def',
        // Never baked in by the build; filtered all the same.
        '/geo/districts/low/x',
        '/api/save',
        'https://evil.example/geo/districts/low/queens?v=abc',
      ],
      mid: ['/geo/blocks/mid?v=1'],
      high: [],
    },
  }

  it("keeps only the tier's same-origin versioned geo", () => {
    expect(warmTierUrls(config, 'low', ORIGIN)).toEqual([
      '/geo/districts/low/queens?v=abc',
      '/geo/blocks/low?v=def',
    ])
    expect(warmTierUrls(config, 'mid', ORIGIN)).toEqual(['/geo/blocks/mid?v=1'])
    expect(warmTierUrls(config, 'high', ORIGIN)).toEqual([])
  })
})

describe('isPageNavigation', () => {
  const nav = (path: string, overrides: Partial<Omit<RequestFacts, 'url'>> = {}) =>
    isPageNavigation(facts(path, { mode: 'navigate', ...overrides }))

  it('handles same-origin page navigations', () => {
    for (const path of ['/', '/terms', '/privacy', '/credits', '/live', '/missing', '/apiary']) {
      expect(nav(path), path).toBe(true)
    }
  })

  it('never handles server, moderator, worker, data or share-image routes', () => {
    for (const path of [
      '/api',
      '/api/save',
      '/mod',
      '/mod/queue',
      '/serwist/sw.js',
      '/geo/base',
      '/og/card',
    ]) {
      expect(nav(path), path).toBe(false)
      expect(
        NAVIGATION_DENYLIST.some((pattern) => pattern.test(path)),
        path,
      ).toBe(true)
    }
  })

  it('ignores non-navigations, other origins and other methods', () => {
    expect(isPageNavigation(facts('/'))).toBe(false)
    expect(nav('/', { sameOrigin: false })).toBe(false)
    expect(nav('/', { method: 'POST' })).toBe(false)
  })
})

describe('refuseSensitive', () => {
  function candidate(
    response: Partial<{ status: number; type: ResponseType; headers: Record<string, string> }> = {},
    requestHeaders: Record<string, string> = {},
  ): CacheCandidate {
    return {
      request: { headers: new Headers(requestHeaders) },
      response: {
        status: response.status ?? 200,
        type: response.type ?? 'basic',
        headers: new Headers(response.headers ?? {}),
      },
    }
  }

  it('keeps a plain same-origin 200, including Next.js router Vary headers', () => {
    const ok = candidate({
      headers: {
        'cache-control': 'public, max-age=31536000, immutable',
        vary: 'rsc, next-router-state-tree, next-router-prefetch, Accept-Encoding',
      },
    })
    expect(isSensitive(ok)).toBe(false)
    expect(refuseSensitive(ok)).toBe(ok.response)
  })

  it('refuses credentialed requests', () => {
    expect(refuseSensitive(candidate({}, { Authorization: 'Bearer x' }))).toBeNull()
  })

  it('refuses anything but a basic 200', () => {
    for (const status of [201, 204, 206, 301, 304, 404, 500]) {
      expect(refuseSensitive(candidate({ status })), String(status)).toBeNull()
    }
    for (const type of ['opaque', 'cors', 'opaqueredirect', 'error'] as const) {
      expect(refuseSensitive(candidate({ type })), type).toBeNull()
    }
  })

  it('refuses no-store and private, in any case and position', () => {
    for (const value of [
      'no-store',
      'private',
      'Private, max-age=60',
      'max-age=0, NO-STORE',
      'private="set-cookie"',
    ]) {
      expect(refuseSensitive(candidate({ headers: { 'cache-control': value } })), value).toBeNull()
    }
    expect(refuseSensitive(candidate({ headers: { 'cache-control': 'no-cache' } }))).not.toBeNull()
  })

  it('refuses responses personalised by cookie or credentials', () => {
    for (const value of ['Cookie', 'accept-encoding, cookie', 'Authorization', '*']) {
      expect(refuseSensitive(candidate({ headers: { vary: value } })), value).toBeNull()
    }
  })
})

describe('parseWarmTierMessage', () => {
  it('accepts a warm request for each tier', () => {
    for (const tier of ['low', 'mid', 'high'] as const) {
      expect(parseWarmTierMessage({ type: WARM_TIER_MESSAGE, tier })).toEqual({
        type: WARM_TIER_MESSAGE,
        tier,
      })
    }
  })

  it('refuses anything else', () => {
    for (const data of [
      null,
      undefined,
      'CC_WARM_TIER',
      {},
      { type: WARM_TIER_MESSAGE },
      { type: WARM_TIER_MESSAGE, tier: 'ultra' },
      { type: WARM_TIER_MESSAGE, tier: ['low'] },
      { type: 'SKIP_WAITING', tier: 'low' },
      { type: 'CACHE_URLS', payload: { urlsToCache: ['/api/save'] } },
    ]) {
      expect(parseWarmTierMessage(data), JSON.stringify(data)).toBeNull()
    }
  })
})
