/**
 * The game's Supabase session (S05, S19, DEC-62). Loaded only through `import()` from
 * src/state/session.ts and the account screens, so @supabase/supabase-js never reaches the shell
 * or the boot islands (src/lib/client-imports.test.ts, src/lib/shell-boundary.test.ts).
 *
 * The session this device holds (supabase-js keeps it under its default
 * `sb-<project ref>-auth-token` key, Q7) is the player's account, signed in by the sign-up or
 * log-in screen; nothing here ever creates one, so a signed-out device never silently becomes a
 * guest. The welcome card's attestation and consent are recorded on the server on every connect
 * (`attest_and_consent`, S18, idempotent: the first attestation wins), which every social,
 * realtime and purchase RPC requires.
 *
 * The client uses the PKCE flow and never reads tokens from the URL (`detectSessionInUrl:
 * false`), so /mod's own sign-in link can never be picked up by the game (NOTE-23).
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
  /** No account session on this device: nothing is created (DEC-62). */
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
 * Reuses the account session on this device (DEC-62: nobody plays as a guest any more, so no
 * anonymous sign-in ever happens here; a guest session from before is reused until its player
 * signs up on it), then records the attestation. No session: `signed-out`, and play stays on
 * this device. Never throws.
 */
export async function connectSession(
  env: SupabaseEnv,
  attestation: AttestationArgs,
): Promise<ConnectResult> {
  try {
    const client = clientFor(env)
    const existing = await client.auth.getSession()
    if (existing.error !== null) {
      return { ok: false, stage: 'session', failure: failureOf(existing.error) }
    }
    if (existing.data.session === null) return { ok: false, stage: 'signed-out' }
    const reused = true
    const permanent = existing.data.session.user.is_anonymous !== true

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
