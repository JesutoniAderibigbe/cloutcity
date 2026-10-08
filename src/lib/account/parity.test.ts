/**
 * data/config/account.json `emailCheck` is enforced by public.check_account_email (S19): the
 * migration's rate limit must say the same.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import accountJson from '@data/config/account.json'

const MIGRATIONS = join(import.meta.dirname, '../../../supabase/migrations')

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
})
