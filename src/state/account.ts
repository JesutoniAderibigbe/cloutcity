/**
 * The account on this device (S19, DEC-62), for the Me tab: who is signed in, the email masked,
 * held in memory only (never persisted; supabase-js keeps the session itself). Whether anyone
 * is signed in at all is src/state/entry.ts, which the entry gate reads on boot.
 */
import accountJson from '@data/config/account.json'
import { createStore } from 'zustand/vanilla'
import type { AccountConfig } from '@/lib/data/schemas/config'
import type { AccountIdentity } from '@/lib/supabase/accountAuth'

/** data/config/account.json, validated by AccountConfigSchema in src/lib/data/data.test.ts. */
export const accountConfig: AccountConfig = accountJson

/** Who is signed in on this device, for display; never persisted. */
export interface AccountIdentityState {
  readonly identity: AccountIdentity | null
}

export const accountIdentityStore = createStore<AccountIdentityState>()(() => ({
  identity: null,
}))
