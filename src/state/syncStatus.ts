/**
 * Where cloud save sync stands (S18c), for the HUD's CloudSaveStatus chip and its sheet.
 * Session-only, never persisted, and tiny: the chip reads it without loading the sync code
 * (src/state/cloudSync.ts), which registers its controls here once it runs.
 *
 *  - `local`: saved on this device only (no session yet, or no cloud in this build).
 *  - `syncing`: an upload is under way, or a change waits for one.
 *  - `synced`: the account holds this device's latest save.
 *  - `offline`: changes wait for the network.
 *  - `paused`: the server refused the save (or the session); retried later.
 *  - `conflict`: the account holds different progress; the player picks one.
 *  - `update`: the account's save is from a newer build.
 *  - `behind`: the player kept this device's game, but it is from before the account's last
 *    prestige, so it cannot replace the account's game; the account's game is offered.
 *  - `signedOut`: the player signed out of their account here (S19); nothing is saved online
 *    until they log in or start a new guest game.
 */
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

export const SYNC_STATUSES = [
  'local',
  'syncing',
  'synced',
  'offline',
  'paused',
  'conflict',
  'update',
  'behind',
  'signedOut',
] as const
export type SyncStatus = (typeof SYNC_STATUSES)[number]

/** What the sheet can ask the sync to do (registered by src/state/cloudSync.ts). */
export interface SyncControls {
  /** Uploads now (paused or waiting). */
  retryNow(): void
  /** Settles a conflict: keep this device's progress, or take the account's. */
  resolveConflict(choice: 'keep-local' | 'use-cloud'): void
  /** Replaces this device's game with the account's (after a refused save; only on a tap). */
  useCloud(): void
}

/** Whose game the synced save is: a guest's, or a saved account's (S19). */
export type SyncIdentity = 'guest' | 'account'

export interface SyncStatusState {
  readonly status: SyncStatus
  /** True after the server refused this device's save (422), until a save is accepted or taken. */
  readonly rejected: boolean
  /**
   * In a conflict: the account has no save, and this device's game belongs to another saved
   * account (S19), so the choice is keeping it there or starting fresh.
   */
  readonly conflictEmpty: boolean
  readonly identity: SyncIdentity
  readonly controls: SyncControls | null
}

export const INITIAL_SYNC_STATUS: SyncStatusState = {
  status: 'local',
  rejected: false,
  conflictEmpty: false,
  identity: 'guest',
  controls: null,
}

export type SyncStatusStore = ReturnType<typeof createSyncStatusStore>

export function createSyncStatusStore() {
  return createStore<SyncStatusState>()(() => INITIAL_SYNC_STATUS)
}

export const syncStatusStore: SyncStatusStore = createSyncStatusStore()

/** React binding. */
export function useSyncStatus(): SyncStatusState {
  return useStore(syncStatusStore)
}
