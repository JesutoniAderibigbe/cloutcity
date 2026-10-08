import { withSerwist } from '@serwist/turbopack'
import type { NextConfig } from 'next'

/**
 * The service worker script (S04e): never cached, so a deploy is found on the next update
 * check, and locked to same-origin scripts (Next.js PWA guide, "Securing your application").
 */
const SERVICE_WORKER_HEADERS = [
  { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
  { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
]

/**
 * Account pages (S19, /auth/callback): links land here with a one-time token in the URL
 * fragment, so the page is never stored and never sends a Referer (its own chunk requests
 * included); the service worker never touches /auth either (src/sw/policy.ts).
 */
const AUTH_HEADERS = [
  { key: 'Cache-Control', value: 'no-store, max-age=0' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Robots-Tag', value: 'noindex' },
]

/** The origin of an http(s) URL, or null (src/lib/supabase/env.ts `siteOrigin`). */
function originOf(value: string | undefined): string | null {
  try {
    const url = new URL(value?.trim() ?? '')
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}

// Account links (NEXT_PUBLIC_SITE_URL) and /mod sign-in links (SITE_URL) must point at the same
// site: a build where they differ would send players and moderators to different hosts.
const publicSite = originOf(process.env.NEXT_PUBLIC_SITE_URL)
const serverSite = originOf(process.env.SITE_URL)
if (publicSite !== null && serverSite !== null && publicSite !== serverSite) {
  throw new Error(
    'NEXT_PUBLIC_SITE_URL and SITE_URL name different origins; set them to the same site',
  )
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // No source maps for client code in production (the default, stated so it stays that way): the
  // bundles players download carry no map URL and no map is served. The service worker's bundle
  // has none either (src/app/serwist/[path]/route.ts). Server maps stay: they never leave the
  // server and keep stack traces readable in its logs.
  productionBrowserSourceMaps: false,
  // The e2e suite builds into its own directory (playwright.config.ts), so a test build with
  // the scene test hooks never sits where `npm run start` and `npm run budget` read.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  env: {
    // Always defined, so it is inlined into every build and the hook code is removed as dead
    // code unless the build opts in (an unset NEXT_PUBLIC_ variable stays a runtime lookup).
    NEXT_PUBLIC_TEST_HOOKS: process.env.NEXT_PUBLIC_TEST_HOOKS === '1' ? '1' : '0',
  },
  async headers() {
    return [
      { source: '/serwist/sw.js', headers: SERVICE_WORKER_HEADERS },
      { source: '/auth/:path*', headers: AUTH_HEADERS },
      {
        // Geo is addressed by its content version (/geo/base?v=<geoVersion>), so a versioned
        // URL never changes. The fallback map is left out: its ?v= is the geo version, but it
        // also renders the palette and copy, which can change without it.
        source: '/geo/:path((?!fallback$).+)',
        has: [{ type: 'query', key: 'v' }],
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ]
  },
}

// withSerwist keeps esbuild (which bundles the worker in the route handler) out of the server
// bundle.
export default withSerwist(nextConfig)
