import 'server-only'
/**
 * GET /api/presence (S42, S42b): the signed-out view of who is online, for the landing and any
 * visitor without an account: the honest online count and nothing else (no figures, places or
 * looks: nobody can be singled out without an account). The database function is the service role's only
 * (presence_public_snapshot), so no client role ever reads presence rows; this route answers
 * from a per-instance memo and lets the CDN cache it for `publicCacheS`, so the database sees
 * one read per window however many visitors there are.
 */
import realtimeJson from '@data/config/realtime.json'
import { log, newCorrelationId } from '@/lib/log'
import { parsePublicSnapshot } from '@/realtime/schema'
import type { PublicSnapshot } from '@/realtime/types'
import { serviceClient, serviceEnv } from '@/server/supabase/service'

export interface PublicPresenceDeps {
  /** Null when the server has no Supabase service configuration. */
  readonly read: (() => Promise<unknown>) | null
  readonly now: () => number
  readonly cacheS: number
}

const memo: { at: number; body: PublicSnapshot } = {
  at: -Infinity,
  body: { online: 0 },
}

export function publicPresenceDeps(): PublicPresenceDeps {
  const env = serviceEnv()
  return {
    read:
      env === null
        ? null
        : async () => {
            const { data, error } = await serviceClient(env).rpc('presence_public_snapshot')
            if (error !== null) {
              throw new Error(`presence_public_snapshot failed: ${error.code || 'unknown'}`)
            }
            return data
          },
    now: Date.now,
    cacheS: realtimeJson.presence.publicCacheS,
  }
}

const json = (body: unknown, status: number, cacheS: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control':
        status === 200
          ? `public, max-age=0, s-maxage=${cacheS}, stale-while-revalidate=${cacheS * 2}`
          : 'no-store',
    },
  })

export async function handlePublicPresence(
  deps: PublicPresenceDeps,
  cache: { at: number; body: PublicSnapshot } = memo,
): Promise<Response> {
  if (deps.read === null) return json({ error: 'not_configured' }, 503, deps.cacheS)
  const now = deps.now()
  if (now - cache.at < deps.cacheS * 1000) return json(cache.body, 200, deps.cacheS)
  try {
    const body = parsePublicSnapshot(await deps.read())
    if (body === null) throw new Error('presence_public_snapshot answered an unexpected shape')
    cache.at = now
    cache.body = body
    return json(body, 200, deps.cacheS)
  } catch (error) {
    log.warn('presence: public snapshot failed', {
      correlationId: newCorrelationId(),
      reason: error instanceof Error ? error.message : String(error),
    })
    return json({ error: 'unavailable' }, 503, deps.cacheS)
  }
}
