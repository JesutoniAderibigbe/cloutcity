/**
 * The account coordinator (S19) against a fake client: a guest's upgrade (same user), a log-in
 * to another account (sync restarts), a sign-out (sync stops, no new guest next boot), the
 * confirmation poll, and no email or user id in any log line.
 */
import type { AuthChangeEvent, Session, SupabaseClient, User } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import accountJson from '@data/config/account.json'
import { createLogger, type LogRecord } from '@/lib/log'
import { createAccountStore, type PersistedAccount } from '@/state/account'
import { accountIdentityStore } from '@/state/account'
import { createGuestSessionStore } from '@/state/guestSession'
import { createSafeJsonStorage } from '@/state/storage'
import { createSyncStatusStore } from '@/state/syncStatus'
import type { AccountIdentity } from './accountAuth'
import { createAccountSession, type AccountSessionDeps } from './accountSession'
import type { Database } from './database.types'

const EMAIL = 'jordan.private@example.com'
const GUEST_ID = '0b3c0f2e-1111-4000-8000-000000000001'
const OTHER_ID = '0b3c0f2e-2222-4000-8000-000000000002'

const user = (id: string, anonymous: boolean): User =>
  ({
    id,
    is_anonymous: anonymous,
    email: anonymous ? undefined : EMAIL,
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '',
  }) as User

function setup(options: { pendingAt?: number | null; flushed?: boolean } = {}) {
  const records: LogRecord[] = []
  const logger = createLogger({ level: 'debug', sink: (record) => records.push(record) })
  let listener: ((event: AuthChangeEvent, session: Session | null) => void) | null = null
  const client = {
    auth: {
      onAuthStateChange: (cb: typeof listener) => {
        listener = cb
        return { data: { subscription: { unsubscribe: () => (listener = null) } } }
      },
    },
    rpc: vi.fn(async () => ({ data: null, error: null })),
  } as unknown as SupabaseClient<Database>
  const account = createAccountStore(
    createSafeJsonStorage<PersistedAccount>(() => undefined, logger),
    logger,
  )
  if (options.pendingAt !== undefined) account.getState().setPendingUpgrade(options.pendingAt)
  const session = createGuestSessionStore()
  session.setState({ status: 'anonymous', reason: null, reused: true })
  const sync = createSyncStatusStore()
  const cloud = {
    start: vi.fn(),
    restart: vi.fn(),
    stop: vi.fn(),
    markPermanent: vi.fn(),
    flushNow: vi.fn(async () => options.flushed ?? true),
  }
  let focus: (() => void) | null = null
  let tick: (() => void) | null = null
  let now = 1_000_000
  const polled: (AccountIdentity | null)[] = []
  const deps: AccountSessionDeps = {
    client,
    env: { url: 'http://127.0.0.1:54321', anonKey: 'anon' },
    session,
    sync,
    account,
    identity: accountIdentityStore,
    cloud,
    loadNotices: vi.fn(),
    pollUpgraded: vi.fn(async () => polled.shift() ?? null),
    signOutLocal: vi.fn(async () => ({ ok: true as const })),
    now: () => now,
    onFocus: (cb) => {
      focus = cb
      return () => (focus = null)
    },
    every: (_ms, cb) => {
      tick = cb
      return () => (tick = null)
    },
    defer: (task) => task(),
    logger,
  }
  return {
    deps,
    records,
    cloud,
    account,
    session,
    sync,
    polled,
    emit: (event: AuthChangeEvent, next: User | null) =>
      listener?.(event, next === null ? null : ({ user: next } as Session)),
    focus: () => focus?.(),
    tick: () => tick?.(),
    hasPoll: () => focus !== null && tick !== null,
    setNow: (value: number) => (now = value),
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('account coordinator (S19)', () => {
  it('starts sync for the guest and shows them as a guest', () => {
    const s = setup()
    createAccountSession(s.deps, user(GUEST_ID, true))
    expect(s.cloud.start).toHaveBeenCalledTimes(1)
    expect(s.session.getState().status).toBe('anonymous')
    expect(s.sync.getState().identity).toBe('guest')
    expect(accountIdentityStore.getState().identity).toMatchObject({ permanent: false })
  })

  it("a guest's confirmed email keeps the same account: permanent, nothing restarts", () => {
    const s = setup({ pendingAt: 1_000_000 })
    createAccountSession(s.deps, user(GUEST_ID, true))
    s.emit('USER_UPDATED', user(GUEST_ID, false))
    expect(s.session.getState().status).toBe('permanent')
    expect(s.cloud.markPermanent).toHaveBeenCalledTimes(1)
    expect(s.cloud.restart).not.toHaveBeenCalled()
    expect(s.account.getState().pendingUpgradeAt).toBeNull()
    expect(s.sync.getState().identity).toBe('account')
    expect(accountIdentityStore.getState().identity).toEqual({
      userId: GUEST_ID,
      permanent: true,
      maskedEmail: 'j•••@example.com',
      provider: 'email',
    })
  })

  it('a log-in to another account restarts sync for it and reloads the notices', () => {
    const s = setup()
    createAccountSession(s.deps, user(GUEST_ID, true))
    s.emit('SIGNED_IN', user(OTHER_ID, false))
    expect(s.cloud.restart).toHaveBeenCalledTimes(1)
    expect(s.deps.loadNotices).toHaveBeenCalledTimes(1)
    expect(s.session.getState().status).toBe('permanent')
    expect(accountIdentityStore.getState().identity?.userId).toBe(OTHER_ID)
  })

  it('a token refresh for the same guest changes nothing', () => {
    const s = setup()
    createAccountSession(s.deps, user(GUEST_ID, true))
    s.emit('TOKEN_REFRESHED', user(GUEST_ID, true))
    expect(s.cloud.restart).not.toHaveBeenCalled()
    expect(s.cloud.markPermanent).not.toHaveBeenCalled()
  })

  it('signing out (here or in another tab) stops sync and remembers it, so no guest is made', () => {
    const s = setup()
    createAccountSession(s.deps, user(OTHER_ID, false))
    s.emit('SIGNED_OUT', null)
    expect(s.cloud.stop).toHaveBeenCalledTimes(1)
    expect(s.account.getState().signedOut).toBe(true)
    expect(s.session.getState()).toEqual({ status: 'local', reason: 'signed-out', reused: false })
    expect(s.sync.getState()).toMatchObject({ status: 'signedOut', controls: null })
    expect(accountIdentityStore.getState().identity).toBeNull()
  })

  it('sign-out waits for unsent progress, and asks before leaving it behind', async () => {
    const s = setup({ flushed: false })
    const coordinator = createAccountSession(s.deps, user(OTHER_ID, false))
    expect(await coordinator.signOut(false)).toEqual({ ok: false, code: 'unsent' })
    expect(s.cloud.flushNow).toHaveBeenCalledWith(accountJson.signOutFlushTimeoutMs)
    expect(s.deps.signOutLocal).not.toHaveBeenCalled()
    expect(await coordinator.signOut(true)).toEqual({ ok: true })
    expect(s.deps.signOutLocal).toHaveBeenCalledTimes(1)
    expect(s.account.getState().signedOut).toBe(true)
  })

  it('a link out: asks the server on focus and on a timer, and takes the upgrade', async () => {
    const s = setup({ pendingAt: 1_000_000 })
    createAccountSession(s.deps, user(GUEST_ID, true))
    expect(s.hasPoll()).toBe(true)
    s.focus()
    await flush()
    expect(s.session.getState().status).toBe('anonymous')
    s.polled.push({
      userId: GUEST_ID,
      permanent: true,
      maskedEmail: 'j•••@example.com',
      provider: 'email',
    })
    s.tick()
    await flush()
    expect(s.session.getState().status).toBe('permanent')
    expect(s.hasPoll()).toBe(false)
  })

  it('a link older than it lives is forgotten', () => {
    const s = setup({ pendingAt: 1_000_000 })
    s.setNow(1_000_000 + accountJson.pendingUpgradeMaxAgeMs + 1)
    createAccountSession(s.deps, user(GUEST_ID, true))
    expect(s.account.getState().pendingUpgradeAt).toBeNull()
    expect(s.hasPoll()).toBe(false)
  })

  it('never logs the email or a user id', async () => {
    const s = setup({ pendingAt: 1_000_000 })
    const coordinator = createAccountSession(s.deps, user(GUEST_ID, true))
    s.emit('USER_UPDATED', user(GUEST_ID, false))
    s.emit('SIGNED_IN', user(OTHER_ID, false))
    await coordinator.signOut(true)
    const text = JSON.stringify(s.records)
    expect(s.records.length).toBeGreaterThan(0)
    expect(text).not.toContain(EMAIL)
    expect(text).not.toContain('jordan')
    expect(text).not.toContain(GUEST_ID)
    expect(text).not.toContain(OTHER_ID)
  })
})
