/**
 * Saving progress and logging in (S19), on the guest's own client (supabaseAuth.ts), so an
 * upgrade keeps the same `auth.users.id`: the profile with its attestation and consent, the
 * handle and the cloud save stay where they are. Loaded only through `import()`, with
 * supabase-js, by the account sheet, the welcome card's log-in view and /auth/callback.
 *
 * No passwords (GR-3 does not arise):
 *  - save with email: `updateUser({ email })` on the anonymous user; the confirmation link comes
 *    back to /auth/callback (`token_hash`, finished by a tap). Before sending, the friendly
 *    `check_account_email` pre-check turns a banned email into a plain answer; the database
 *    triggers refuse it anyway (supabase/migrations/*_s19_accounts.sql);
 *  - save with Google: `linkIdentity` (manual linking), back to /auth/callback with a PKCE code;
 *  - log in: `signInWithOtp({ shouldCreateUser: false })` sends a link and a 6-digit code, or
 *    `signInWithOAuth` for Google.
 *
 * Every link points at `<NEXT_PUBLIC_SITE_URL>/auth/callback` (env.ts `authCallbackUrl`): the
 * caller passes it, and without one nothing is sent. Every function answers with a result and
 * never throws. Nothing here logs; callers log the outcome code only, never an email, a code or
 * a token.
 */
import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js'
import * as z from 'zod/mini'
import { markLoginRequested, type CallbackParams } from '@/lib/account/callback'
import { emailHash } from '@/lib/account/emailHash'
import { maskEmail } from '@/lib/account/mask'
import { parseRpcError } from './attestation'
import type { Database } from './database.types'
import type { SupabaseEnv } from './env'
import { failureOf, supabaseClient, type AuthFailure } from './supabaseAuth'

export const ACCOUNT_CODES = [
  'invalid-email',
  'email-exists',
  'not-allowed',
  'rate-limited',
  'offline',
  'code-invalid',
  'no-account',
  'google-unavailable',
  'identity-exists',
  'not-configured',
  'no-session',
  'wrong-account',
  'error',
] as const
export type AccountCode = (typeof ACCOUNT_CODES)[number]

export type AccountResult =
  { readonly ok: true } | { readonly ok: false; readonly code: AccountCode }

type Failed = { readonly ok: false; readonly code: AccountCode }
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
 * Turnstile (SEC-7): when the project turns captcha on, log-in requests must carry a token. The
 * widget is not built yet, so the provider answers undefined until it is wired in.
 */
let captchaProvider: () => Promise<string | undefined> = () => Promise.resolve(undefined)

export function setCaptchaProvider(provider: () => Promise<string | undefined>): void {
  captchaProvider = provider
}

/** Maps an auth failure to what the player is told. */
export function classifyAuthFailure(
  failure: AuthFailure,
  online: boolean,
  context: 'save' | 'login' | 'code' | 'google' | 'callback',
): AccountCode {
  const { code, status, name } = failure
  if (!online || name === 'TypeError' || (name === 'AuthRetryableFetchError' && !status)) {
    return 'offline'
  }
  switch (code) {
    case 'email_exists':
    case 'user_already_exists':
      return 'email-exists'
    case 'identity_already_exists':
      return 'identity-exists'
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'rate-limited'
    case 'otp_expired':
    case 'flow_state_expired':
    case 'flow_state_not_found':
    case 'bad_code_verifier':
      return 'code-invalid'
    case 'otp_disabled':
    case 'signup_disabled':
      return 'no-account'
    case 'email_address_invalid':
      return 'invalid-email'
    case 'provider_disabled':
    case 'manual_linking_disabled':
    case 'oauth_provider_not_supported':
      return 'google-unavailable'
    case 'validation_failed':
      return context === 'google' ? 'google-unavailable' : 'invalid-email'
    default:
      break
  }
  if (status === 429) return 'rate-limited'
  if (context === 'code' && (status === 401 || status === 403)) return 'code-invalid'
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

const CheckSchema = z.enum(['ok', 'not_allowed'])

/**
 * Saves a guest's progress with an email: the pre-check, then the confirmation link to
 * `redirectTo`. The same user id stays; the account becomes permanent once the link is opened.
 */
export async function upgradeWithEmail(
  env: SupabaseEnv,
  email: string,
  redirectTo: string,
): Promise<AccountResult> {
  try {
    const supabase = client(env)
    const { data: session } = await supabase.auth.getSession()
    if (session.session === null) return fail('no-session')
    const check = await supabase.rpc('check_account_email', { p_email: email })
    if (check.error !== null) {
      const code = parseRpcError(check.error)
      if (code === 'rate_limited') return fail('rate-limited')
      if (code === 'invalid_argument') return fail('invalid-email')
      if (code === 'unknown' && !isOnline()) return fail('offline')
      return fail('error')
    }
    const verdict = CheckSchema.safeParse(check.data)
    if (!verdict.success) return fail('error')
    if (verdict.data === 'not_allowed') return fail('not-allowed')
    const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: redirectTo })
    return error === null ? OK : failed(error, 'save')
  } catch (error) {
    return failed(error, 'save')
  }
}

/** Saves a guest's progress with Google: leaves the page for Google, back to `redirectTo`. */
export async function linkGoogle(env: SupabaseEnv, redirectTo: string): Promise<AccountResult> {
  try {
    const { error } = await client(env).auth.linkIdentity({
      provider: 'google',
      options: { redirectTo },
    })
    return error === null ? OK : failed(error, 'google')
  } catch (error) {
    return failed(error, 'google')
  }
}

/** Sends a log-in link and code to an existing account's email (never creates one). */
export async function sendLoginLink(
  env: SupabaseEnv,
  email: string,
  redirectTo: string,
): Promise<AccountResult> {
  try {
    const captchaToken = await captchaProvider()
    const { error } = await client(env).auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: redirectTo,
        ...(captchaToken === undefined ? {} : { captchaToken }),
      },
    })
    if (error !== null) return failed(error, 'login')
    // Only a link that was really sent is this browser's own request (see finishCallback).
    markLoginRequested(Date.now(), await emailHash(email))
    return OK
  } catch (error) {
    return failed(error, 'login')
  }
}

/** Logs in with the 6-digit code from the email. */
export async function verifyLoginCode(
  env: SupabaseEnv,
  email: string,
  code: string,
): Promise<AccountResult> {
  try {
    const { data, error } = await client(env).auth.verifyOtp({ email, token: code, type: 'email' })
    if (error !== null) return failed(error, 'code')
    return data.session === null ? fail('code-invalid') : OK
  } catch (error) {
    return failed(error, 'code')
  }
}

/** Logs in with Google: leaves the page for Google, back to `redirectTo`. */
export async function signInWithGoogle(
  env: SupabaseEnv,
  redirectTo: string,
): Promise<AccountResult> {
  try {
    const { error } = await client(env).auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
    return error === null ? OK : failed(error, 'google')
  } catch (error) {
    return failed(error, 'google')
  }
}

/** How a link finished on this device. */
export type CallbackOutcome =
  /** This browser's own guest was saved (its session refreshed). */
  | { readonly ok: true; readonly outcome: 'saved' }
  /**
   * A save confirmation for an address this browser did not ask to save with (pre-hijack
   * defence): the token is left unused, and the player is told to finish on the device that
   * asked, by link there or by typing the emailed code there.
   */
  | { readonly ok: true; readonly outcome: 'open-elsewhere' }
  /**
   * This browser asked, but the link turned out to be for another account (another game asked
   * to save with the same address at the same time): nothing is taken here (review F1).
   */
  | { readonly ok: true; readonly outcome: 'saved-elsewhere' }
  /** This browser is now signed in to the account (a log-in it asked for, or Google). */
  | { readonly ok: true; readonly outcome: 'login' }
  /**
   * A log-in link for an address this browser did not ask about (review F2, N1): verified, but
   * not taken yet. The page asks "Log in as <the server's address, masked>?" and calls
   * confirmPendingLogin or declinePendingLogin.
   */
  | { readonly ok: true; readonly outcome: 'confirm-login'; readonly maskedEmail: string | null }
  | Failed

/** What this browser knows about the links it asked for (marks hold hashes, never addresses). */
export interface CallbackContext {
  /** Hash of the address a recent log-in link was requested for here, or null. */
  readonly loginHash: string | null
  /** Hash of the address a waiting save-progress link was requested for here, or null. */
  readonly pendingHash: string | null
  /** The address the link's fragment names (untrusted: only compared, never shown or trusted). */
  readonly linkEmail: string | null
}

/**
 * A client that keeps nothing: a link is verified on it, so the session that comes back is
 * never adopted by this browser's guest client unless it is this browser's own account.
 */
function throwawayClient(env: SupabaseEnv): SupabaseClient<Database> {
  const memory = new Map<string, string>()
  return createClient<Database>(env.url, env.anonKey, {
    auth: {
      // Its own key and memory storage: it never shares (or touches) the guest client's session.
      storageKey: 'cloutcity-link-check',
      storage: {
        getItem: (key) => memory.get(key) ?? null,
        setItem: (key, value) => void memory.set(key, value),
        removeItem: (key) => void memory.delete(key),
      },
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

/** A verified log-in waiting for the player's yes (see `confirm-login`); memory only. */
let pendingLogin: { readonly client: SupabaseClient<Database>; readonly session: Session } | null =
  null

function linkFailure(error: unknown): Failed {
  const code = classifyAuthFailure(failureOf(error), isOnline(), 'callback')
  // A used or expired hash answers 403 with otp_expired; anything else from verify that is not
  // the network is the same to the player: the link no longer works.
  return { ok: false, code: code === 'offline' || code === 'not-allowed' ? code : 'code-invalid' }
}

const sameAddress = async (email: string | null | undefined, hash: string | null) =>
  hash !== null && email != null && email !== '' && (await emailHash(email)) === hash

/**
 * Finishes a link.
 *  - Google's PKCE code is exchanged on the guest client (only the browser that started the
 *    round trip holds its verifier).
 *  - A save confirmation (`email_change`) is used only by the guest that asked: this browser
 *    must hold an anonymous session with a waiting upgrade for the very address the link names.
 *    Anywhere else the token is not consumed (`open-elsewhere`), so a link someone else asked
 *    for cannot attach this address to their account (pre-hijack). It is verified on a
 *    throwaway client, and only this browser's own account is refreshed (review F1).
 *  - A log-in link is always verified on a throwaway client; it is taken at once only when the
 *    account it verifies as has the address this browser asked a link for (review N1);
 *    otherwise it is held for the player's "Log in as …?" (review F2).
 */
export async function finishCallback(
  env: SupabaseEnv,
  params: CallbackParams,
  context: CallbackContext,
): Promise<CallbackOutcome> {
  try {
    const guest = client(env)
    if (params.kind === 'code') {
      const { error } = await guest.auth.exchangeCodeForSession(params.code)
      return error === null ? { ok: true, outcome: 'login' } : failed(error, 'callback')
    }
    if (params.type === 'email_change') {
      const here = (await guest.auth.getSession()).data.session?.user
      const askedHere =
        here !== undefined &&
        here.is_anonymous === true &&
        (await sameAddress(context.linkEmail, context.pendingHash))
      if (!askedHere) return { ok: true, outcome: 'open-elsewhere' }
      const throwaway = throwawayClient(env)
      const { data, error } = await throwaway.auth.verifyOtp({
        token_hash: params.tokenHash,
        type: 'email_change',
      })
      if (error !== null) return linkFailure(error)
      if (data.user === null) return fail('code-invalid')
      // The session the confirmation handed out is not this device's to keep.
      if (data.session !== null) await throwaway.auth.signOut({ scope: 'local' })
      if (data.user.id !== here.id) return { ok: true, outcome: 'saved-elsewhere' }
      await guest.auth.refreshSession()
      return { ok: true, outcome: 'saved' }
    }
    const throwaway = throwawayClient(env)
    const { data, error } = await throwaway.auth.verifyOtp({
      token_hash: params.tokenHash,
      type: params.type,
    })
    if (error !== null) return linkFailure(error)
    const verified = data.user
    if (verified === null || data.session === null) return fail('code-invalid')
    if (await sameAddress(verified.email, context.loginHash)) {
      const taken = await guest.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      })
      return taken.error === null ? { ok: true, outcome: 'login' } : failed(taken.error, 'callback')
    }
    pendingLogin = { client: throwaway, session: data.session }
    return {
      ok: true,
      outcome: 'confirm-login',
      maskedEmail:
        verified.email === undefined || verified.email === '' ? null : maskEmail(verified.email),
    }
  } catch (error) {
    return failed(error, 'callback')
  }
}

/**
 * Saves the guest's progress with the 6-digit code from the save email, typed on the device
 * that asked. Verified on a throwaway client: only when the code confirmed this browser's own
 * guest is it refreshed here; a code for another game (someone else asked to save with the same
 * address) is refused and nothing is taken.
 */
export async function verifySaveCode(
  env: SupabaseEnv,
  email: string,
  code: string,
): Promise<AccountResult> {
  try {
    const guest = client(env)
    const here = (await guest.auth.getSession()).data.session?.user.id
    if (here === undefined) return fail('no-session')
    const throwaway = throwawayClient(env)
    const { data, error } = await throwaway.auth.verifyOtp({
      email,
      token: code,
      type: 'email_change',
    })
    if (error !== null) return failed(error, 'code')
    if (data.session !== null) await throwaway.auth.signOut({ scope: 'local' })
    if (data.user === null) return fail('code-invalid')
    if (data.user.id !== here) return fail('wrong-account')
    await guest.auth.refreshSession()
    return OK
  } catch (error) {
    return failed(error, 'code')
  }
}

/** The player said yes to a log-in link they did not ask for here: this browser takes it. */
export async function confirmPendingLogin(env: SupabaseEnv): Promise<AccountResult> {
  const pending = pendingLogin
  pendingLogin = null
  if (pending === null) return fail('code-invalid')
  try {
    const { error } = await client(env).auth.setSession({
      access_token: pending.session.access_token,
      refresh_token: pending.session.refresh_token,
    })
    return error === null ? OK : failed(error, 'callback')
  } catch (error) {
    return failed(error, 'callback')
  }
}

/** "Not me": the held log-in is signed out (its refresh token revoked) and never used here. */
export async function declinePendingLogin(): Promise<void> {
  const pending = pendingLogin
  pendingLogin = null
  if (pending === null) return
  try {
    await pending.client.auth.signOut({ scope: 'local' })
  } catch {
    // Unused anyway: it was never stored on this device.
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

/**
 * Whether a waiting email upgrade was confirmed, perhaps on another device: refreshes the
 * session (its JWT says is_anonymous until then) and reads the user from the server.
 */
export async function pollUpgraded(env: SupabaseEnv): Promise<AccountIdentity | null> {
  try {
    const supabase = client(env)
    const { data, error } = await supabase.auth.getUser()
    if (error !== null || data.user === null || data.user.is_anonymous === true) return null
    await supabase.auth.refreshSession()
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

/**
 * Calls `listener` when this browser signs in to a saved account (here, or in another tab:
 * supabase-js shares sign-ins across tabs). Returns a way to stop.
 */
export function onSignedIn(env: SupabaseEnv, listener: () => void): () => void {
  const { data } = client(env).auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session !== null && session.user.is_anonymous !== true) {
      // Out of the auth callback: supabase-js must not be called back from inside it.
      setTimeout(listener, 0)
    }
  })
  return () => data.subscription.unsubscribe()
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
