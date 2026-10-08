import { supabaseEnv, type SupabaseEnv } from '@/lib/supabase/env'

/** This build's account configuration, or null: then account actions fail closed. */
export function accountEnv(): SupabaseEnv | null {
  return supabaseEnv()
}

/** The account API with supabase-js, loaded only when the player acts. */
export const loadAccountAuth = () => import('@/lib/supabase/accountAuth')
