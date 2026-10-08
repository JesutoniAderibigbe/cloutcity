/**
 * data/config/account.json must agree with what the server enforces: `emailCheck` with
 * public.check_account_email's rate limit (S19), and `password.minLength` (the rule the sign-up
 * form shows) with supabase/config.toml's `minimum_password_length` (DEC-61), so the form never
 * promises a password the server then refuses. The hosted project's dashboard setting is a
 * deploy checklist item (README).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import accountJson from '@data/config/account.json'

const MIGRATIONS = join(import.meta.dirname, '../../../supabase/migrations')
const SUPABASE_CONFIG = join(import.meta.dirname, '../../../supabase/config.toml')

function newestDefinition(fn: string): string {
  const files = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort()
  let found = ''
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8')
    const at = sql.search(new RegExp(`create (?:or replace )?function public\\.${fn}\\(`))
    if (at >= 0) found = sql.slice(at, sql.indexOf('$$;', at))
  }
  return found
}

describe('account config parity (S19)', () => {
  it('check_account_email rate-limits as account.json emailCheck says', () => {
    const body = newestDefinition('check_account_email')
    const match =
      /consume_rate_limit\(v_uid, 'checkAccountEmail', (\d+), interval '(\d+) seconds'\)/.exec(body)
    expect(match, 'the rate limit call').not.toBeNull()
    expect(Number(match?.[1])).toBe(accountJson.emailCheck.max)
    expect(Number(match?.[2]) * 1000).toBe(accountJson.emailCheck.windowMs)
  })

  it('check_account_email refuses an email over account.json emailMaxLength', () => {
    expect(newestDefinition('check_account_email')).toContain(
      `length(p_email) > ${accountJson.emailMaxLength}`,
    )
  })

  it('the password rule shown matches the server minimum, and is at least 8', () => {
    const toml = readFileSync(SUPABASE_CONFIG, 'utf8')
    const match = /^minimum_password_length = (\d+)$/m.exec(toml)
    expect(match, 'minimum_password_length in config.toml').not.toBeNull()
    expect(Number(match?.[1])).toBe(accountJson.password.minLength)
    expect(accountJson.password.minLength).toBeGreaterThanOrEqual(8)
  })

  it('sign-ups need no confirmation email (DEC-61)', () => {
    const toml = readFileSync(SUPABASE_CONFIG, 'utf8')
    const email = toml.slice(toml.indexOf('[auth.email]'))
    expect(/^enable_confirmations = false$/m.exec(email)).not.toBeNull()
  })
})
