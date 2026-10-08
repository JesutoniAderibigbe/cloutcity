/**
 * The account forms (S19, DEC-61): creating an account (username, email, password) and logging
 * in (username or email, and the password), each one zod/mini schema for the shared form pattern
 * (GR-1, GR-2, GR-8), whose messages are copy keys.
 *
 * - The username follows the handle rules exactly (src/lib/forms/handle.ts): the field shows the
 *   handle that will be saved before anything is sent (GR-6), and the server's filter and
 *   uniqueness have the last word.
 * - The email is used exactly as typed, with only surrounding whitespace trimmed (GR-6). The
 *   format check is deliberately loose; GoTrue is the last word.
 * - The password is never trimmed or changed. Its length rules come from data/config/
 *   account.json, which supabase/config.toml and the hosted project match.
 */
import accountJson from '@data/config/account.json'
import * as z from 'zod/mini'
import type { CopyKey } from '@/lib/copy'
import type { AccountConfig } from '@/lib/data/schemas/config'
import { normaliseHandleInput } from '@/lib/handles/normalise'
import type { AccountCode } from '@/lib/supabase/accountAuth'
import { createHandleSchema, handlesConfig } from './handle'
// The error keys below are rendered by fieldErrors, which needs their namespace loaded.
import '@/lib/copy/ns/account'
import '@/lib/copy/ns/profile'

export const accountConfig: AccountConfig = accountJson

export const CREATE_FIELDS = ['username', 'email', 'password'] as const
export type CreateField = (typeof CREATE_FIELDS)[number]

export const LOGIN_FIELDS = ['identifier', 'password'] as const
export type LoginField = (typeof LOGIN_FIELDS)[number]

/** What the email field sends: the input with surrounding whitespace removed, nothing else. */
export function emailToSend(raw: string): string {
  return raw.trim()
}

/** What the username field saves: the handle preview (src/lib/handles/normalise.ts). */
export function usernameToSend(raw: string): string {
  return normaliseHandleInput(raw)
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** UTF-8 bytes, the unit GoTrue's 72-byte password limit counts. */
const byteLength = (text: string) => new TextEncoder().encode(text).length

function emailCheck(maxLength: number) {
  return z.string().check(
    z.refine((raw) => emailToSend(raw) !== '', 'account.error.emailRequired'),
    z.refine(
      (raw) => emailToSend(raw) === '' || emailToSend(raw).length <= maxLength,
      'account.error.emailInvalid',
    ),
    z.refine(
      (raw) => emailToSend(raw) === '' || EMAIL_SHAPE.test(emailToSend(raw)),
      'account.error.emailInvalid',
    ),
  )
}

function passwordCheck(rules: AccountConfig['password']) {
  return z.string().check(
    z.refine((raw) => raw !== '', 'account.error.passwordRequired'),
    z.refine((raw) => raw === '' || raw.length >= rules.minLength, 'account.error.passwordShort'),
    z.refine((raw) => byteLength(raw) <= rules.maxLength, 'account.error.passwordLong'),
  )
}

/**
 * The create-account schema. `username` is validated as the handle it will save (pass the raw
 * input; the handle rules run on its preview), with the handle form's own messages.
 */
export function createAccountSchema(config: AccountConfig = accountConfig) {
  const handle = createHandleSchema(handlesConfig)
  return z.object({
    username: z.string().check(
      z.superRefine((raw, ctx) => {
        const preview = usernameToSend(raw)
        if (preview === '') {
          ctx.issues.push({ code: 'custom', message: 'account.error.usernameRequired', input: raw })
          return
        }
        const result = handle.safeParse({ handle: preview })
        const first = result.success ? undefined : result.error.issues[0]
        if (first !== undefined)
          ctx.issues.push({ code: 'custom', message: first.message, input: raw })
      }),
    ),
    email: emailCheck(config.emailMaxLength),
    password: passwordCheck(config.password),
  })
}

export function createLoginSchema(config: AccountConfig = accountConfig) {
  return z.object({
    identifier: z.string().check(
      z.refine((raw) => raw.trim() !== '', 'account.error.identifierRequired'),
      z.refine(
        (raw) => raw.trim().length <= config.emailMaxLength,
        'account.error.identifierRequired',
      ),
    ),
    password: z.string().check(z.refine((raw) => raw !== '', 'account.error.passwordRequired')),
  })
}

/** The copy an account failure shows the player. */
export const ACCOUNT_ERROR_KEY: Readonly<Record<AccountCode, CopyKey>> = {
  'invalid-email': 'account.error.emailInvalid',
  'email-exists': 'account.error.emailExists',
  'not-allowed': 'account.error.notAllowed',
  'weak-password': 'account.error.passwordWeak',
  'handle-taken': 'profile.handle.error.taken',
  'handle-not-allowed': 'profile.handle.error.notAllowed',
  'handle-invalid': 'profile.handle.error.characters',
  'invalid-credentials': 'account.error.invalidCredentials',
  'rate-limited': 'account.error.rateLimited',
  offline: 'account.error.offline',
  'not-configured': 'account.error.unavailable',
  'no-session': 'account.error.other',
  error: 'account.error.other',
}

/** The field a failure belongs under (the rest show as one alert line). */
export const CREATE_FIELD_OF: Partial<Readonly<Record<AccountCode, CreateField>>> = {
  'invalid-email': 'email',
  'email-exists': 'email',
  'not-allowed': 'email',
  'weak-password': 'password',
  'handle-taken': 'username',
  'handle-not-allowed': 'username',
  'handle-invalid': 'username',
}
