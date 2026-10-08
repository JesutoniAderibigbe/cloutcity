import { loginDeps } from '@/server/auth/deps'
import { handleLogin } from '@/server/auth/login'

// The service-role key is read at request time on the Node runtime; nothing here is ever
// cached or prerendered.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function POST(request: Request): Promise<Response> {
  return handleLogin(request, loginDeps())
}
