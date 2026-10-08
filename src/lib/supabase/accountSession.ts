/**
 * The account coordinator (S19, DEC-62): what changes on this device when the account behind the
 * game client changes. Loaded lazily with supabase-js once the session has connected
 * (src/state/session.ts) or the player has signed up or logged in, and started once per page. It
 * lives beside the Supabase modules, not in src/state, because it calls supabase-js
 * (src/lib/client-imports.test.ts).
 *
 * - Same user, now saved (a guest from before DEC-62 who signed up on their own session): status
 *   `permanent`, the sync record notes the saved owner, nothing restarts.
 * - Another user signed in (a log-in): cloud sync restarts on the same client for that account
 *   (S18c's restore table decides: upload, adopt, or ask), the moderator notices reload, and the
 *   device's attestation is recorded for the account (idempotent: the first one wins).
 * - Signed out (here, or in another tab): sync stops, the game stays on this device, and the
 *   landing comes back (src/state/entry.ts): nobody plays on as a guest.
 *
 * Nothing here logs an email, a user id or a token.
 */
import type { AuthChangeEvent, Session, SupabaseClient, User } from '@supabase/supabase-js'
import { log, type Logger } from '@/lib/log'
import { accountConfig, accountIdentityStore } from '@/state/account'
import { clearAccountNotices } from '@/state/accountNotices'
import { setSignedIn } from '@/state/entry'
import { guestSessionStore, type GuestSessionStore } from '@/state/guestSession'
import { syncStatusStore, type SyncStatusStore } from '@/state/syncStatus'
import { identityOf, signOutLocal, type AccountIdentity, type AccountResult } from './accountAuth'
import type { AttestationArgs } from './attestation'
import type { Database } from './database.types'
import type { SupabaseEnv } from './env'

/** What the coordinator needs; injectable for tests. */
export interface AccountSessionDeps {
  readonly client: SupabaseClient<Database>
  readonly env: SupabaseEnv
  readonly session: GuestSessionStore
  readonly sync: SyncStatusStore
  readonly identity: typeof accountIdentityStore
  /** Whether an account is signed in on this device (the entry gate's signal). */
  readonly setSignedIn: (signedIn: boolean) => void
  /** Cloud sync (src/state/cloudSync.ts), loaded with this module. */
  readonly cloud: {
    start(client: SupabaseClient<Database>): void
    restart(client: SupabaseClient<Database>): void
    stop(): void
    markPermanent(): void
    flushNow(timeoutMs: number): Promise<boolean>
  }
  /** Reloads the moderator notices for the account now signed in. */
  readonly loadNotices: () => void
  /** This device's 18+ attestation and consent (the welcome card's), or null. */
  readonly attestation: () => AttestationArgs | null
  readonly signOutLocal: (env: SupabaseEnv) => Promise<AccountResult>
  /** Defers work out of supabase-js's auth callback (its docs: never await auth calls in it). */
  readonly defer: (task: () => void) => void
  readonly logger: Logger
}

export interface AccountSession {
  /**
   * Signs this device out. Unless `force`, it first gives unsent progress up to
   * `signOutFlushTimeoutMs` to reach the account and answers `unsent` when it could not.
   */
  signOut(force: boolean): Promise<AccountResult | { readonly ok: false; readonly code: 'unsent' }>
  stop(): void
}

export function createAccountSession(deps: AccountSessionDeps, user: User): AccountSession {
  const { logger } = deps
  let current: AccountIdentity = identityOf(user)
  let stopped = false
  // Signed out on this device: the next sign-in (even to the same account) starts over.
  let signedOutHere = false
  const cleanups: (() => void)[] = []

  const show = (identity: AccountIdentity | null) => {
    deps.identity.setState({ identity })
    deps.sync.setState({ identity: identity?.permanent === true ? 'account' : 'guest' })
  }

  const setOnline = (permanent: boolean) => {
    const { reused } = deps.session.getState()
    deps.session.setState({ status: permanent ? 'permanent' : 'anonymous', reason: null, reused })
  }

  const upgraded = (identity: AccountIdentity) => {
    if (stopped || current.permanent) return
    current = identity
    deps.setSignedIn(true)
    deps.cloud.markPermanent()
    setOnline(true)
    show(identity)
    logger.info('Guest progress saved to an account', { provider: identity.provider })
  }

  const switched = (next: User) => {
    signedOutHere = false
    current = identityOf(next)
    if (current.permanent) deps.setSignedIn(true)
    clearAccountNotices()
    deps.cloud.restart(deps.client)
    setOnline(current.permanent)
    show(current)
    deps.loadNotices()
    // An account first created by this log-in (a new Google user) has no attestation yet: this
    // device's own 18+ check and consent are recorded for it, as for any session (the first
    // attestation wins, so an attested account keeps its own).
    const attestation = deps.attestation()
    if (attestation !== null) {
      void Promise.resolve(deps.client.rpc('attest_and_consent', { ...attestation })).then(
        ({ error }) => {
          if (error !== null) logger.info('Could not record the attestation for this account')
        },
      )
    }
    logger.info('Logged in to an account on this device', { provider: current.provider })
  }

  const signedOut = () => {
    if (stopped) return
    deps.cloud.stop()
    deps.session.setState({ status: 'local', reason: 'signed-out', reused: false })
    deps.sync.setState({ status: 'signedOut', identity: 'guest', controls: null })
    show(null)
    clearAccountNotices()
    signedOutHere = true
    // The landing comes back over the game: nobody plays on as a guest (DEC-62).
    deps.setSignedIn(false)
    logger.info('Signed out of the account on this device')
  }

  const onAuth = (event: AuthChangeEvent, session: Session | null) => {
    if (stopped) return
    if (event === 'SIGNED_OUT') {
      deps.defer(signedOut)
      return
    }
    const next = session?.user
    if (next === undefined) return
    if (signedOutHere || next.id !== current.userId) {
      deps.defer(() => switched(next))
    } else if (next.is_anonymous !== true && !current.permanent) {
      deps.defer(() => upgraded(identityOf(next)))
    }
  }

  const { data } = deps.client.auth.onAuthStateChange(onAuth)
  cleanups.push(() => data.subscription.unsubscribe())

  show(current)
  setOnline(current.permanent)
  if (current.permanent) deps.setSignedIn(true)
  deps.cloud.start(deps.client)

  return {
    async signOut(force) {
      if (!force) {
        const flushed = await deps.cloud.flushNow(accountConfig.signOutFlushTimeoutMs)
        if (!flushed) return { ok: false, code: 'unsent' }
      }
      const result = await deps.signOutLocal(deps.env)
      // The SIGNED_OUT event does the same; doing it here too means a lost event cannot leave
      // the device half signed in.
      if (result.ok) signedOut()
      return result
    },
    stop() {
      stopped = true
      for (const cleanup of cleanups.splice(0)) cleanup()
    },
  }
}

export function browserAccountSessionDeps(
  client: SupabaseClient<Database>,
  env: SupabaseEnv,
  cloud: AccountSessionDeps['cloud'],
  attestation: AccountSessionDeps['attestation'],
): AccountSessionDeps {
  return {
    client,
    env,
    attestation,
    session: guestSessionStore,
    sync: syncStatusStore,
    identity: accountIdentityStore,
    setSignedIn,
    cloud,
    loadNotices: () => {
      void import('@/lib/safety/loadNotices')
        .then((module) => module.loadAccountNotices())
        .catch(() => undefined)
    },
    signOutLocal,
    defer: (task) => {
      window.setTimeout(task, 0)
    },
    logger: log,
  }
}

let running: AccountSession | undefined

/** The coordinator for this page, once the guest session has connected. */
export function runningAccountSession(): AccountSession | undefined {
  return running
}

/**
 * Starts the coordinator (and with it cloud sync) once per page, on the client the guest session
 * connected with. Without a signed-in user nothing starts.
 */
export async function startAccountSession(
  client: SupabaseClient<Database>,
  env: SupabaseEnv,
  attestation: AccountSessionDeps['attestation'],
): Promise<AccountSession | undefined> {
  if (running !== undefined) return running
  const { data } = await client.auth.getSession()
  const user = data.session?.user
  if (user === undefined) return undefined
  const sync = await import('@/state/cloudSync')
  running = createAccountSession(
    browserAccountSessionDeps(
      client,
      env,
      {
        start: (c) => void sync.startCloudSync(c),
        restart: (c) => void sync.restartCloudSync(c),
        stop: sync.stopCloudSync,
        markPermanent: () => sync.runningCloudSync()?.markPermanent(),
        flushNow: (ms) => sync.runningCloudSync()?.flushNow(ms) ?? Promise.resolve(true),
      },
      attestation,
    ),
    user,
  )
  return running
}

/**
 * Starts the coordinator after a sign-up or log-in on a device that had no session running it
 * (a first visit, or signed out here): the account just signed in takes over. Its attestation
 * was recorded by the sign-up, or is the account's own.
 */
export async function ensureAccountSession(env: SupabaseEnv): Promise<void> {
  if (running !== undefined) return
  const { supabaseClient } = await import('./supabaseAuth')
  await startAccountSession(supabaseClient(env), env, () => null)
}
