import 'server-only'
/**
 * The real dependencies of POST /api/auth/login (S19, DEC-61): the service-role client for the
 * rate limit and the username lookup, and a fresh anon-key client per sign-in.
 */
import { log, newCorrelationId } from '@/lib/log'
import { anonServerClient, serverSupabaseEnv, serviceClient } from '@/server/supabase/service'
import type { LoginDeps } from './login'

type Rpc = (
  fn: string,
  args: Readonly<Record<string, unknown>>,
) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>

export function loginDeps(): LoginDeps {
  const env = serverSupabaseEnv()
  const rpc = (): Rpc => {
    if (env === null) throw new Error('Supabase is not configured on this server')
    return (serviceClient(env).rpc as unknown as Rpc).bind(serviceClient(env))
  }
  return {
    configured: env !== null,
    consume: async (keyHash, bucket, limit) => {
      const { error } = await rpc()('consume_login_attempt', {
        p_key_hash: keyHash,
        p_bucket: bucket,
        p_max: limit.max,
        p_window_ms: limit.windowMs,
      })
      if (error === null) return true
      if (error.message === 'rate_limited') return false
      throw new Error(`consume_login_attempt failed: ${error.code ?? 'unknown'}`)
    },
    emailForHandle: async (handle) => {
      const { data, error } = await rpc()('login_email_for_handle', { p_handle: handle })
      if (error !== null)
        throw new Error(`login_email_for_handle failed: ${error.code ?? 'unknown'}`)
      return typeof data === 'string' && data !== '' ? data : null
    },
    signIn: async (email, password) => {
      if (env === null) return null
      const { data, error } = await anonServerClient(env).auth.signInWithPassword({
        email,
        password,
      })
      if (error !== null) {
        // GoTrue's own per-IP sign-in limit: every username log-in comes from this server.
        if (error.status === 429) return 'rate_limited'
        // A wrong pair (400 invalid_credentials) is the player's answer; anything else is ours.
        if (error.status === 400) return null
        throw new Error(`sign-in failed: ${error.code ?? String(error.status)}`)
      }
      if (data.session === null) return null
      return {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      }
    },
    logger: log,
    newCorrelationId,
  }
}
