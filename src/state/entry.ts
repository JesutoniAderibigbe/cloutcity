/**
 * Whether this device has an account signed in (DEC-62: playing needs an account; no guest
 * play). Session-only and tiny: the entry gate (src/components/welcome/WelcomeGate.tsx) reads
 * it on boot from the account session supabase-js keeps in localStorage, without loading
 * supabase-js; the sign-up and log-in screens set it once a player is in, and the account
 * coordinator clears it on sign-out, which brings the landing back (never a silent new guest).
 */
import { createStore } from 'zustand/vanilla'

export interface EntryState {
  /** undefined until the device's storage has been read (in the browser, on boot). */
  readonly signedIn: boolean | undefined
}

export const entryStore = createStore<EntryState>()(() => ({ signedIn: undefined }))

export function setSignedIn(signedIn: boolean): void {
  if (entryStore.getState().signedIn !== signedIn) entryStore.setState({ signedIn })
}

/** supabase-js's own key for the game's session (`sb-<project ref>-auth-token`). */
const SESSION_KEY = /^sb-.+-auth-token$/

/**
 * Whether storage holds a saved account's session (not a guest's: an anonymous session from
 * before DEC-62 does not count, so that player meets the landing and signs up, keeping their
 * game). Read without supabase-js; stored data is untrusted, so anything unreadable is false.
 */
export function storedAccountSession(storage: Storage | undefined): boolean {
  if (storage === undefined) return false
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key === null || !SESSION_KEY.test(key)) continue
      const raw = storage.getItem(key)
      if (raw === null) continue
      const session = JSON.parse(raw) as { user?: { id?: unknown; is_anonymous?: unknown } }
      if (typeof session.user?.id === 'string' && session.user.is_anonymous === false) return true
    }
  } catch {
    return false
  }
  return false
}
