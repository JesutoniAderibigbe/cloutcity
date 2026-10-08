/**
 * Signing up and logging in (S19, DEC-61, DEC-62: username + email + password, no email
 * service, no guest play), on the game's own client (supabaseAuth.ts). Loaded only through
 * `import()`, with supabase-js, by the sign-up and log-in screens.
 *
 *  - Sign up: `signUp({ email, password })` ("Confirm email" is off in the project, so the
 *    session is immediate), then the welcome card's 18+ attestation and consent are recorded
 *    (`attest_and_consent`), then the username is checked and saved (`check_handle`,
 *    `set_handle`). A device still holding a guest session from before DEC-62 signs up on that
 *    same user instead (`updateUser({ email, password })`), so its game and cloud save carry
 *    over. A banned email is refused by the database triggers (supabase/migrations/*_s19_*.sql).
 *  - Log in with an email: `signInWithPassword` here. With a username: POST /api/auth/login (the
 *    server looks the email up and signs in), then `setSession` with the tokens it hands back.
 *    Every wrong combination is one answer.
 *
 * Every function answers with a result and never throws. Nothing here logs; callers log the
 * outcome code only, never an email, a username or a password.
 */
import type { SupabaseClient, User } from '@supabase/supabase-js'
import * as z from 'zod/mini'
import { looksLikeEmail, usernameOf } from '@/lib/account/identifier'
import { maskEmail } from '@/lib/account/mask'
import { parseRpcError } from './attestation'
import type { Database } from './database.types'
import type { SupabaseEnv } from './env'
import { failureOf, supabaseClient, type AuthFailure } from './supabaseAuth'

export const ACCOUNT_CODES = [
  'invalid-email',
  'email-exists',
  'not-allowed',
  'weak-password',
  'handle-taken',
  'handle-not-allowed',
  'handle-invalid',
  'invalid-credentials',
  'rate-limited',
  'offline',
  'not-configured',
  'no-session',
  'error',
] as const
export type AccountCode = (typeof ACCOUNT_CODES)[number]

type Failed = { readonly ok: false; readonly code: AccountCode }
export type AccountResult = { readonly ok: true } | Failed

const fail = (code: AccountCode): Failed => ({ ok: false, code })
const OK: AccountResult = { ok: true }

/** Who is signed in on this device: a guest, or a saved account. */
export interface AccountIdentity {
  readonly userId: string
  readonly permanent: boolean
  /** The email, masked for display (`j•••@gmail.com`); null for a guest. Memory only. */
  readonly maskedEmail: string | null
  readonly provider: 'email' | 'google' | null
}

/** What the server holds about the player's 18+ check and consent (their own profile row). */
export interface ServerAttestation {
  readonly attested: boolean
  readonly attestedAt: number | null
  readonly consentVersion: string | null
  readonly consentedAt: number | null
}

/**
 * Turnstile (SEC-7): when the project turns captcha on, password sign-ins must carry a token.
 * The widget is not built yet, so the provider answers undefined until it is wired in.
 */
let captchaProvider: () => Promise<string | undefined> = () => Promise.resolve(undefined)

export function setCaptchaProvider(provider: () => Promise<string | undefined>): void {
  captchaProvider = provider
}

/** Maps an auth failure to what the player is told. */
export function classifyAuthFailure(
  failure: AuthFailure,
  online: boolean,
  context: 'create' | 'login',
): AccountCode {
  const { code, status, name } = failure
  if (!online || name === 'TypeError' || (name === 'AuthRetryableFetchError' && !status)) {
    return 'offline'
  }
  switch (code) {
    case 'email_exists':
    case 'user_already_exists':
      return 'email-exists'
    case 'weak_password':
      return 'weak-password'
    case 'invalid_credentials':
    case 'user_not_found':
    case 'email_not_confirmed':
      return 'invalid-credentials'
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'rate-limited'
    case 'email_address_invalid':
      return 'invalid-email'
    case 'validation_failed':
      return 'invalid-email'
    default:
      break
  }
  if (status === 429) return 'rate-limited'
  if (context === 'login' && (status === 400 || status === 401)) return 'invalid-credentials'
  return 'error'
}

// Only a browser that says it is offline counts as offline (Node's navigator has no onLine).
const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false

function failed(error: unknown, context: Parameters<typeof classifyAuthFailure>[2]): Failed {
  return fail(classifyAuthFailure(failureOf(error), isOnline(), context))
}

function providerOf(user: User): 'email' | 'google' | null {
  const providers = (user.identities ?? []).map((identity) => identity.provider)
  if (providers.includes('google')) return 'google'
  if (user.email !== undefined && user.email !== '') return 'email'
  return null
}

/** The identity of a user as this device shows it. */
export function identityOf(user: User): AccountIdentity {
  const permanent = user.is_anonymous !== true
  return {
    userId: user.id,
    permanent,
    maskedEmail:
      permanent && user.email !== undefined && user.email !== '' ? maskEmail(user.email) : null,
    provider: permanent ? providerOf(user) : null,
  }
}

function client(env: SupabaseEnv): SupabaseClient<Database> {
  return supabaseClient(env)
}

const CheckHandleSchema = z.enum(['available', 'current', 'taken', 'invalid', 'not_allowed'])

/** An RPC refusal in account terms (the handle and email checks). */
function rpcFailure(error: unknown): Failed {
  const code = parseRpcError(error)
  switch (code) {
    case 'rate_limited':
      return fail('rate-limited')
    case 'invalid_argument':
      return fail('invalid-email')
    case 'handle_taken':
      return fail('handle-taken')
    case 'handle_not_allowed':
      return fail('handle-not-allowed')
    case 'handle_invalid':
      return fail('handle-invalid')
    case 'unknown':
      return fail(isOnline() ? 'error' : 'offline')
    default:
      return fail('error')
  }
}

/** The welcome card's answers the server records with the account (attest_and_consent). */
export type AttestationInput = Readonly<{
  p_adult: true
  p_attested_at: string
  p_consent_version: string
  p_consented_at: string
  p_audio_choice: 'ours' | 'own'
}>

/**
 * A refused sign-up. The only failure the database adds to creating (or upgrading) a user is the
 * banned-email trigger, which GoTrue reports as a server error: shown as "can't be used here".
 */
function signUpFailure(error: unknown): Failed {
  const failure = failureOf(error)
  const code = classifyAuthFailure(failure, isOnline(), 'create')
  return fail(code === 'error' && failure.status === 500 ? 'not-allowed' : code)
}

/** How signing up went. */
export type SignUpResult =
  | { readonly ok: true }
  /**
   * The account exists (and is signed in here), but the username was refused (taken, or not
   * allowed): the player picks another and `saveUsername` tries again.
   */
  | { readonly ok: false; readonly code: AccountCode; readonly accountCreated: true }
  | Failed

/**
 * Creates the account and signs it in on this device: `signUp`, or, on a device still holding a
 * guest session from before DEC-62, `updateUser` on that same guest (keeping its game); then the
 * attestation and consent, then the username.
 */
export async function signUpAccount(
  env: SupabaseEnv,
  values: { readonly username: string; readonly email: string; readonly password: string },
  attestation: AttestationInput,
): Promise<SignUpResult> {
  try {
    const supabase = client(env)
    const { data: existing } = await supabase.auth.getSession()
    const guest = existing.session?.user
    if (guest !== undefined && guest.is_anonymous === true) {
      const { error } = await supabase.auth.updateUser({
        email: values.email,
        password: values.password,
      })
      if (error !== null) return signUpFailure(error)
      // The JWT says is_anonymous until it is refreshed; the server reads auth.users anyway.
      await supabase.auth.refreshSession()
    } else {
      // Someone else's account left signed in here (a shared device) is not this player's.
      if (guest !== undefined) await supabase.auth.signOut({ scope: 'local' })
      const captchaToken = await captchaProvider()
      const { data, error } = await supabase.auth.signUp({
        email: values.email,
        password: values.password,
        ...(captchaToken === undefined ? {} : { options: { captchaToken } }),
      })
      if (error !== null) return signUpFailure(error)
      // With email confirmations on (a misconfigured project) there is no session: fail closed.
      if (data.session === null) return fail('not-configured')
    }
    const attested = await supabase.rpc('attest_and_consent', { ...attestation })
    if (attested.error !== null) return { ...rpcFailure(attested.error), accountCreated: true }
    const handle = await saveUsername(env, values.username)
    return handle.ok ? handle : { ...handle, accountCreated: true }
  } catch (error) {
    return failed(error, 'create')
  }
}

/** Checks and saves the signed-in player's username (their generated handle otherwise stays). */
export async function saveUsername(env: SupabaseEnv, username: string): Promise<AccountResult> {
  try {
    const supabase = client(env)
    const check = await supabase.rpc('check_handle', { p_handle: username })
    if (check.error !== null) return rpcFailure(check.error)
    const status = CheckHandleSchema.safeParse(check.data)
    if (!status.success) return fail('error')
    if (status.data === 'current') return OK
    if (status.data === 'taken') return fail('handle-taken')
    if (status.data === 'not_allowed') return fail('handle-not-allowed')
    if (status.data === 'invalid') return fail('handle-invalid')
    const saved = await supabase.rpc('set_handle', { p_handle: username })
    return saved.error === null ? OK : rpcFailure(saved.error)
  } catch (error) {
    return failed(error, 'create')
  }
}

/**
 * Records the welcome card's answers for an account that has none yet (an account signed up
 * before its 18+ check reached the server). Idempotent: the first attestation wins.
 */
export async function recordAttestation(
  env: SupabaseEnv,
  attestation: AttestationInput,
): Promise<AccountResult> {
  try {
    const { error } = await client(env).rpc('attest_and_consent', { ...attestation })
    return error === null ? OK : rpcFailure(error)
  } catch (error) {
    return failed(error, 'create')
  }
}

/** Records the sound choice on the account (best effort: this device's choice already holds). */
export async function recordAudioChoice(env: SupabaseEnv, choice: 'ours' | 'own'): Promise<void> {
  try {
    await client(env).rpc('set_audio_choice', { p_choice: choice })
  } catch {
    // The choice lives on this device; the account copy catches up with the next attestation.
  }
}

const LoginReplySchema = z.union([
  z.object({ ok: z.literal(true), access_token: z.string(), refresh_token: z.string() }),
  z.object({ ok: z.literal(false), code: z.string() }),
])

/** Where the username log-in route lives (src/app/api/auth/login). */
export const LOGIN_ROUTE = '/api/auth/login'

/**
 * Logs this device in with a username or an email and a password. An email signs in here; a
 * username goes through the server (which never tells the browser the email) and the session
 * it hands back is adopted. Every wrong combination is `invalid-credentials`.
 */
export async function logIn(
  env: SupabaseEnv,
  identifier: string,
  password: string,
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): Promise<AccountResult> {
  try {
    const supabase = client(env)
    if (looksLikeEmail(identifier)) {
      const captchaToken = await captchaProvider()
      const { error } = await supabase.auth.signInWithPassword({
        email: identifier.trim(),
        password,
        ...(captchaToken === undefined ? {} : { options: { captchaToken } }),
      })
      return error === null ? OK : failed(error, 'login')
    }
    const response = await fetcher(LOGIN_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: usernameOf(identifier), password }),
      cache: 'no-store',
      credentials: 'omit',
    })
    if (response.status === 429) return fail('rate-limited')
    if (response.status === 401) return fail('invalid-credentials')
    const reply = LoginReplySchema.safeParse(await response.json().catch(() => null))
    if (!reply.success || !reply.data.ok)
      return fail(response.status === 400 ? 'invalid-credentials' : 'error')
    const { error } = await supabase.auth.setSession({
      access_token: reply.data.access_token,
      refresh_token: reply.data.refresh_token,
    })
    return error === null ? OK : failed(error, 'login')
  } catch (error) {
    return failed(error, 'login')
  }
}

/** Who is signed in now, read from the server (not the cached session), or null. */
export async function currentIdentity(env: SupabaseEnv): Promise<AccountIdentity | null> {
  try {
    const { data, error } = await client(env).auth.getUser()
    if (error !== null || data.user === null) return null
    return identityOf(data.user)
  } catch {
    return null
  }
}

const ProfileSchema = z.object({
  attested: z.boolean(),
  attested_at: z.nullable(z.string()),
  consent_version: z.nullable(z.string()),
  consented_at: z.nullable(z.string()),
})

const msOf = (value: string | null): number | null => {
  if (value === null) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/** The signed-in player's attestation and consent as the server holds them, or null. */
export async function readServerAttestation(env: SupabaseEnv): Promise<ServerAttestation | null> {
  try {
    const { data, error } = await client(env)
      .from('profiles')
      .select('attested, attested_at, consent_version, consented_at')
      .maybeSingle()
    if (error !== null) return null
    if (data === null) {
      return { attested: false, attestedAt: null, consentVersion: null, consentedAt: null }
    }
    const parsed = ProfileSchema.safeParse(data)
    if (!parsed.success) return null
    return {
      attested: parsed.data.attested,
      attestedAt: msOf(parsed.data.attested_at),
      consentVersion: parsed.data.consent_version,
      consentedAt: msOf(parsed.data.consented_at),
    }
  } catch {
    return null
  }
}

/** Signs this device out of the account (other devices stay signed in). */
export async function signOutLocal(env: SupabaseEnv): Promise<AccountResult> {
  try {
    const { error } = await client(env).auth.signOut({ scope: 'local' })
    return error === null ? OK : failed(error, 'login')
  } catch (error) {
    return failed(error, 'login')
  }
}
