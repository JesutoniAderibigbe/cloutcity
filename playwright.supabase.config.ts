/**
 * Opt-in e2e against the local Supabase stack (S05): `npm run e2e:supabase` runs only the
 * `*.supabase.spec.ts` specs, on their own port and build directory, with the stack's URL and
 * anon key from `supabase status`. The stack is shared by every checkout: these specs only sign
 * in anonymously and never reset it. Fails fast, with the fix, when the stack is not running.
 */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { defineConfig } from '@playwright/test'
import base, { SUPABASE_SPECS } from './playwright.config'

const PORT = Number(process.env.E2E_SUPABASE_PORT ?? 3110)
const BASE_URL = `http://localhost:${PORT}`
export const E2E_SUPABASE_DIST_DIR = '.next-e2e-supabase'

/** API_URL and ANON_KEY of the running local stack. */
function localStack(): { url: string; anonKey: string } {
  let output: string
  try {
    output = execFileSync(
      join(import.meta.dirname, 'node_modules/.bin/supabase'),
      ['status', '-o', 'env'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    )
  } catch {
    throw new Error('Local Supabase is not running. Start it with `npx supabase start`.')
  }
  const value = (name: string) => output.match(new RegExp(`^${name}="?([^"\\n]*)"?$`, 'm'))?.[1]
  const url = value('API_URL')
  const anonKey = value('ANON_KEY')
  if (typeof url !== 'string' || url === '' || typeof anonKey !== 'string' || anonKey === '') {
    throw new Error(
      '`supabase status` reported no API_URL or ANON_KEY; is the stack fully started?',
    )
  }
  return { url, anonKey }
}

const stack = localStack()

export default defineConfig({
  ...base,
  testIgnore: undefined,
  testMatch: SUPABASE_SPECS,
  // `base.use` carries `serviceWorkers: 'block'`; stated here too so the opt-out is visible.
  use: { ...base.use, baseURL: BASE_URL, serviceWorkers: 'block' },
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      NEXT_PUBLIC_TEST_HOOKS: '1',
      NEXT_DIST_DIR: E2E_SUPABASE_DIST_DIR,
      NEXT_PUBLIC_SUPABASE_URL: stack.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: stack.anonKey,
    },
  },
})
