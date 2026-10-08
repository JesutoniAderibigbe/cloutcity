import 'server-only'
/**
 * POST /api/auth/login (S19, DEC-61): logging in with a username and password. The browser never
 * learns which email an account uses: the server looks the username's email up with the service
 * role, signs in on the player's behalf, and hands back only the session's tokens, which the
 * game client adopts with `setSession`. An email typed as the identifier works the same way.
 *
 * - One answer for every wrong combination (unknown username, an account without a password,
 *   a wrong password): 401 `invalid_credentials`, so nothing about which accounts exist leaks.
 * - Rate limited per client IP and per identifier typed (data/config/account.json `login`),
 *   counted in the database (public.consume_login_attempt) under SHA-256 keys: an IP or a typed
 *   name is never stored or logged in the clear. Over the limit is 429 `rate_limited`.
 * - Responses are never stored or indexed; the password is never logged.
 */
import accountJson from '@data/config/account.json'
import { createHash } from 'node:crypto'
import * as z from 'zod'
import { looksLikeEmail, usernameOf } from '@/lib/account/identifier'
import type { AccountConfig } from '@/lib/data/schemas/config'
import type { Logger } from '@/lib/log'

const CONFIG: AccountConfig = accountJson

const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Type': 'application/json',
} as const

/** Largest body accepted: an identifier and a password, with room to spare. */
export const LOGIN_MAX_BODY_BYTES = 2048

export const LoginBodySchema = z.strictObject({
  identifier: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(256),
})

export type LoginAnswer =
  | { readonly ok: true; readonly access_token: string; readonly refresh_token: string }
  | {
      readonly ok: false
      readonly code: 'invalid_credentials' | 'rate_limited' | 'invalid' | 'unavailable'
    }

/** What the handler needs; injectable for tests. */
export interface LoginDeps {
  readonly configured: boolean
  /** Counts one attempt for `keyHash` in `bucket`; false when over the limit. */
  consume(
    keyHash: string,
    bucket: 'ip' | 'identifier',
    limit: { readonly max: number; readonly windowMs: number },
  ): Promise<boolean>
  /** The email of the saved account holding this username, or null. */
  emailForHandle(handle: string): Promise<string | null>
  /** Signs in: the session's tokens, null for a wrong pair, or GoTrue's own rate limit. */
  signIn(
    email: string,
    password: string,
  ): Promise<
    { readonly access_token: string; readonly refresh_token: string } | null | 'rate_limited'
  >
  readonly logger: Logger
  readonly newCorrelationId: () => string
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/** The client's IP from the proxy headers (first hop), hashed. */
export function ipKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return sha256(`ip:${forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown'}`)
}

/** The identifier as typed, case- and `@`-insensitive, hashed. */
export function identifierKey(identifier: string): string {
  return sha256(`id:${identifier.trim().replace(/^@+/, '').toLowerCase()}`)
}

function respond(body: LoginAnswer, status: number, correlationId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...HEADERS, 'X-Correlation-Id': correlationId },
  })
}

async function readBody(request: Request): Promise<unknown> {
  const length = Number(request.headers.get('content-length') ?? '0')
  if (length > LOGIN_MAX_BODY_BYTES) return undefined
  try {
    const text = await request.text()
    return text.length > LOGIN_MAX_BODY_BYTES ? undefined : (JSON.parse(text) as unknown)
  } catch {
    return undefined
  }
}

export async function handleLogin(request: Request, deps: LoginDeps): Promise<Response> {
  const correlationId = deps.newCorrelationId()
  const { logger } = deps
  if (!deps.configured) {
    return respond({ ok: false, code: 'unavailable' }, 503, correlationId)
  }
  const parsed = LoginBodySchema.safeParse(await readBody(request))
  if (!parsed.success) return respond({ ok: false, code: 'invalid' }, 400, correlationId)
  const { identifier, password } = parsed.data

  try {
    const ipOk = await deps.consume(ipKey(request), 'ip', CONFIG.login.perIp)
    const idOk = await deps.consume(
      identifierKey(identifier),
      'identifier',
      CONFIG.login.perIdentifier,
    )
    if (!ipOk || !idOk) {
      logger.info('A log-in was rate limited', { correlationId, by: ipOk ? 'identifier' : 'ip' })
      return respond({ ok: false, code: 'rate_limited' }, 429, correlationId)
    }
    // `name@domain` is an email; `@name` or `name` is a username.
    const email = looksLikeEmail(identifier)
      ? identifier
      : await deps.emailForHandle(usernameOf(identifier))
    const session = email === null ? null : await deps.signIn(email, password)
    if (session === 'rate_limited') {
      logger.warn('The auth server rate limited a log-in from this server', { correlationId })
      return respond({ ok: false, code: 'rate_limited' }, 429, correlationId)
    }
    if (session === null) {
      logger.info('A log-in was refused', { correlationId })
      return respond({ ok: false, code: 'invalid_credentials' }, 401, correlationId)
    }
    logger.info('A player logged in by username', { correlationId })
    return respond({ ok: true, ...session }, 200, correlationId)
  } catch (error) {
    logger.warn('Log-in failed on the server', {
      correlationId,
      error: error instanceof Error ? error.name : typeof error,
    })
    return respond({ ok: false, code: 'unavailable' }, 503, correlationId)
  }
}
