import { describe, expect, it } from 'vitest'
import { serverSupabaseEnv } from './service'

const full = {
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
}

describe('serverSupabaseEnv', () => {
  it('needs the URL, the anon key and the service-role key', () => {
    expect(serverSupabaseEnv(full)).toEqual({
      url: 'http://127.0.0.1:54321',
      anonKey: 'anon',
      serviceRoleKey: 'service',
    })
    expect(serverSupabaseEnv({ ...full, SUPABASE_SERVICE_ROLE_KEY: ' ' })).toBeNull()
    expect(serverSupabaseEnv({ ...full, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined })).toBeNull()
    expect(
      serverSupabaseEnv({ ...full, NEXT_PUBLIC_SUPABASE_URL: 'javascript:alert(1)' }),
    ).toBeNull()
    expect(serverSupabaseEnv({ ...full, NEXT_PUBLIC_SUPABASE_URL: 'not a url' })).toBeNull()
  })
})
