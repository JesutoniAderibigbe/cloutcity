/**
 * Signing up and logging in (S19, DEC-61, DEC-62) against a fake game client: a new account
 * (signUp) or a pre-DEC-62 guest's own user (updateUser), the attestation recorded, the username
 * saved; log-in by email here or by username through the server route; and the failures mapped
 * to what the player is told.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'

const calls: { name: string; args: unknown[] }[] = []
let answers: Record<string, unknown> = {}

const answer = (name: string, ...args: unknown[]) => {
  calls.push({ name, args })
  const value = answers[name]
  if (value instanceof Error) throw value
  if (typeof value === 'function')
    return Promise.resolve((value as (a: unknown[]) => unknown)(args))
  return Promise.resolve(value ?? { data: {}, error: null })
}

const fakeClient = {
  rpc: (fn: string, args: unknown) => answer(`rpc:${fn}`, args),
  auth: {
    getSession: () => answer('getSession'),
    signUp: (...args: unknown[]) => answer('signUp', ...args),
    updateUser: (...args: unknown[]) => answer('updateUser', ...args),
    refreshSession: () => answer('refreshSession'),
    signInWithPassword: (...args: unknown[]) => answer('signInWithPassword', ...args),
    setSession: (...args: unknown[]) => answer('setSession', ...args),
    signOut: (...args: unknown[]) => answer('signOut', ...args),
  },
}

vi.mock('./supabaseAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./supabaseAuth')>()),
  supabaseClient: () => fakeClient,
}))

const auth = await import('./accountAuth')

const ENV = { url: 'http://127.0.0.1:54321', anonKey: 'anon' }
const VALUES = { username: 'claude_qa', email: 'jordan@example.com', password: 'correct horse 42' }
const ATTEST = {
  p_adult: true,
  p_attested_at: '2026-10-08T12:00:00.000Z',
  p_consent_version: '2026-10-06',
  p_consented_at: '2026-10-08T12:00:00.000Z',
  p_audio_choice: 'own',
} as const
const authError = (code: string, status = 400, name = 'AuthApiError') =>
  Object.assign(new Error('refused'), { name, code, status })
const noSession = { data: { session: null }, error: null }
const guestSession = { data: { session: { user: { id: 'g1', is_anonymous: true } } }, error: null }
const signedUp = { data: { session: { access_token: 'a' }, user: { id: 'u1' } }, error: null }

beforeEach(() => {
  calls.length = 0
  answers = {}
})

const names = () => calls.map((call) => call.name)

describe('signing up', () => {
  it('a new visitor: signUp, the attestation, then the username', async () => {
    answers = {
      getSession: noSession,
      signUp: signedUp,
      'rpc:check_handle': { data: 'available', error: null },
    }
    expect(await auth.signUpAccount(ENV, VALUES, ATTEST)).toEqual({ ok: true })
    expect(names()).toEqual([
      'getSession',
      'signUp',
      'rpc:attest_and_consent',
      'rpc:check_handle',
      'rpc:set_handle',
    ])
    expect(calls[1]?.args).toEqual([{ email: VALUES.email, password: VALUES.password }])
    expect(calls[2]?.args).toEqual([ATTEST])
  })

  it('a guest from before DEC-62 signs up on their own user, keeping the game', async () => {
    answers = { getSession: guestSession, 'rpc:check_handle': { data: 'available', error: null } }
    expect(await auth.signUpAccount(ENV, VALUES, ATTEST)).toEqual({ ok: true })
    expect(names()).not.toContain('signUp')
    expect(calls.find((call) => call.name === 'updateUser')?.args).toEqual([
      { email: VALUES.email, password: VALUES.password },
    ])
    expect(names()).toContain('refreshSession')
  })

  it("someone else's account left signed in here is signed out first, never reused", async () => {
    answers = {
      getSession: {
        data: { session: { user: { id: 'other', is_anonymous: false } } },
        error: null,
      },
      signUp: signedUp,
      'rpc:check_handle': { data: 'available', error: null },
    }
    await auth.signUpAccount(ENV, VALUES, ATTEST)
    expect(names().slice(0, 3)).toEqual(['getSession', 'signOut', 'signUp'])
  })

  it('maps a taken email, a weak password and the banned-email trigger', async () => {
    for (const [error, code] of [
      [authError('user_already_exists', 422), 'email-exists'],
      [authError('weak_password', 422), 'weak-password'],
      [authError('unexpected_failure', 500, 'AuthRetryableFetchError'), 'not-allowed'],
      [authError('over_request_rate_limit', 429), 'rate-limited'],
    ] as const) {
      answers = { getSession: noSession, signUp: { data: { session: null }, error } }
      expect(await auth.signUpAccount(ENV, VALUES, ATTEST)).toEqual({ ok: false, code })
    }
  })

  it('a project with email confirmations on gives no session: fails closed', async () => {
    answers = { getSession: noSession, signUp: { data: { session: null, user: {} }, error: null } }
    expect(await auth.signUpAccount(ENV, VALUES, ATTEST)).toEqual({
      ok: false,
      code: 'not-configured',
    })
  })

  it('a taken username after the account exists says so; saveUsername tries again', async () => {
    answers = {
      getSession: noSession,
      signUp: signedUp,
      'rpc:check_handle': { data: 'taken', error: null },
    }
    expect(await auth.signUpAccount(ENV, VALUES, ATTEST)).toEqual({
      ok: false,
      code: 'handle-taken',
      accountCreated: true,
    })
    calls.length = 0
    answers = { 'rpc:check_handle': { data: 'available', error: null } }
    expect(await auth.saveUsername(ENV, 'claude_qa2')).toEqual({ ok: true })
    expect(names()).toEqual(['rpc:check_handle', 'rpc:set_handle'])
  })

  it('a username the player already holds is not saved again', async () => {
    answers = { 'rpc:check_handle': { data: 'current', error: null } }
    expect(await auth.saveUsername(ENV, 'claude_qa')).toEqual({ ok: true })
    expect(names()).toEqual(['rpc:check_handle'])
  })

  it('a thrown fetch is a result, never a throw', async () => {
    answers = { getSession: new TypeError('Failed to fetch') }
    expect(await auth.signUpAccount(ENV, VALUES, ATTEST)).toMatchObject({ code: 'offline' })
  })
})

describe('logging in', () => {
  it('an email signs in here with the password', async () => {
    expect(await auth.logIn(ENV, ' jordan@example.com ', 'pw-1')).toEqual({ ok: true })
    expect(calls[0]).toEqual({
      name: 'signInWithPassword',
      args: [{ email: 'jordan@example.com', password: 'pw-1' }],
    })
  })

  it('a username goes to the server, and its tokens are adopted here', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, access_token: 'at', refresh_token: 'rt' }), {
          status: 200,
        }),
    )
    expect(await auth.logIn(ENV, '@claude_qa', 'pw-1', fetcher)).toEqual({ ok: true })
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/auth/login')
    expect(JSON.parse(String(init.body))).toEqual({ identifier: 'claude_qa', password: 'pw-1' })
    expect(init.credentials).toBe('omit')
    expect(calls).toEqual([
      { name: 'setSession', args: [{ access_token: 'at', refresh_token: 'rt' }] },
    ])
  })

  it('every wrong pair is one answer, by email or username', async () => {
    answers = { signInWithPassword: { data: {}, error: authError('invalid_credentials', 400) } }
    expect(await auth.logIn(ENV, 'jo@example.com', 'x')).toEqual({
      ok: false,
      code: 'invalid-credentials',
    })
    const refused = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, code: 'invalid_credentials' }), { status: 401 }),
    )
    expect(await auth.logIn(ENV, 'claude_qa', 'x', refused)).toEqual({
      ok: false,
      code: 'invalid-credentials',
    })
    const limited = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, code: 'rate_limited' }), { status: 429 }),
    )
    expect(await auth.logIn(ENV, 'claude_qa', 'x', limited)).toEqual({
      ok: false,
      code: 'rate-limited',
    })
    expect(names()).not.toContain('setSession')
  })
})

describe('identityOf', () => {
  const user = (fields: Partial<User>): User =>
    ({ id: 'u1', app_metadata: {}, user_metadata: {}, aud: '', created_at: '', ...fields }) as User

  it('a saved account shows its email masked', () => {
    expect(auth.identityOf(user({ is_anonymous: false, email: VALUES.email }))).toEqual({
      userId: 'u1',
      permanent: true,
      maskedEmail: 'j•••@example.com',
      provider: 'email',
    })
    expect(auth.identityOf(user({ is_anonymous: true })).permanent).toBe(false)
  })
})
