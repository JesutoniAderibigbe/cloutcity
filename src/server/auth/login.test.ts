/**
 * POST /api/auth/login (S19, DEC-61) against fake dependencies: a username or an email signs in
 * and only the session's tokens come back; every wrong combination is one 401; the per-IP and
 * per-identifier limits answer 429 with the config's numbers; a bad body is 400; and neither the
 * password, the identifier nor the email ever reaches a log line.
 */
import { describe, expect, it, vi } from 'vitest'
import accountJson from '@data/config/account.json'
import { createLogger, type LogRecord } from '@/lib/log'
import { handleLogin, identifierKey, ipKey, LOGIN_MAX_BODY_BYTES, type LoginDeps } from './login'

const EMAIL = 'jordan.private@example.com'
const PASSWORD = 'correct horse 42'
const TOKENS = { access_token: 'at-1', refresh_token: 'rt-1' }

function setup(options: { limited?: 'ip' | 'identifier'; configured?: boolean } = {}) {
  const records: LogRecord[] = []
  const consume = vi.fn<LoginDeps['consume']>(async (_key, bucket) => options.limited !== bucket)
  const emailForHandle = vi.fn<LoginDeps['emailForHandle']>(async (handle) =>
    handle.toLowerCase() === 'jordan_nyc' ? EMAIL : null,
  )
  const signIn = vi.fn<LoginDeps['signIn']>(async (email, password) =>
    email === EMAIL && password === PASSWORD ? TOKENS : null,
  )
  const deps: LoginDeps = {
    configured: options.configured ?? true,
    consume,
    emailForHandle,
    signIn,
    logger: createLogger({ level: 'debug', sink: (record) => records.push(record) }),
    newCorrelationId: () => 'corr-1',
  }
  return { deps, records, consume, emailForHandle, signIn }
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

describe('POST /api/auth/login', () => {
  it('a username signs in with its account email and returns only the tokens', async () => {
    const s = setup()
    const response = await handleLogin(
      post({ identifier: ' @Jordan_NYC ', password: PASSWORD }),
      s.deps,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, ...TOKENS })
    expect(s.emailForHandle).toHaveBeenCalledWith('Jordan_NYC')
    expect(s.signIn).toHaveBeenCalledWith(EMAIL, PASSWORD)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-correlation-id')).toBe('corr-1')
  })

  it('an email typed as the identifier signs in directly', async () => {
    const s = setup()
    const response = await handleLogin(post({ identifier: EMAIL, password: PASSWORD }), s.deps)
    expect(response.status).toBe(200)
    expect(s.emailForHandle).not.toHaveBeenCalled()
  })

  it('an unknown username and a wrong password get the same answer', async () => {
    const s = setup()
    const unknown = await handleLogin(post({ identifier: 'nobody', password: PASSWORD }), s.deps)
    const wrong = await handleLogin(post({ identifier: 'jordan_nyc', password: 'nope' }), s.deps)
    for (const response of [unknown, wrong]) {
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ ok: false, code: 'invalid_credentials' })
    }
    expect(s.signIn).toHaveBeenCalledTimes(1)
  })

  it('counts every attempt per IP and per identifier with the config limits', async () => {
    const s = setup()
    await handleLogin(post({ identifier: 'Jordan_NYC', password: 'x' }), s.deps)
    expect(s.consume).toHaveBeenCalledWith(ipKey(post({})), 'ip', accountJson.login.perIp)
    expect(s.consume).toHaveBeenCalledWith(
      identifierKey('@jordan_nyc'),
      'identifier',
      accountJson.login.perIdentifier,
    )
    // Hashed: neither the IP nor the name is stored in the clear.
    expect(ipKey(post({}))).toMatch(/^[0-9a-f]{64}$/)
    expect(identifierKey('jordan_nyc')).not.toContain('jordan')
  })

  it.each(['ip', 'identifier'] as const)(
    'over the %s limit is 429 and never signs in',
    async (by) => {
      const s = setup({ limited: by })
      const response = await handleLogin(
        post({ identifier: 'jordan_nyc', password: PASSWORD }),
        s.deps,
      )
      expect(response.status).toBe(429)
      expect(await response.json()).toEqual({ ok: false, code: 'rate_limited' })
      expect(s.signIn).not.toHaveBeenCalled()
    },
  )

  it("the auth server's own rate limit is a 429, not a wrong password", async () => {
    const s = setup()
    s.signIn.mockResolvedValueOnce('rate_limited')
    const response = await handleLogin(post({ identifier: EMAIL, password: PASSWORD }), s.deps)
    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ ok: false, code: 'rate_limited' })
  })

  it('a malformed, empty, extra-field or oversized body is 400 and counts nothing', async () => {
    const s = setup()
    for (const body of [
      'not json',
      { identifier: '', password: PASSWORD },
      { identifier: 'jordan_nyc' },
      { identifier: 'jordan_nyc', password: PASSWORD, admin: true },
      { identifier: 'jordan_nyc', password: 'x'.repeat(LOGIN_MAX_BODY_BYTES) },
    ]) {
      const response = await handleLogin(post(body), s.deps)
      expect(response.status).toBe(400)
    }
    expect(s.consume).not.toHaveBeenCalled()
  })

  it('a server without Supabase is 503, and a failing lookup is 503, not a 401', async () => {
    expect(
      (
        await handleLogin(
          post({ identifier: 'a', password: 'b' }),
          setup({ configured: false }).deps,
        )
      ).status,
    ).toBe(503)
    const s = setup()
    s.emailForHandle.mockRejectedValueOnce(new Error('db down'))
    const response = await handleLogin(post({ identifier: 'jordan_nyc', password: 'x' }), s.deps)
    expect(response.status).toBe(503)
  })

  it('never logs the password, the identifier or the email', async () => {
    const s = setup()
    await handleLogin(post({ identifier: 'jordan_nyc', password: PASSWORD }), s.deps)
    await handleLogin(post({ identifier: EMAIL, password: 'wrong-pass' }), s.deps)
    const text = JSON.stringify(s.records)
    expect(s.records.length).toBeGreaterThan(0)
    for (const secret of [PASSWORD, 'wrong-pass', 'jordan', EMAIL, '203.0.113.9', 'at-1']) {
      expect(text).not.toContain(secret)
    }
  })
})
