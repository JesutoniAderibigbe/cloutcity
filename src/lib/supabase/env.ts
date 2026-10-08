/**
 * The browser's Supabase configuration (S05): the project URL and its public anon key, from
 * NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (inlined at build time). Both are
 * optional: without them the game plays local-only (CLAUDE.md "Player state is local-first"),
 * which is also how the e2e suite runs.
 *
 * No zod: this runs in the welcome island right after the attestation and must stay tiny.
 */

export interface SupabaseEnv {
  readonly url: string
  readonly anonKey: string
}

export interface SupabaseEnvSource {
  readonly url: string | undefined
  readonly anonKey: string | undefined
}

// Each variable is named in full so Next.js inlines it (a computed lookup is never replaced).
const buildEnv = (): SupabaseEnvSource => ({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
})

function httpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * The configuration, or null when it is missing or unusable: a blank or absent value, or a URL
 * that is not http(s). Never throws; the caller plays local-only on null.
 */
export function supabaseEnv(source: SupabaseEnvSource = buildEnv()): SupabaseEnv | null {
  const url = source.url?.trim() ?? ''
  const anonKey = source.anonKey?.trim() ?? ''
  if (url === '' || anonKey === '' || !httpUrl(url)) return null
  return { url, anonKey }
}

/** The path every account link (magic link, email confirmation, Google) comes back to (S19). */
export const AUTH_CALLBACK_PATH = '/auth/callback'

/**
 * The http(s) origin of `value`, or null when it is blank or not one. Any path, query or
 * fragment is ignored.
 */
export function siteOrigin(value: string | undefined): string | null {
  const raw = value?.trim() ?? ''
  if (raw === '') return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.origin
  } catch {
    return null
  }
}

/**
 * Where account links land: `<NEXT_PUBLIC_SITE_URL>/auth/callback` (S19), or null when the build
 * has no usable site URL. Then account actions fail closed ("Accounts aren't set up on this
 * build"): the request's host or `location.origin` is never used, so a link can never be sent
 * pointing at whatever host served the page.
 */
export function authCallbackUrl(
  value: string | undefined = process.env.NEXT_PUBLIC_SITE_URL,
): string | null {
  const origin = siteOrigin(value)
  return origin === null ? null : `${origin}${AUTH_CALLBACK_PATH}`
}

/**
 * Whether the browser's site URL (NEXT_PUBLIC_SITE_URL) and the server's (SITE_URL, where /mod
 * links land) name the same origin. Either one missing is not a mismatch; next.config.ts refuses
 * to build when both are set and differ.
 */
export function siteUrlsAgree(publicUrl: string | undefined, serverUrl: string | undefined) {
  const a = siteOrigin(publicUrl)
  const b = siteOrigin(serverUrl)
  return a === null || b === null || a === b
}
