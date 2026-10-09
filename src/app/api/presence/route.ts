import { handlePublicPresence, publicPresenceDeps } from '@/server/presence/publicSnapshot'

// The service-role key is read at request time on the Node runtime; the answer is cached by the
// CDN (Cache-Control) and a per-instance memo, never prerendered.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(): Promise<Response> {
  return handlePublicPresence(publicPresenceDeps())
}
