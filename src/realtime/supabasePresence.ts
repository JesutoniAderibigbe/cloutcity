/**
 * The Supabase implementation of {@link PresenceTransport} (S42 phase 1): the heartbeat, the
 * snapshot and leaving are security-definer RPCs on the player's own session; the signed-out view
 * is the server's cached route `/api/presence`, so no client role ever reads presence rows. No
 * Supabase import here: the RPC port comes from `connectedPresence`, which loads supabase-js
 * through `import()` (the shell never carries it).
 */
import * as z from 'zod/mini'
import { supabaseEnv, type SupabaseEnv } from '@/lib/supabase/env'
import { VoidSchema, callRpc, failure, type ApiResult, type RpcTransport } from '@/lib/supabase/rpc'
import { parsePublicSnapshot, parseSnapshot } from './schema'
import type { PresenceSnapshot, PresenceTransport, PublicSnapshot } from './types'

/** Where the signed-out view is served (src/app/api/presence/route.ts). */
export const PUBLIC_PRESENCE_PATH = '/api/presence'

const done = (result: ApiResult<unknown>): ApiResult<null> =>
  result.ok ? { ok: true, data: null } : result

export function createSupabasePresence(
  rpc: RpcTransport | null,
  fetchJson: (path: string) => Promise<unknown> = defaultFetchJson,
): PresenceTransport {
  const signedOut = () => Promise.resolve(failure('not_authenticated'))
  return {
    beat: async (announce) =>
      rpc === null
        ? signedOut()
        : done(
            await callRpc(
              rpc,
              'presence_beat',
              { p_spot: announce.spot, p_place: announce.place, p_borough: announce.borough },
              VoidSchema,
            ),
          ),
    snapshot: async (): Promise<ApiResult<PresenceSnapshot>> => {
      if (rpc === null) return signedOut()
      const result = await callRpc(rpc, 'presence_snapshot', {}, z.unknown())
      if (!result.ok) return result
      const snapshot = parseSnapshot(result.data)
      return snapshot === null ? failure('unknown') : { ok: true, data: snapshot }
    },
    leave: async () =>
      rpc === null ? signedOut() : done(await callRpc(rpc, 'presence_leave', {}, VoidSchema)),
    publicSnapshot: async (): Promise<ApiResult<PublicSnapshot>> => {
      try {
        const snapshot = parsePublicSnapshot(await fetchJson(PUBLIC_PRESENCE_PATH))
        return snapshot === null ? failure('unknown') : { ok: true, data: snapshot }
      } catch {
        return failure('unknown')
      }
    },
  }
}

async function defaultFetchJson(path: string): Promise<unknown> {
  const response = await fetch(path, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`presence: HTTP ${response.status}`)
  return response.json()
}

/**
 * The transport on this device's session (loads supabase-js), or null without a Supabase
 * configuration: the feature then stays off (CLAUDE.md "Solo play must keep working").
 */
export async function connectedPresence(
  env: SupabaseEnv | null = supabaseEnv(),
): Promise<PresenceTransport | null> {
  if (env === null) return null
  const { supabaseClient } = await import('@/lib/supabase/supabaseAuth')
  const client = supabaseClient(env)
  // The typed client's rpc() is generic over the schema's functions; every answer is validated
  // here, so functions are called through the untyped port.
  const rpc = client as unknown as RpcTransport
  return createSupabasePresence({ rpc: (fn, args) => rpc.rpc(fn, args) })
}
