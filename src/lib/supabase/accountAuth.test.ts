/**
 * The account calls (S19) against a fake guest client: the pre-check before any upgrade link,
 * log-in never creating an account, every link pointed at the callback it is given, and the
 * failures mapped to what the player is told.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'

const calls: { name: string; args: unknown[] }[] = []
let answers: Record<string, unknown> = {}

const answer = (name: string, ...args: unknown[]) => {
  calls.push({ name, args })
  const value = answers[name]
  if (value instanceof Error) throw value
  return Promise.resolve(value ?? { data: {}, error: null })
}

const fakeClient = {
  rpc: (...args: unknown[]) => answer('rpc', ...args),
  auth: {
    getSession: () => answer('getSession'),
    updateUser: (...args: unknown[]) => answer('updateUser', ...args),
    linkIdentity: (...args: unknown[]) => answer('linkIdentity', ...args),
    signInWithOtp: (...args: unknown[]) => answer('signInWithOtp', ...args),
    signInWithOAuth: (...args: unknown[]) => answer('signInWithOAuth', ...args),
    verifyOtp: (...args: unknown[]) => answer('verifyOtp', ...args),
    exchangeCodeForSession: (...args: unknown[]) => answer('exchangeCodeForSession', ...args),
    signOut: (...args: unknown[]) => answer('signOut', ...args),
    refreshSession: (...args: unknown[]) => answer('refreshSession', ...args),
    setSession: (...args: unknown[]) => answer('setSession', ...args),
  },
}

// The throwaway client a link is verified on (review F1/F2): its calls are named `throwaway.*`.
const throwawayClient = {
  auth: {
    verifyOtp: (...args: unknown[]) => answer('throwaway.verifyOtp', ...args),
    signOut: (...args: unknown[]) => answer('throwaway.signOut', ...args),
  },
}

vi.mock('@supabase/supabase-js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@supabase/supabase-js')>()),
  createClient: () => throwawayClient,
}))

vi.mock('./supabaseAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./supabaseAuth')>()),
  supabaseClient: () => fakeClient,
}))

const auth = await import('./accountAuth')

const ENV = { url: 'http://127.0.0.1:54321', anonKey: 'anon' }
const CALLBACK = 'https://cloutcity.example/auth/callback'
const EMAIL = 'jordan@example.com'
const SESSION = { data: { session: { user: { id: 'u1' } } }, error: null }
const authError = (code: string, status = 400) =>
  Object.assign(new Error('refused'), { name: 'AuthApiError', code, status })

beforeEach(() => {
  calls.length = 0
  answers = {}
})

describe('saving progress with an email', () => {
  it('pre-checks the email, then asks GoTrue for the confirmation link to the callback', async () => {
    answers = { getSession: SESSION, rpc: { data: 'ok', error: null } }
    expect(await auth.upgradeWithEmail(ENV, EMAIL, CALLBACK)).toEqual({ ok: true })
    expect(calls.map((call) => call.name)).toEqual(['getSession', 'rpc', 'updateUser'])
    expect(calls[1]?.args).toEqual(['check_account_email', { p_email: EMAIL }])
    expect(calls[2]?.args).toEqual([{ email: EMAIL }, { emailRedirectTo: CALLBACK }])
  })

  it('a banned email gets a plain answer and no link', async () => {
    answers = { getSession: SESSION, rpc: { data: 'not_allowed', error: null } }
    expect(await auth.upgradeWithEmail(ENV, EMAIL, CALLBACK)).toEqual({
      ok: false,
      code: 'not-allowed',
    })
    expect(calls.map((call) => call.name)).not.toContain('updateUser')
  })

  it('maps the pre-check limit, a taken email and a refused confirmation', async () => {
    answers = { getSession: SESSION, rpc: { data: null, error: { message: 'rate_limited' } } }
    expect(await auth.upgradeWithEmail(ENV, EMAIL, CALLBACK)).toMatchObject({
      code: 'rate-limited',
    })
    answers = {
      getSession: SESSION,
      rpc: { data: 'ok', error: null },
      updateUser: { data: {}, error: authError('email_exists', 422) },
    }
    expect(await auth.upgradeWithEmail(ENV, EMAIL, CALLBACK)).toMatchObject({
      code: 'email-exists',
    })
    // The banned-email trigger answers 500 (src: *_s19_accounts.sql).
    answers = {
      getSession: SESSION,
      rpc: { data: 'ok', error: null },
      updateUser: {
        data: {},
        error: Object.assign(new Error('x'), { name: 'AuthRetryableFetchError', status: 500 }),
      },
    }
    expect(await auth.upgradeWithEmail(ENV, EMAIL, CALLBACK)).toMatchObject({ code: 'error' })
  })

  it('needs a guest session first', async () => {
    answers = { getSession: { data: { session: null }, error: null } }
    expect(await auth.upgradeWithEmail(ENV, EMAIL, CALLBACK)).toMatchObject({ code: 'no-session' })
  })

  it('a thrown fetch is a result, never a throw', async () => {
    answers = { getSession: new TypeError('Failed to fetch') }
    expect(await auth.upgradeWithEmail(ENV, EMAIL, CALLBACK)).toMatchObject({ code: 'offline' })
  })
})

describe('logging in', () => {
  it('sends a link and code without ever creating an account', async () => {
    expect(await auth.sendLoginLink(ENV, EMAIL, CALLBACK)).toEqual({ ok: true })
    expect(calls[0]?.args).toEqual([
      { email: EMAIL, options: { shouldCreateUser: false, emailRedirectTo: CALLBACK } },
    ])
  })

  it('passes a captcha token once a provider gives one (SEC-7)', async () => {
    auth.setCaptchaProvider(() => Promise.resolve('captcha-1'))
    await auth.sendLoginLink(ENV, EMAIL, CALLBACK)
    expect(calls[0]?.args).toEqual([
      {
        email: EMAIL,
        options: { shouldCreateUser: false, emailRedirectTo: CALLBACK, captchaToken: 'captcha-1' },
      },
    ])
    auth.setCaptchaProvider(() => Promise.resolve(undefined))
  })

  it('an email with no account says so', async () => {
    answers = { signInWithOtp: { data: {}, error: authError('otp_disabled', 422) } }
    expect(await auth.sendLoginLink(ENV, EMAIL, CALLBACK)).toMatchObject({ code: 'no-account' })
  })

  it('verifies the 6-digit code as an email OTP', async () => {
    answers = { verifyOtp: { data: { session: {} }, error: null } }
    expect(await auth.verifyLoginCode(ENV, EMAIL, '123456')).toEqual({ ok: true })
    expect(calls[0]?.args).toEqual([{ email: EMAIL, token: '123456', type: 'email' }])
    answers = { verifyOtp: { data: { session: null }, error: authError('otp_expired', 403) } }
    expect(await auth.verifyLoginCode(ENV, EMAIL, '000000')).toMatchObject({
      code: 'code-invalid',
    })
  })

  it('Google goes through the callback, for linking and for logging in', async () => {
    await auth.linkGoogle(ENV, CALLBACK)
    await auth.signInWithGoogle(ENV, CALLBACK)
    expect(calls.map((call) => [call.name, call.args[0]])).toEqual([
      ['linkIdentity', { provider: 'google', options: { redirectTo: CALLBACK } }],
      ['signInWithOAuth', { provider: 'google', options: { redirectTo: CALLBACK } }],
    ])
    answers = { linkIdentity: { data: {}, error: authError('manual_linking_disabled') } }
    expect(await auth.linkGoogle(ENV, CALLBACK)).toMatchObject({ code: 'google-unavailable' })
  })
})

describe('/auth/callback (review F1, F2)', () => {
  const HASH = 'h'.repeat(20)
  const verified = (id: string, email = EMAIL) => ({
    data: { session: { access_token: 'a', refresh_token: 'r' }, user: { id, email } },
    error: null,
  })
  const here = (id: string | null) => ({
    data: { session: id === null ? null : { user: { id } } },
    error: null,
  })

  it("a save confirmation for this browser's own guest refreshes it here", async () => {
    answers = { 'throwaway.verifyOtp': verified('u1'), getSession: here('u1') }
    expect(
      await auth.finishCallback(
        ENV,
        { kind: 'token', tokenHash: HASH, type: 'email_change' },
        false,
      ),
    ).toEqual({ ok: true, outcome: 'saved' })
    const names = calls.map((call) => call.name)
    expect(names).toContain('throwaway.verifyOtp')
    expect(names).toContain('refreshSession')
    expect(names).not.toContain('verifyOtp')
    expect(names).not.toContain('setSession')
  })

  it("someone else's save confirmation is never adopted here (session fixation)", async () => {
    answers = { 'throwaway.verifyOtp': verified('attacker'), getSession: here('victim') }
    expect(
      await auth.finishCallback(
        ENV,
        { kind: 'token', tokenHash: HASH, type: 'email_change' },
        false,
      ),
    ).toEqual({ ok: true, outcome: 'saved-elsewhere' })
    const names = calls.map((call) => call.name)
    expect(names).toContain('throwaway.signOut')
    expect(names).not.toContain('refreshSession')
    expect(names).not.toContain('setSession')
    // On a device with no session at all (another device), the same: nothing is taken.
    calls.length = 0
    answers = { 'throwaway.verifyOtp': verified('owner'), getSession: here(null) }
    expect(
      await auth.finishCallback(
        ENV,
        { kind: 'token', tokenHash: HASH, type: 'email_change' },
        true,
      ),
    ).toEqual({ ok: true, outcome: 'saved-elsewhere' })
  })

  it('a log-in this browser asked for signs in on the guest client at once', async () => {
    answers = { verifyOtp: { data: { session: {}, user: {} }, error: null } }
    expect(
      await auth.finishCallback(ENV, { kind: 'token', tokenHash: HASH, type: 'email' }, true),
    ).toEqual({ ok: true, outcome: 'login' })
    expect(calls.map((call) => call.name)).toEqual(['verifyOtp'])
  })

  it('a log-in link this browser did not ask for is held until the player says yes', async () => {
    answers = { 'throwaway.verifyOtp': verified('owner') }
    expect(
      await auth.finishCallback(ENV, { kind: 'token', tokenHash: HASH, type: 'email' }, false),
    ).toEqual({ ok: true, outcome: 'confirm-login', maskedEmail: 'j•••@example.com' })
    expect(calls.map((call) => call.name)).toEqual(['throwaway.verifyOtp'])
    expect(await auth.confirmPendingLogin(ENV)).toEqual({ ok: true })
    expect(calls.at(-1)).toEqual({
      name: 'setSession',
      args: [{ access_token: 'a', refresh_token: 'r' }],
    })
    // Spent: a second yes takes nothing.
    expect(await auth.confirmPendingLogin(ENV)).toEqual({ ok: false, code: 'code-invalid' })
  })

  it('"Not me" signs the held log-in out and never touches the guest client', async () => {
    answers = { 'throwaway.verifyOtp': verified('owner') }
    await auth.finishCallback(ENV, { kind: 'token', tokenHash: HASH, type: 'email' }, false)
    await auth.declinePendingLogin()
    expect(calls.map((call) => call.name)).toEqual(['throwaway.verifyOtp', 'throwaway.signOut'])
  })

  it("Google's code is exchanged on the guest client", async () => {
    await auth.finishCallback(ENV, { kind: 'code', code: 'c'.repeat(20) }, false)
    expect(calls[0]).toEqual({ name: 'exchangeCodeForSession', args: ['c'.repeat(20)] })
  })

  it('a used or expired link is one answer', async () => {
    const expired = { data: { session: null, user: null }, error: authError('otp_expired', 403) }
    answers = { verifyOtp: expired, 'throwaway.verifyOtp': expired }
    for (const requested of [true, false]) {
      expect(
        await auth.finishCallback(
          ENV,
          { kind: 'token', tokenHash: HASH, type: 'email' },
          requested,
        ),
      ).toEqual({ ok: false, code: 'code-invalid' })
    }
  })
})

describe('classifyAuthFailure', () => {
  it.each([
    [{ name: 'AuthApiError', status: 422, code: 'email_exists' }, 'save', 'email-exists'],
    [
      { name: 'AuthApiError', status: 422, code: 'identity_already_exists' },
      'google',
      'identity-exists',
    ],
    [
      { name: 'AuthApiError', status: 429, code: 'over_email_send_rate_limit' },
      'save',
      'rate-limited',
    ],
    [{ name: 'AuthApiError', status: 429, code: undefined }, 'login', 'rate-limited'],
    [{ name: 'AuthApiError', status: 403, code: 'otp_expired' }, 'code', 'code-invalid'],
    [{ name: 'AuthApiError', status: 422, code: 'otp_disabled' }, 'login', 'no-account'],
    [{ name: 'AuthApiError', status: 400, code: 'email_address_invalid' }, 'save', 'invalid-email'],
    [
      { name: 'AuthApiError', status: 400, code: 'validation_failed' },
      'google',
      'google-unavailable',
    ],
    [{ name: 'AuthRetryableFetchError', status: 0, code: undefined }, 'login', 'offline'],
    [{ name: 'TypeError', status: undefined, code: undefined }, 'login', 'offline'],
    [{ name: 'AuthApiError', status: 500, code: 'unexpected_failure' }, 'save', 'error'],
  ] as const)('%o in %s → %s', (failure, context, expected) => {
    expect(auth.classifyAuthFailure(failure, true, context)).toBe(expected)
  })

  it('offline wins over any code', () => {
    expect(
      auth.classifyAuthFailure(
        { name: 'AuthApiError', status: 422, code: 'email_exists' },
        false,
        'save',
      ),
    ).toBe('offline')
  })
})

describe('identityOf', () => {
  const user = (fields: Partial<User>): User =>
    ({ id: 'u1', app_metadata: {}, user_metadata: {}, aud: '', created_at: '', ...fields }) as User

  it('a guest has no email and no provider', () => {
    expect(auth.identityOf(user({ is_anonymous: true }))).toEqual({
      userId: 'u1',
      permanent: false,
      maskedEmail: null,
      provider: null,
    })
  })

  it('a saved account shows its email masked, and Google when linked', () => {
    expect(auth.identityOf(user({ is_anonymous: false, email: EMAIL }))).toEqual({
      userId: 'u1',
      permanent: true,
      maskedEmail: 'j•••@example.com',
      provider: 'email',
    })
    expect(
      auth.identityOf(
        user({
          is_anonymous: false,
          email: EMAIL,
          identities: [{ provider: 'google' } as NonNullable<User['identities']>[number]],
        }),
      ).provider,
    ).toBe('google')
  })
})
