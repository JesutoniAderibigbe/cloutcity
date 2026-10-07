import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/** Integration suites against the local Supabase stack (`npx supabase start`). */
export default defineConfig({
  resolve: {
    alias: {
      '@/': fileURLToPath(new URL('./src/', import.meta.url)),
      '@data/': fileURLToPath(new URL('./data/', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['tests/integration/setup/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
