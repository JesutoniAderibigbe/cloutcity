/**
 * What /auth/callback was opened with (S19), parsed from untrusted URL parameters with zod/mini:
 *  - `token_hash` + `type` (+ the address it is for, `email`) from our own email templates
 *    (supabase/templates), in the URL *fragment* only, so a one-time token never reaches a server,
 *    CDN or router log (review F5). Finished only on the player's tap, since mail scanners open
 *    links on their own;
 *  - `code` from a Google round trip (PKCE: only the browser that started it can exchange it);
 *  - `error_code` / `error` when GoTrue refused (a Google account already linked elsewhere).
 * Anything else is an incomplete link. Values are never logged.
 */
import * as z from 'zod/mini'

/** The link types /auth/callback finishes with a token hash. */
export const CALLBACK_TOKEN_TYPES = ['email', 'magiclink', 'email_change'] as const
export type CallbackTokenType = (typeof CALLBACK_TOKEN_TYPES)[number]

/** What the page finishes: a link's token hash, or Google's PKCE code. */
export type CallbackParams =
  | { readonly kind: 'token'; readonly tokenHash: string; readonly type: CallbackTokenType }
  | { readonly kind: 'code'; readonly code: string }

export type CallbackError = 'identity-exists' | 'expired' | 'google' | 'invalid'

export type ParsedCallback =
  | {
      readonly kind: 'finish'
      readonly params: CallbackParams
      /** The address the link says it is for (shown masked before the tap); null if absent. */
      readonly email: string | null
    }
  | { readonly kind: 'error'; readonly error: CallbackError }

// Generous bounds: GoTrue's hashes and codes are far shorter; anything longer is not one.
const opaque = z.string().check(z.minLength(8), z.maxLength(512), z.regex(/^[A-Za-z0-9._~-]+$/))

const TokenSchema = z.object({ token_hash: opaque, type: z.enum(CALLBACK_TOKEN_TYPES) })
const EmailSchema = z.string().check(z.maxLength(320), z.regex(/^[^\s@]+@[^\s@]+$/))
const CodeSchema = z.object({ code: opaque })

/**
 * Reads the callback's fragment (our links' token) and query (Google's PKCE code and GoTrue's
 * errors). A token hash in the query is not ours and is refused.
 */
export function parseCallback(search: string, hash = ''): ParsedCallback {
  const query = new URLSearchParams(search)
  const fragment = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const errorCode = query.get('error_code') ?? fragment.get('error_code')
  const error = query.get('error') ?? fragment.get('error')
  if (errorCode !== null || error !== null) {
    if (errorCode === 'identity_already_exists') return { kind: 'error', error: 'identity-exists' }
    if (errorCode === 'otp_expired') return { kind: 'error', error: 'expired' }
    return { kind: 'error', error: 'google' }
  }
  if (query.has('token_hash')) return { kind: 'error', error: 'invalid' }
  const token = TokenSchema.safeParse(Object.fromEntries(fragment.entries()))
  if (token.success) {
    const email = EmailSchema.safeParse(fragment.get('email') ?? '')
    return {
      kind: 'finish',
      params: { kind: 'token', tokenHash: token.data.token_hash, type: token.data.type },
      email: email.success ? email.data : null,
    }
  }
  const code = CodeSchema.safeParse(Object.fromEntries(query.entries()))
  if (code.success) {
    return { kind: 'finish', params: { kind: 'code', code: code.data.code }, email: null }
  }
  return { kind: 'error', error: 'invalid' }
}

/** Which Google round trip this tab started (set before leaving for Google, S19). */
export const GOOGLE_INTENT_KEY = 'cloutcity:google-intent'

/**
 * This browser asked for a log-in link (review F2, N1): kept in localStorage with the time it was
 * asked and a hash of the address it was for (src/lib/account/emailHash.ts), never the address.
 * Set only once the link was actually sent. A log-in link is adopted without asking only when the
 * account it verifies as has that address; any other link asks "Log in as …?" first.
 */
export const LOGIN_REQUESTED_KEY = 'cloutcity:login-requested'

export function markLoginRequested(nowMs: number, addressHash: string): void {
  try {
    localStorage.setItem(LOGIN_REQUESTED_KEY, JSON.stringify({ at: nowMs, hash: addressHash }))
  } catch {
    // Without it, the log-in link only asks one more question.
  }
}

const HEX64 = /^[0-9a-f]{64}$/

/**
 * The hash of the address this browser asked a log-in link for within `maxAgeMs`, or null. The
 * mark is spent by reading it.
 */
export function takeLoginRequested(nowMs: number, maxAgeMs: number): string | null {
  try {
    const raw = localStorage.getItem(LOGIN_REQUESTED_KEY)
    localStorage.removeItem(LOGIN_REQUESTED_KEY)
    if (raw === null) return null
    const { at, hash } = JSON.parse(raw) as { at?: unknown; hash?: unknown }
    if (typeof at !== 'number' || !Number.isSafeInteger(at) || typeof hash !== 'string') return null
    if (at > nowMs || nowMs - at > maxAgeMs || !HEX64.test(hash)) return null
    return hash
  } catch {
    return null
  }
}
