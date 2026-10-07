/**
 * POST /api/save (S18c): the device uploads its save; src/server/saves/handleUpload.ts checks
 * and stores it. Node runtime, never cached. Without the service-role configuration the server
 * has no cloud saves and answers 503 (the device keeps playing on its own copy).
 */
import { serverCeilings } from '@/server/saves/ceilings'
import { handleUpload } from '@/server/saves/handleUpload'
import { supabaseSaveBackend } from '@/server/saves/supabaseBackend'
import { serviceClient, serviceEnv } from '@/server/supabase/service'
import { log, newCorrelationId } from '@/lib/log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

export async function POST(request: Request): Promise<Response> {
  const logger = log.withCorrelationId(newCorrelationId())
  const env = serviceEnv()
  if (env === null) {
    return Response.json({ ok: false, code: 'unavailable' }, { status: 503, headers: NO_STORE })
  }
  try {
    const result = await handleUpload(
      {
        authorization: request.headers.get('authorization'),
        bodyText: await request.text(),
      },
      supabaseSaveBackend(serviceClient(env)),
      serverCeilings(),
      Date.now(),
      logger,
    )
    const headers: Record<string, string> = { ...NO_STORE }
    if (!result.body.ok && result.body.code === 'rate-limited') {
      headers['Retry-After'] = String(Math.ceil(result.body.retryAfterMs / 1000))
    }
    return Response.json(result.body, { status: result.status, headers })
  } catch (error) {
    logger.error('A cloud save upload failed on the server', {
      error: error instanceof Error ? error.message : String(error),
    })
    return Response.json({ ok: false, code: 'unavailable' }, { status: 503, headers: NO_STORE })
  }
}
