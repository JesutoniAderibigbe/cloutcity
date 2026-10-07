import 'server-only'
/**
 * Server-only Supabase clients (S18b part 2; S18c shares it). The service-role key bypasses RLS,
 * so it lives only here: never NEXT_PUBLIC_, never in a client chunk (`import 'server-only'`
 * fails the build if a client module imports this; src/lib/client-imports.test.ts and
 * scripts/shell-guard.ts check it too, RISK-5).
 *
 * Nothing persists a session: every request brings its own bearer token, checked with
 * `auth.getUser(token)`.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

export interface ServerSupabaseEnv {
  readonly url: string
  readonly anonKey: string
  readonly serviceRoleKey: string
}

export interface ServerSupabaseEnvSource {
  readonly NEXT_PUBLIC_SUPABASE_URL: string | undefined
  readonly NEXT_PUBLIC_SUPABASE_ANON_KEY: string | undefined
  readonly SUPABASE_SERVICE_ROLE_KEY: string | undefined
}

/** The server's configuration, or null when any part is missing (the routes then fail closed). */
export function serverSupabaseEnv(
  source: ServerSupabaseEnvSource = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
): ServerSupabaseEnv | null {
  const url = source.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ''
  const anonKey = source.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? ''
  const serviceRoleKey = source.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  if (url === '' || anonKey === '' || serviceRoleKey === '') return null
  try {
    const { protocol } = new URL(url)
    if (protocol !== 'https:' && protocol !== 'http:') return null
  } catch {
    return null
  }
  return { url, anonKey, serviceRoleKey }
}

const OPTIONS = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const

const clients = new Map<string, SupabaseClient<Database>>()

function cachedClient(url: string, key: string): SupabaseClient<Database> {
  const id = `${url}\n${key}`
  let client = clients.get(id)
  if (client === undefined) {
    client = createClient<Database>(url, key, OPTIONS)
    clients.set(id, client)
  }
  return client
}

/** The service-role client: bypasses RLS. Only for RPCs granted to service_role. */
export function serviceClient(env: ServerSupabaseEnv): SupabaseClient<Database> {
  return cachedClient(env.url, env.serviceRoleKey)
}

/**
 * An anon-key client with no session, for auth calls made on a visitor's behalf (sending a
 * moderator's sign-in link). A fresh one per call: auth calls can set state on a client.
 */
export function anonServerClient(env: ServerSupabaseEnv): SupabaseClient<Database> {
  return createClient<Database>(env.url, env.anonKey, OPTIONS)
}
