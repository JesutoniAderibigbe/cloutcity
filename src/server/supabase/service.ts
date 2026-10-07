/**
 * The service-role Supabase client (S18c). Server-only: the key bypasses row level security, so
 * it lives only in the Next.js server's environment (SUPABASE_SERVICE_ROLE_KEY, never a
 * NEXT_PUBLIC_ variable) and this module refuses to load in a client bundle (RISK-5;
 * src/server/server-boundary.test.ts proves no browser code reaches src/server).
 */
import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

export type ServiceClient = SupabaseClient<Database>

export interface ServiceEnv {
  readonly url: string
  readonly serviceRoleKey: string
}

/**
 * The project URL (SUPABASE_URL, else the public NEXT_PUBLIC_SUPABASE_URL) and the service-role
 * key, or null when either is missing: the server then has no cloud saves (local-only play).
 */
export function serviceEnv(env: NodeJS.ProcessEnv = process.env): ServiceEnv | null {
  const url = (env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
  const serviceRoleKey = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  if (url === '' || serviceRoleKey === '') return null
  try {
    const { protocol } = new URL(url)
    if (protocol !== 'https:' && protocol !== 'http:') return null
  } catch {
    return null
  }
  return { url, serviceRoleKey }
}

let cached: { readonly key: string; readonly client: ServiceClient } | undefined

/** One client per configuration, reused across requests; never persists or refreshes a session. */
export function serviceClient(env: ServiceEnv): ServiceClient {
  const key = `${env.url}\n${env.serviceRoleKey}`
  if (cached?.key !== key) {
    cached = {
      key,
      client: createClient<Database>(env.url, env.serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }),
    }
  }
  return cached.client
}
