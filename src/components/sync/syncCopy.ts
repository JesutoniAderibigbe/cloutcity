import { copy, type CopyKey } from '@/lib/copy'
import type { SyncIdentity, SyncStatus } from '@/state/syncStatus'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/sync'

export type { SyncIdentity }

/** The copy key of a status line (`status`) or its explanation (`sheet`). */
export function syncCopyKey(
  part: 'status' | 'sheet',
  status: SyncStatus,
  identity: SyncIdentity = 'guest',
): CopyKey {
  return status === 'synced' ? `sync.${part}.synced.${identity}` : `sync.${part}.${status}`
}

/** The short status line ("Saved on this device"; "Saved as a guest" or "to your account"). */
export function syncStatusText(status: SyncStatus, identity: SyncIdentity = 'guest'): string {
  return copy(syncCopyKey('status', status, identity))
}

/** The panel's sentence on where the save stands. */
export function syncSheetText(status: SyncStatus, identity: SyncIdentity = 'guest'): string {
  return copy(syncCopyKey('sheet', status, identity))
}

/** The accessible name of the status chip and the More item. */
export function syncLabel(status: SyncStatus, identity: SyncIdentity = 'guest'): string {
  return copy('sync.label', { status: syncStatusText(status, identity) })
}

/** Statuses the player hears about when sync moves into or out of them (not routine saves). */
const NOTABLE: ReadonlySet<SyncStatus> = new Set([
  'offline',
  'paused',
  'conflict',
  'update',
  'behind',
  'signedOut',
])

/** True when a change from `from` to `to` is worth a polite announcement. */
export function announces(from: SyncStatus, to: SyncStatus): boolean {
  return from !== to && (NOTABLE.has(from) || NOTABLE.has(to))
}
