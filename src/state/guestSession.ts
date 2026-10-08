/**
 * Where the guest session stands (S05): session-only, never persisted, and never holding the
 * user id or any token (supabase-js keeps the session in its own storage key).
 *
 *  - `idle`: nothing has happened yet on this page.
 *  - `refused`: no passing 18+ attestation on this device; no Supabase user is ever created.
 *  - `local`: solo play on this device. `reason` says why there is no server session.
 *  - `connecting`: an anonymous sign-in is under way (after the map is playable).
 *  - `anonymous`: signed in anonymously (a guest), with the attestation recorded on the server.
 *  - `permanent`: signed in to a saved account (S19: an upgraded guest, or a log-in).
 */
import { createStore } from 'zustand/vanilla'

export const GUEST_SESSION_STATUSES = [
  'idle',
  'refused',
  'local',
  'connecting',
  'anonymous',
  'permanent',
] as const
export type GuestSessionStatus = (typeof GUEST_SESSION_STATUSES)[number]

export type GuestSessionReason =
  /** No Supabase URL or anon key in this build. */
  | 'no-config'
  /** Too many anonymous sign-ins from this network (HTTP 429). */
  | 'rate-limited'
  /** The network was unreachable. */
  | 'offline'
  /** Anonymous sign-ins are turned off on the project. */
  | 'disabled'
  /** Signed in, but the server did not record the attestation. */
  | 'attestation-failed'
  /** The player signed out of their account on this device (S19); no guest is created. */
  | 'signed-out'
  /** Anything else the server or client refused. */
  | 'error'

export interface GuestSessionState {
  readonly status: GuestSessionStatus
  readonly reason: GuestSessionReason | null
  /** True when an existing session from this device was reused instead of a new sign-in. */
  readonly reused: boolean
}

export const INITIAL_GUEST_SESSION: GuestSessionState = {
  status: 'idle',
  reason: null,
  reused: false,
}

export type GuestSessionStore = ReturnType<typeof createGuestSessionStore>

export function createGuestSessionStore() {
  return createStore<GuestSessionState>()(() => INITIAL_GUEST_SESSION)
}

export const guestSessionStore: GuestSessionStore = createGuestSessionStore()

/** True when the player has a server session (a guest's or a saved account's). */
export function isOnlineSession(state: Pick<GuestSessionState, 'status'>): boolean {
  return state.status === 'anonymous' || state.status === 'permanent'
}
