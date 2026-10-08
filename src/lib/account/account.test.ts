import { afterEach, describe, expect, it } from 'vitest'
import { parseCallback } from './callback'
import {
  ACCOUNT_HANDOFF_KEY,
  clearAccountHandoff,
  parseAccountHandoff,
  readAccountHandoff,
  writeAccountHandoff,
} from './handoff'
import { maskEmail } from './mask'

const HASH = 'pkce_0a1b2c3d4e5f60718293a4b5c6d7e8f9'

describe('/auth/callback parameters (S19)', () => {
  it("reads our templates' token-hash links", () => {
    for (const type of ['email', 'magiclink', 'email_change'] as const) {
      expect(parseCallback(`?token_hash=${HASH}&type=${type}`)).toEqual({
        kind: 'finish',
        params: { kind: 'token', tokenHash: HASH, type },
      })
    }
  })

  it('refuses a type it does not finish (signup, recovery, invite) or a malformed hash', () => {
    for (const type of ['signup', 'recovery', 'invite', 'sms', '']) {
      expect(parseCallback(`?token_hash=${HASH}&type=${type}`)).toEqual({
        kind: 'error',
        error: 'invalid',
      })
    }
    expect(parseCallback('?token_hash=short&type=email').kind).toBe('error')
    expect(parseCallback(`?token_hash=${HASH}<script>&type=email`).kind).toBe('error')
    expect(parseCallback(`?token_hash=${'a'.repeat(600)}&type=email`).kind).toBe('error')
    expect(parseCallback('').kind).toBe('error')
  })

  it("reads Google's PKCE code", () => {
    expect(parseCallback('?code=0f9e8d7c-6b5a-4321-9876-0123456789ab')).toEqual({
      kind: 'finish',
      params: { kind: 'code', code: '0f9e8d7c-6b5a-4321-9876-0123456789ab' },
    })
  })

  it('maps GoTrue refusals from the query or the fragment', () => {
    expect(
      parseCallback('?error=server_error&error_code=identity_already_exists&error_description=x'),
    ).toEqual({ kind: 'error', error: 'identity-exists' })
    expect(parseCallback('', '#error=access_denied&error_code=otp_expired')).toEqual({
      kind: 'error',
      error: 'expired',
    })
    expect(parseCallback('?error=access_denied')).toEqual({ kind: 'error', error: 'google' })
    // An error wins over a token in the same URL.
    expect(parseCallback(`?token_hash=${HASH}&type=email&error=x`).kind).toBe('error')
  })
})

describe('the account hand-off (S19)', () => {
  afterEach(() => clearAccountHandoff())

  it('keeps the attestation the server holds, and nothing else', () => {
    expect(
      parseAccountHandoff({
        attestation: { attestedAt: 10, consentVersion: '2026-10-06', consentedAt: 20, email: 'x' },
        token: 'y',
      }),
    ).toEqual({ attestation: { attestedAt: 10, consentVersion: '2026-10-06', consentedAt: 20 } })
    expect(parseAccountHandoff({ attestation: null })).toEqual({ attestation: null })
  })

  it('drops a consent that is not a dated version with a time, and refuses junk', () => {
    expect(
      parseAccountHandoff({
        attestation: { attestedAt: 10, consentVersion: 'v1', consentedAt: 20 },
      }),
    ).toEqual({ attestation: { attestedAt: 10, consentVersion: null, consentedAt: null } })
    for (const junk of [null, 'x', {}, { attestation: { attestedAt: -1 } }, { attestation: 3 }]) {
      expect(parseAccountHandoff(junk)).toBeNull()
    }
  })

  it('round-trips through sessionStorage when there is one, and reads nothing otherwise', () => {
    // The unit suite runs in Node: no sessionStorage, so nothing is kept and nothing throws.
    writeAccountHandoff({ attestation: null })
    expect(readAccountHandoff()).toBeNull()
    expect(ACCOUNT_HANDOFF_KEY).toBe('cloutcity:account-attestation')
  })
})

describe('maskEmail (S19)', () => {
  it('shows the first letter and the domain only', () => {
    expect(maskEmail('jordan@gmail.com')).toBe('j•••@gmail.com')
    expect(maskEmail('a@b.co')).toBe('a•••@b.co')
    expect(maskEmail('no-at-sign')).toBe('•••')
    expect(maskEmail('@b.co')).toBe('•••')
  })
})
