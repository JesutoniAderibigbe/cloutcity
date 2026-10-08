/**
 * The guest's anonymous Supabase session (S05). Loaded only through `import()` from
 * src/state/session.ts, after the 18+ attestation, with a valid configuration and once the map
 * is playable, so @supabase/supabase-js never reaches the shell or the boot islands
 * (src/lib/client-imports.test.ts, src/lib/shell-boundary.test.ts).
 *
 * A session this device already holds (supabase-js keeps it under its default
 * `sb-<project ref>-auth-token` key, Q7) is reused, a guest's or a saved account's (S19);
 * otherwise it signs in anonymously, unless the player signed out of an account on this device
 * (then nothing is created: sign-out never silently becomes a new guest). Either way the welcome
 * card's attestation and consent are then recorded on the server (`attest_and_consent`, S18,
 * idempotent: the first attestation wins), which every social, realtime and purchase RPC
 * requires.
 *
 * The client uses the PKCE flow (S19): a Google round trip comes back to /auth/callback with a
 * code only this browser can exchange. It never reads tokens from the URL itself
 * (`detectSessionInUrl: false`): only /auth/callback finishes a link, so /mod's own sign-in
 * fragment can never be picked up by the game (NOTE-23).
 *
 * Nothing here logs: the caller logs the outcome without the user id or any token.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import * as z from 'zod/mini'
import { parseRpcError, type AttestationArgs, type RpcErrorCode } from './attestation'
import type { Database } from './database.types'
import type { SupabaseEnv } from './env'

/** What an auth call failed with: the error's class, HTTP status and Auth error code only. */
export interface AuthFailure {
  readonly name: string
  readonly status: number | undefined
  readonly code: string | undefined
}

export type ConnectResult =
  | { readonly ok: true; readonly reused: boolean; readonly permanent: boolean }
  | { readonly ok: false; readonly stage: 'session'; readonly failure: AuthFailure }
  /** No session, and the player signed out of an account here: no guest is created. */
  | { readonly ok: false; readonly stage: 'signed-out' }
  | {
      readonly ok: false
      readonly stage: 'attest'
      readonly code: RpcErrorCode | 'unknown' | 'unexpected-response'
    }

// attest_and_consent returns the caller's profile row. The generated RPC types can resolve its
// data to `never` (NOTE-6), so the one field this relies on is checked at run time.
const AttestedProfileSchema = z.object({ attested: z.literal(true) })

const ErrorShapeSchema = z.object({
  name: z.optional(z.string()),
  status: z.optional(z.number()),
  code: z.optional(z.string()),
})

/** The class, status and code of an auth error (never its message, which may echo input). */
export function failureOf(error: unknown): AuthFailure {
  const parsed = ErrorShapeSchema.safeParse(error)
  const fields = parsed.success ? parsed.data : {}
  return {
    name: fields.name ?? (error instanceof Error ? error.name : typeof error),
    status: fields.status,
    code: fields.code === '' ? undefined : fields.code,
  }
}

let cached: { readonly key: string; readonly client: SupabaseClient<Database> } | undefined

function clientFor(env: SupabaseEnv): SupabaseClient<Database> {
  const key = `${env.url}\n${env.anonKey}`
  if (cached?.key !== key) {
    cached = {
      key,
      client: createClient<Database>(env.url, env.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          flowType: 'pkce',
        },
      }),
    }
  }
  return cached.client
}

/**
 * Reuses the session on this device or starts an anonymous one (unless `signedOut`), then
 * records the attestation. Never throws.
 */
export async function connectAnonymous(
  env: SupabaseEnv,
  attestation: AttestationArgs,
  options: { readonly signedOut: boolean } = { signedOut: false },
): Promise<ConnectResult> {
  try {
    const client = clientFor(env)
    let reused = false
    let permanent = false
    const existing = await client.auth.getSession()
    if (existing.error !== null) {
      return { ok: false, stage: 'session', failure: failureOf(existing.error) }
    }
    if (existing.data.session !== null) {
      reused = true
      permanent = existing.data.session.user.is_anonymous !== true
    } else if (options.signedOut) {
      return { ok: false, stage: 'signed-out' }
    } else {
      const { data, error } = await client.auth.signInAnonymously()
      if (error !== null) return { ok: false, stage: 'session', failure: failureOf(error) }
      if (data.session === null) {
        return {
          ok: false,
          stage: 'session',
          failure: { name: 'NoSession', status: undefined, code: undefined },
        }
      }
    }

    const { data, error } = await client.rpc('attest_and_consent', attestation)
    if (error !== null) return { ok: false, stage: 'attest', code: parseRpcError(error) }
    if (!AttestedProfileSchema.safeParse(data as unknown).success) {
      return { ok: false, stage: 'attest', code: 'unexpected-response' }
    }
    return { ok: true, reused, permanent }
  } catch (error) {
    // supabase-js reports failures as values; a throw is a fetch or storage failure underneath.
    return { ok: false, stage: 'session', failure: failureOf(error) }
  }
}

/**
 * The guest's client for this configuration, for the feature APIs (profileApi.ts, safetyApi.ts)
 * and cloud save sync (S18c, src/state/session.ts). It is the same client connectAnonymous
 * signed in with, so it carries the guest's session.
 */
export function supabaseClient(env: SupabaseEnv): SupabaseClient<Database> {
  return clientFor(env)
}
