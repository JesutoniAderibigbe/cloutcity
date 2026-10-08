import { describe, expect, it } from 'vitest'
import accountJson from '@data/config/account.json'
import { copy } from '@/lib/copy'
import { ACCOUNT_CODES } from '@/lib/supabase/accountAuth'
import { fieldErrors } from './errors'
import {
  ACCOUNT_ERROR_KEY,
  CREATE_FIELD_OF,
  createAccountSchema,
  createLoginSchema,
  emailToSend,
  usernameToSend,
} from './account'

const valid = { username: 'claude_qa', email: 'jo@example.test', password: 'correct horse 42' }

describe('create account (DEC-61; GR-1, GR-2, GR-6)', () => {
  const schema = createAccountSchema()
  const errors = (values: Partial<typeof valid>) => fieldErrors(schema, { ...valid, ...values })

  it('accepts a good username, email and password', () => {
    expect(errors({})).toEqual({})
  })

  it('shows every problem at once, each under its field', () => {
    expect(fieldErrors(schema, { username: '', email: '', password: '' })).toEqual({
      username: 'account.error.usernameRequired',
      email: 'account.error.emailRequired',
      password: 'account.error.passwordRequired',
    })
  })

  it('the username follows the handle rules on the exact handle it saves', () => {
    expect(usernameToSend('claude qa')).toBe('claude_qa')
    expect(errors({ username: 'claude qa' })).toEqual({})
    expect(errors({ username: 'ab' })).toEqual({ username: 'profile.handle.error.tooShort' })
    expect(errors({ username: '9lives' })).toEqual({ username: 'profile.handle.error.start' })
  })

  it('the email is sent as typed, only trimmed, and must look like one', () => {
    expect(emailToSend('  Jo.Smith+game@Example.COM ')).toBe('Jo.Smith+game@Example.COM')
    for (const bad of ['nope', 'a@b', 'a b@c.co']) {
      expect(errors({ email: bad }), bad).toEqual({ email: 'account.error.emailInvalid' })
    }
  })

  it('the password keeps the configured length rules and is never trimmed', () => {
    const { minLength, maxLength } = accountJson.password
    expect(errors({ password: 'x'.repeat(minLength - 1) })).toEqual({
      password: 'account.error.passwordShort',
    })
    expect(errors({ password: 'x'.repeat(minLength) })).toEqual({})
    expect(errors({ password: 'x'.repeat(maxLength + 1) })).toEqual({
      password: 'account.error.passwordLong',
    })
    // 72 bytes, not characters: four-byte characters count four times.
    expect(errors({ password: '😀'.repeat(19) })).toEqual({
      password: 'account.error.passwordLong',
    })
    expect(minLength).toBeGreaterThanOrEqual(8)
  })
})

describe('log in (DEC-61)', () => {
  const schema = createLoginSchema()
  it('needs an identifier and a password, nothing more', () => {
    expect(fieldErrors(schema, { identifier: '', password: '' })).toEqual({
      identifier: 'account.error.identifierRequired',
      password: 'account.error.passwordRequired',
    })
    expect(fieldErrors(schema, { identifier: '@claude_qa', password: 'x' })).toEqual({})
  })
})

describe('account failures in plain words', () => {
  it('every failure code has copy that renders', () => {
    for (const code of ACCOUNT_CODES) expect(copy(ACCOUNT_ERROR_KEY[code]), code).not.toBe('')
  })

  it('the fields a server refusal belongs under', () => {
    expect(CREATE_FIELD_OF['email-exists']).toBe('email')
    expect(CREATE_FIELD_OF['handle-taken']).toBe('username')
    expect(CREATE_FIELD_OF['weak-password']).toBe('password')
    expect(CREATE_FIELD_OF['invalid-credentials']).toBeUndefined()
  })
})
