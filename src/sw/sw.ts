/**
 * The service worker (S04e, DEC-23). Bundled by @serwist/turbopack into /serwist/sw.js
 * (src/app/serwist/[path]/route.ts) and type-checked against the webworker lib by
 * src/sw/tsconfig.json. Every rule it applies lives in ./policy.ts.
 *
 * - Precache: the build's static assets, the pages and the versioned geo, served cache-first;
 *   entries a new build dropped are deleted when it activates.
 * - Runtime: versioned geo and our own audio, cache-first, each in a versioned `cc-` cache;
 *   page navigations network-only with `/offline` when the network fails. Nothing else is
 *   handled, so `/api`, `/mod`, other origins and non-GET requests never touch a cache.
 * - Updates wait (no skipWaiting): the page shows an update banner and sends SKIP_WAITING when
 *   the player taps it, so a running game never swaps code under the player.
 *
 * No navigation preload, background sync, default runtime cache or CACHE_URLS handler: the
 * worker caches only what the routes below allow.
 */
import { CacheFirst, NetworkOnly, Serwist, type PrecacheEntry, type SerwistPlugin } from 'serwist'
import {
  isOwnAudio,
  isPageNavigation,
  isVersionedGeo,
  parseWarmTierMessage,
  refuseSensitive,
  staleCacheNames,
  type RequestFacts,
  type ServiceWorkerConfig,
} from './policy'

declare const self: ServiceWorkerGlobalScope & {
  readonly __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
}
/** Baked in at build time by the route handler (src/server/pwa/revision.ts). */
declare const __CC_SW_CONFIG__: ServiceWorkerConfig

const config = __CC_SW_CONFIG__

const neverCacheSensitive: SerwistPlugin = {
  cacheWillUpdate: ({ request, response }) => refuseSensitive({ request, response }),
}

function facts({
  request,
  url,
  sameOrigin,
}: {
  request: Request
  url: URL
  sameOrigin: boolean
}): RequestFacts {
  return { url, method: request.method, mode: request.mode, sameOrigin }
}

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: { cleanupOutdatedCaches: true },
  skipWaiting: false,
  clientsClaim: false,
  navigationPreload: false,
  runtimeCaching: [
    {
      matcher: (options) => isVersionedGeo(facts(options)),
      handler: new CacheFirst({ cacheName: config.geoCache, plugins: [neverCacheSensitive] }),
    },
    {
      matcher: (options) => isOwnAudio(facts(options)),
      handler: new CacheFirst({ cacheName: config.audioCache, plugins: [neverCacheSensitive] }),
    },
    {
      matcher: (options) => isPageNavigation(facts(options)),
      handler: new NetworkOnly(),
    },
  ],
  fallbacks: {
    entries: [{ url: '/offline', matcher: ({ request }) => request.mode === 'navigate' }],
  },
})

self.addEventListener('install', serwist.handleInstall)
self.addEventListener('activate', serwist.handleActivate)
self.addEventListener('fetch', serwist.handleFetch)

// Versioned runtime caches from older builds are deleted once this worker takes over.
self.addEventListener('activate', (event) => {
  const current = [config.geoCache, config.audioCache]
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(staleCacheNames(names, current).map((name) => caches.delete(name))),
      ),
  )
})

// A page asks for its quality tier's district assets once the map is playable (S04e part 2).
self.addEventListener('message', (event) => {
  const message = parseWarmTierMessage(event.data)
  if (message === null) return
  const urls = config.districtUrls[message.tier]
  if (urls.length === 0) return
  // Through the routes above, so the same matchers and never-cache rules apply.
  event.waitUntil(
    Promise.all(urls.map((url) => serwist.handleRequest({ request: new Request(url), event }))),
  )
})
