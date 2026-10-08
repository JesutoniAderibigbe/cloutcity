/**
 * What /auth/callback was opened with (S19), parsed from untrusted URL parameters with zod/mini:
 *  - `token_hash` + `type` from our own email templates (supabase/templates): finished only on
 *    the player's tap, since mail scanners open links on their own;
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
  | { readonly kind: 'finish'; readonly params: CallbackParams }
  | { readonly kind: 'error'; readonly error: CallbackError }

// Generous bounds: GoTrue's hashes and codes are far shorter; anything longer is not one.
const opaque = z.string().check(z.minLength(8), z.maxLength(512), z.regex(/^[A-Za-z0-9._~-]+$/))

const TokenSchema = z.object({ token_hash: opaque, type: z.enum(CALLBACK_TOKEN_TYPES) })
const CodeSchema = z.object({ code: opaque })

/** Reads the callback's query (and fragment, where GoTrue may put an error). */
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
  const values = Object.fromEntries(query.entries())
  const token = TokenSchema.safeParse(values)
  if (token.success) {
    return {
      kind: 'finish',
      params: { kind: 'token', tokenHash: token.data.token_hash, type: token.data.type },
    }
  }
  const code = CodeSchema.safeParse(values)
  if (code.success) return { kind: 'finish', params: { kind: 'code', code: code.data.code } }
  return { kind: 'error', error: 'invalid' }
}

/** Which Google round trip this tab started (set before leaving for Google, S19). */
export const GOOGLE_INTENT_KEY = 'cloutcity:google-intent'
