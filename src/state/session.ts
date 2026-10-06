/**
 * The guest session hook. A Supabase anonymous session may start only after a passing 18+
 * attestation (CLAUDE.md "Auth model", "Age"); under-age and locked players never get one.
 *
 * S05a ships the hook only: it checks the attestation and reports a local (offline-capable)
 * session. S05 adds the anonymous sign-in here, behind the same check, with a lazy import of
 * @supabase/supabase-js so the client stays out of the shell JS.
 */
import { log, type Logger } from '@/lib/log'
import { onboardingStore, type OnboardingStore } from './onboarding'

export type GuestSessionResult =
  /** No passing attestation on this device: no session, no Supabase user. */
  | { readonly mode: 'refused' }
  /** Solo play on this device, with no server session yet. */
  | { readonly mode: 'local' }

/**
 * A session starter bound to one onboarding store. Once a session has started, later calls
 * return it again instead of starting another (the gate calls it on boot and on completion).
 */
export function createGuestSessionStarter(store: OnboardingStore, logger: Logger = log) {
  let started: GuestSessionResult | undefined
  return function startGuestSession(): GuestSessionResult {
    if (started !== undefined) return started
    if (store.getState().record?.status !== 'complete') {
      logger.info('Not starting a guest session: no 18+ attestation on this device')
      return { mode: 'refused' }
    }
    started = { mode: 'local' }
    logger.info('Guest session started', { mode: started.mode })
    return started
  }
}

/** Starts the guest session for this device's onboarding record. */
export const startGuestSession: () => GuestSessionResult =
  createGuestSessionStarter(onboardingStore)
