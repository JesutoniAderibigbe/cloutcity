/**
 * GET /serwist/sw.js (and its source map): the service worker (S04e, DEC-23), bundled from
 * src/sw/sw.ts by @serwist/turbopack at build time and prerendered (force-static). next.config.ts
 * serves it with no-cache and a strict CSP, so a deploy is picked up on the next update check.
 *
 * The precache is the build's static JS, CSS, SVG and fonts, the icons, and
 * {@link additionalPrecacheEntries} (pages, manifest, versioned geo). Audio is never precached:
 * it loads only after the player's audio choice, and the worker caches it then.
 */
import { createSerwistRoute } from '@serwist/turbopack'
import { additionalPrecacheEntries, distDir, serviceWorkerConfig } from '@/server/pwa/revision'

const config = serviceWorkerConfig()

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute(
  {
    swSrc: 'src/sw/sw.ts',
    useNativeEsbuild: true,
    globPatterns: [`${distDir()}/static/**/*.{js,css,svg,woff2}`, 'public/icons/**/*'],
    additionalPrecacheEntries: additionalPrecacheEntries(config.revision),
    esbuildOptions: {
      // A classic script: registered without `type: 'module'`, so every browser that supports
      // service workers runs it (the bundle has no imports left).
      format: 'iife',
      define: { __CC_SW_CONFIG__: JSON.stringify(config) },
    },
  },
)
