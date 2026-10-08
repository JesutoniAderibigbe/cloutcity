/**
 * The account's state on this device (S19).
 *
 * Persisted to localStorage under `cloutcity:account`, separate from the game save (like the
 * onboarding record) and never holding an email, a code or a token:
 *  - `promptDismissed`: the player tapped "Not now" on the save-progress banner; it does not
 *    come back by itself (the Me tab and the level-up nudge still offer it);
 *  - `signedOut`: the player signed out of an account here, so the next boot must not create a
 *    new guest (src/state/session.ts); cleared by logging in or starting a new guest game;
 *  - `pendingUpgradeAt`: an email upgrade link was sent at this time and not yet confirmed; this
 *    device keeps asking the server whether it was confirmed;
 *  - `pendingUpgradeHash`: a hash of the address that link was sent to (src/lib/account/
 *    emailHash.ts), so /auth/callback uses a save link only on the device that asked for it.
 *
 * Session-only (never persisted): who is signed in, for the Me tab (the email masked, in memory
 * only).
 *
 * Stored data is untrusted: validated on load, anything that does not fit is ignored. Like the
 * other stores it hydrates synchronously when this module loads in a browser.
 */
import accountJson from '@data/config/account.json'
import { persist, type PersistStorage } from 'zustand/middleware'
import { createStore } from 'zustand/vanilla'
import * as z from 'zod/mini'
import { firstMilestoneReached } from '@/engine/goals'
import type { AccountConfig } from '@/lib/data/schemas/config'
import type { AccountIdentity } from '@/lib/supabase/accountAuth'
import { log, type Logger } from '@/lib/log'
import type { GuestSessionState } from './guestSession'
import { browserLocalStorage, createSafeJsonStorage, guardNewerVersion } from './storage'

export const ACCOUNT_KEY = 'cloutcity:account'
export const ACCOUNT_VERSION = 1

/** data/config/account.json, validated by AccountConfigSchema in src/lib/data/data.test.ts. */
export const accountConfig: AccountConfig = accountJson

export const PersistedAccountSchema = z.strictObject({
  promptDismissed: z.boolean(),
  signedOut: z.boolean(),
  pendingUpgradeAt: z.nullable(z.int().check(z.gte(0))),
  pendingUpgradeHash: z.optional(z.nullable(z.string().check(z.regex(/^[0-9a-f]{64}$/)))),
})
export type PersistedAccount = z.infer<typeof PersistedAccountSchema>

export const INITIAL_ACCOUNT: PersistedAccount = {
  promptDismissed: false,
  signedOut: false,
  pendingUpgradeAt: null,
  pendingUpgradeHash: null,
}

export interface AccountActions {
  dismissPrompt(): void
  setSignedOut(signedOut: boolean): void
  /**
   * An upgrade link went out at `nowMs` to the address hashed as `addressHash`; null once it is
   * confirmed or abandoned.
   */
  setPendingUpgrade(nowMs: number | null, addressHash?: string | null): void
}

export type AccountState = PersistedAccount & AccountActions

export function createAccountStore(
  storage: PersistStorage<PersistedAccount>,
  logger: Logger = log,
) {
  return createStore<AccountState>()(
    persist(
      (set) => ({
        ...INITIAL_ACCOUNT,
        dismissPrompt: () => set({ promptDismissed: true }),
        setSignedOut: (signedOut) => set({ signedOut }),
        setPendingUpgrade: (nowMs, addressHash = null) =>
          set({
            pendingUpgradeAt: nowMs,
            pendingUpgradeHash: nowMs === null ? null : addressHash,
          }),
      }),
      {
        name: ACCOUNT_KEY,
        version: ACCOUNT_VERSION,
        storage: guardNewerVersion(storage, ACCOUNT_VERSION),
        partialize: ({
          promptDismissed,
          signedOut,
          pendingUpgradeAt,
          pendingUpgradeHash,
        }): PersistedAccount => ({
          promptDismissed,
          signedOut,
          pendingUpgradeAt,
          pendingUpgradeHash,
        }),
        // Only version 1 exists; anything else starts over (nothing here is worth guessing at).
        migrate: (_persisted, version): PersistedAccount => {
          logger.info('Ignoring account settings in an unknown format', { version })
          return INITIAL_ACCOUNT
        },
        merge: (persisted, current) => {
          if (persisted === undefined || persisted === null) return current
          const result = PersistedAccountSchema.safeParse(persisted)
          if (!result.success) {
            logger.info('Ignoring account settings that failed validation')
            return current
          }
          return { ...current, ...result.data }
        },
      },
    ),
  )
}

export type AccountStore = ReturnType<typeof createAccountStore>

export const accountStore: AccountStore = createAccountStore(
  createSafeJsonStorage<PersistedAccount>(browserLocalStorage),
)

/** Who is signed in on this device, for display; never persisted. */
export interface AccountIdentityState {
  readonly identity: AccountIdentity | null
}

export const accountIdentityStore = createStore<AccountIdentityState>()(() => ({
  identity: null,
}))

/** A waiting upgrade worth polling for: sent, and not older than the link lives. */
export function upgradePending(
  pendingUpgradeAt: number | null,
  nowMs: number,
  config: Pick<AccountConfig, 'pendingUpgradeMaxAgeMs'> = accountConfig,
): boolean {
  return pendingUpgradeAt !== null && nowMs - pendingUpgradeAt <= config.pendingUpgradeMaxAgeMs
}

export interface SavePromptInputs {
  readonly save: Parameters<typeof firstMilestoneReached>[0]
  readonly session: Pick<GuestSessionState, 'status'>
  readonly dismissed: boolean
  /** The first-run tour is on screen (S06): one banner at a time. */
  readonly tourActive: boolean
  /** An upgrade link is already out: the player is mid-save. */
  readonly pending: boolean
}

/**
 * Whether the save-progress banner shows (CLAUDE.md principle 1, GR-4): only after the first
 * milestone, only to a guest with a server session (a guest offline or without a configured
 * cloud has nothing to save to; the Me tab says why), never over the tour, and not again once
 * dismissed or while an upgrade link is out.
 */
export function savePromptDue(inputs: SavePromptInputs): boolean {
  return (
    inputs.session.status === 'anonymous' &&
    !inputs.dismissed &&
    !inputs.tourActive &&
    !inputs.pending &&
    firstMilestoneReached(inputs.save)
  )
}
