import { describe, expect, it } from 'vitest'
import { copy } from '@/lib/copy'
import { ACCOUNT_CODES } from '@/lib/supabase/accountAuth'
import { fieldErrors } from './errors'
import {
  ACCOUNT_ERROR_KEY,
  codeToSend,
  createCodeSchema,
  createEmailSchema,
  emailToSend,
} from './account'

describe('the account email form (S19; GR-1, GR-2, GR-6)', () => {
  const schema = createEmailSchema()
  const errors = (email: string) => fieldErrors(schema, { email })

  it('sends exactly what was typed, only surrounding whitespace trimmed', () => {
    expect(emailToSend('  Jo.Smith+game@Example.COM \n')).toBe('Jo.Smith+game@Example.COM')
    expect(emailToSend('a b@c.d')).toBe('a b@c.d')
  })

  it('asks for an email when the field is empty or blank', () => {
    expect(errors('')).toEqual({ email: 'account.error.emailRequired' })
    expect(errors('   ')).toEqual({ email: 'account.error.emailRequired' })
  })

  it('refuses what is not an email shape, and accepts real ones', () => {
    for (const bad of ['nope', 'a@b', '@b.co', 'a@.', 'a b@c.co', 'a@b@c.co']) {
      expect(errors(bad), bad).toEqual({ email: 'account.error.emailInvalid' })
    }
    for (const good of ['j@gmail.com', ' j@gmail.com ', 'first.last+tag@sub.example.co.uk']) {
      expect(errors(good), good).toEqual({})
    }
  })

  it('refuses an email over the configured length', () => {
    const long = `${'a'.repeat(330)}@example.com`
    expect(errors(long)).toEqual({ email: 'account.error.emailInvalid' })
    expect(fieldErrors(createEmailSchema(400), { email: long })).toEqual({})
  })
})

describe('the log-in code form (S19)', () => {
  const schema = createCodeSchema(6)
  it('takes 6 digits, with spaces or a dash from a paste removed', () => {
    expect(codeToSend(' 123 456 ')).toBe('123456')
    expect(codeToSend('123-456')).toBe('123456')
    expect(fieldErrors(schema, { code: '123 456' })).toEqual({})
    for (const bad of ['', '12345', '1234567', 'abcdef', '12345a']) {
      expect(fieldErrors(schema, { code: bad }), bad).toEqual({ code: 'account.error.codeFormat' })
    }
  })
})

describe('account failures in plain words', () => {
  it('every failure code has copy that renders', () => {
    for (const code of ACCOUNT_CODES) expect(copy(ACCOUNT_ERROR_KEY[code]), code).not.toBe('')
  })
})
