import { authCallbackUrl, supabaseEnv, type SupabaseEnv } from '@/lib/supabase/env'

/** What every account action needs (S19): the project, and where its links come back to. */
export interface AccountEnv {
  readonly env: SupabaseEnv
  readonly callback: string
}

/** This build's account configuration, or null: then account actions fail closed. */
export function accountEnv(): AccountEnv | null {
  const env = supabaseEnv()
  const callback = authCallbackUrl()
  return env === null || callback === null ? null : { env, callback }
}

/** The account API with supabase-js, loaded only when the player acts. */
export const loadAccountAuth = () => import('@/lib/supabase/accountAuth')
