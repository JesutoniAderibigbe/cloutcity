/**
 * The account forms (S19): the email and the 6-digit code, each one zod/mini schema for the
 * shared form pattern (GR-1, GR-2, GR-8), whose messages are copy keys.
 *
 * The email is used exactly as typed, with only surrounding whitespace trimmed (GR-6): the form
 * shows "We'll send it to <email>" before anything is sent, and "Log in instead" carries it over
 * unchanged. The format check is deliberately loose (one @, something on each side, a dot in
 * the domain): GoTrue is the last word on what is deliverable.
 */
import accountJson from '@data/config/account.json'
import * as z from 'zod/mini'
import type { CopyKey } from '@/lib/copy'
import type { AccountConfig } from '@/lib/data/schemas/config'
import type { AccountCode } from '@/lib/supabase/accountAuth'
// The error keys below are rendered by fieldErrors, which needs their namespace loaded.
import '@/lib/copy/ns/account'

const config: AccountConfig = accountJson

export const EMAIL_FIELDS = ['email'] as const
export type EmailField = (typeof EMAIL_FIELDS)[number]

export const CODE_FIELDS = ['code'] as const
export type CodeField = (typeof CODE_FIELDS)[number]

/** What the email field sends: the input with surrounding whitespace removed, nothing else. */
export function emailToSend(raw: string): string {
  return raw.trim()
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function createEmailSchema(maxLength: number = config.emailMaxLength) {
  // Checked on what will be sent; the first failing check is the one shown.
  return z.object({
    email: z.string().check(
      z.refine((raw) => emailToSend(raw) !== '', 'account.error.emailRequired'),
      z.refine(
        (raw) => emailToSend(raw) === '' || emailToSend(raw).length <= maxLength,
        'account.error.emailInvalid',
      ),
      z.refine(
        (raw) => emailToSend(raw) === '' || EMAIL_SHAPE.test(emailToSend(raw)),
        'account.error.emailInvalid',
      ),
    ),
  })
}

/** What the code field sends: digits only (a pasted "123 456" still works). */
export function codeToSend(raw: string): string {
  return raw.replace(/[\s-]/g, '')
}

export function createCodeSchema(length: number = config.codeLength) {
  const digits = new RegExp(`^\\d{${length}}$`)
  return z.object({
    code: z
      .string()
      .check(z.refine((raw) => digits.test(codeToSend(raw)), 'account.error.codeFormat')),
  })
}

/** The copy an account failure shows the player. */
export const ACCOUNT_ERROR_KEY: Readonly<Record<AccountCode, CopyKey>> = {
  'invalid-email': 'account.error.emailInvalid',
  'email-exists': 'account.error.emailExists',
  'not-allowed': 'account.error.notAllowed',
  'rate-limited': 'account.error.rateLimited',
  offline: 'account.error.offline',
  'code-invalid': 'account.error.codeInvalid',
  'no-account': 'account.error.noAccount',
  'google-unavailable': 'account.error.googleUnavailable',
  'identity-exists': 'account.error.identityExists',
  'not-configured': 'account.error.unavailable',
  'no-session': 'account.error.other',
  error: 'account.error.other',
}

/** Failures that belong under the email field (the rest show as one alert line). */
export const EMAIL_FIELD_CODES: ReadonlySet<AccountCode> = new Set([
  'invalid-email',
  'email-exists',
  'not-allowed',
  'no-account',
])
