/**
 * The /mod console's own Supabase session (S18b part 2): a separate client with its own storage
 * key, `cloutcity-mod-auth`, so a moderator signing in never replaces (or reads) the game's
 * guest session on the same device. A first sign-in's confirmation link brings its tokens in the
 * URL fragment, which it picks up itself (implicit flow: the link is requested by the server,
 * which keeps no PKCE verifier); a returning moderator's log-in email (S19's magic-link template)
 * links to /mod with a `token_hash`, finished by a tap (`modFinishLink`) so a mail scanner opening
 * the link uses nothing up. Loaded only by the /mod page, through `import()`.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import type { SupabaseEnv } from './env'

export const MOD_STORAGE_KEY = 'cloutcity-mod-auth'

let cached: SupabaseClient<Database> | undefined

function modClient(env: SupabaseEnv): SupabaseClient<Database> {
  cached ??= createClient<Database>(env.url, env.anonKey, {
    auth: {
      storageKey: MOD_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'implicit',
    },
  })
  return cached
}

/** The moderator's current access token (refreshed when needed), or null when signed out. */
export async function modAccessToken(env: SupabaseEnv): Promise<string | null> {
  const { data, error } = await modClient(env).auth.getSession()
  if (error !== null) return null
  return data.session?.access_token ?? null
}

/** Signs the moderator out of this device (the game's guest session is untouched). */
export async function modSignOut(env: SupabaseEnv): Promise<void> {
  await modClient(env).auth.signOut({ scope: 'local' })
}

/** Finishes a log-in link's token hash with the console's own client; true once signed in. */
export async function modFinishLink(
  env: SupabaseEnv,
  tokenHash: string,
  type: 'email' | 'magiclink',
): Promise<boolean> {
  try {
    const { data, error } = await modClient(env).auth.verifyOtp({ token_hash: tokenHash, type })
    return error === null && data.session !== null
  } catch {
    return false
  }
}
