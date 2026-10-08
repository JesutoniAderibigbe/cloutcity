/**
 * The account coordinator (S19): what changes on this device when the account behind the guest
 * client changes. Loaded lazily with supabase-js once the guest session has connected
 * (src/state/session.ts), and started once per page. It lives beside the Supabase modules, not in
 * src/state, because it calls supabase-js (src/lib/client-imports.test.ts).
 *
 * - Same user, now saved (a guest's email link opened here or on another device, or Google
 *   linked): status `permanent`, the sync record notes the saved owner, nothing restarts.
 * - Another user signed in (a log-in from the Me tab or the sheet): cloud sync restarts on the
 *   same client for that account (S18c's restore table decides: upload, adopt, or ask), the
 *   moderator notices reload, and the device's attestation is recorded for the account
 *   (idempotent: an attested account keeps its own).
 * - Signed out (here, or in another tab): sync stops, the game stays playable on this device,
 *   and `signedOut` is remembered so the next boot never quietly creates a new guest.
 * - An email upgrade link is out: this device asks the server whether it was confirmed, on
 *   focus and every `upgradePollMs`, since the link may be opened on another device.
 *
 * Nothing here logs an email, a user id or a token.
 */
import type { AuthChangeEvent, Session, SupabaseClient, User } from '@supabase/supabase-js'
import { log, type Logger } from '@/lib/log'
import {
  accountConfig,
  accountIdentityStore,
  accountStore,
  upgradePending,
  type AccountStore,
} from '@/state/account'
import { clearAccountNotices } from '@/state/accountNotices'
import { guestSessionStore, type GuestSessionStore } from '@/state/guestSession'
import { armSavePrompt } from '@/state/savePrompt'
import { syncStatusStore, type SyncStatusStore } from '@/state/syncStatus'
import {
  identityOf,
  pollUpgraded,
  signOutLocal,
  type AccountIdentity,
  type AccountResult,
} from './accountAuth'
import type { AttestationArgs } from './attestation'
import type { Database } from './database.types'
import type { SupabaseEnv } from './env'

/** What the coordinator needs; injectable for tests. */
export interface AccountSessionDeps {
  readonly client: SupabaseClient<Database>
  readonly env: SupabaseEnv
  readonly session: GuestSessionStore
  readonly sync: SyncStatusStore
  readonly account: AccountStore
  readonly identity: typeof accountIdentityStore
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
  readonly pollUpgraded: (env: SupabaseEnv) => Promise<AccountIdentity | null>
  readonly signOutLocal: (env: SupabaseEnv) => Promise<AccountResult>
  readonly now: () => number
  /** Runs `listener` on focus and when the page becomes visible; returns a way to stop. */
  readonly onFocus: (listener: () => void) => () => void
  readonly every: (ms: number, listener: () => void) => () => void
  /** Defers work out of supabase-js's auth callback (its docs: never await auth calls in it). */
  readonly defer: (task: () => void) => void
  readonly logger: Logger
}

export interface AccountSession {
  /** Starts watching for a confirmed email upgrade (after an upgrade link was sent). */
  watchUpgrade(): void
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
  let stopPoll: (() => void) | null = null
  const cleanups: (() => void)[] = []

  const show = (identity: AccountIdentity | null) => {
    deps.identity.setState({ identity })
    deps.sync.setState({ identity: identity?.permanent === true ? 'account' : 'guest' })
  }

  const setOnline = (permanent: boolean) => {
    const { reused } = deps.session.getState()
    deps.session.setState({ status: permanent ? 'permanent' : 'anonymous', reason: null, reused })
  }

  const settledPermanent = () => {
    deps.account.getState().setSignedOut(false)
    deps.account.getState().setPendingUpgrade(null)
    stopPoll?.()
    stopPoll = null
  }

  const upgraded = (identity: AccountIdentity) => {
    if (stopped || current.permanent) return
    current = identity
    settledPermanent()
    deps.cloud.markPermanent()
    setOnline(true)
    show(identity)
    logger.info('Guest progress saved to an account', { provider: identity.provider })
  }

  const switched = (next: User) => {
    current = identityOf(next)
    if (current.permanent) settledPermanent()
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
    deps.account.getState().setSignedOut(true)
    deps.account.getState().setPendingUpgrade(null)
    stopPoll?.()
    stopPoll = null
    deps.session.setState({ status: 'local', reason: 'signed-out', reused: false })
    deps.sync.setState({ status: 'signedOut', identity: 'guest', controls: null })
    show(null)
    clearAccountNotices()
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
    if (next.id !== current.userId) {
      deps.defer(() => switched(next))
    } else if (next.is_anonymous !== true && !current.permanent) {
      deps.defer(() => upgraded(identityOf(next)))
    }
  }

  const poll = () => {
    if (stopped || current.permanent) return
    if (!upgradePending(deps.account.getState().pendingUpgradeAt, deps.now())) {
      // The link ran out (an hour): stop asking until the player sends another.
      deps.account.getState().setPendingUpgrade(null)
      stopPoll?.()
      stopPoll = null
      return
    }
    void deps.pollUpgraded(deps.env).then((identity) => {
      if (identity !== null && identity.userId === current.userId) upgraded(identity)
    })
  }

  const watchUpgrade = () => {
    if (stopped || current.permanent || stopPoll !== null) return
    const stopFocus = deps.onFocus(poll)
    const stopTimer = deps.every(accountConfig.upgradePollMs, poll)
    stopPoll = () => {
      stopFocus()
      stopTimer()
    }
  }

  const { data } = deps.client.auth.onAuthStateChange(onAuth)
  cleanups.push(() => data.subscription.unsubscribe())

  show(current)
  setOnline(current.permanent)
  if (current.permanent) settledPermanent()
  deps.cloud.start(deps.client)
  if (!current.permanent && deps.account.getState().pendingUpgradeAt !== null) {
    watchUpgrade()
    poll()
  }

  return {
    watchUpgrade,
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
      stopPoll?.()
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
    account: accountStore,
    identity: accountIdentityStore,
    cloud,
    loadNotices: () => {
      void import('@/lib/safety/loadNotices')
        .then((module) => module.loadAccountNotices())
        .catch(() => undefined)
    },
    pollUpgraded,
    signOutLocal,
    now: () => Date.now(),
    onFocus: (listener) => {
      const visible = () => {
        if (document.visibilityState === 'visible') listener()
      }
      window.addEventListener('focus', listener)
      document.addEventListener('visibilitychange', visible)
      return () => {
        window.removeEventListener('focus', listener)
        document.removeEventListener('visibilitychange', visible)
      }
    },
    every: (ms, listener) => {
      const timer = window.setInterval(listener, ms)
      return () => window.clearInterval(timer)
    },
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
  armSavePrompt()
  return running
}
