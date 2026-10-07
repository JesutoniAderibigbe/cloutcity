import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The e2e suite builds into its own directory (playwright.config.ts), so a test build with
  // the scene test hooks never sits where `npm run start` and `npm run budget` read.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  env: {
    // Always defined, so it is inlined into every build and the hook code is removed as dead
    // code unless the build opts in (an unset NEXT_PUBLIC_ variable stays a runtime lookup).
    NEXT_PUBLIC_TEST_HOOKS: process.env.NEXT_PUBLIC_TEST_HOOKS === '1' ? '1' : '0',
  },
}

export default nextConfig
