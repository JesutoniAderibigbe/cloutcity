import { copy } from '@/lib/copy'
import type { SyncStatus } from '@/state/syncStatus'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/sync'

/** The short status line ("Saved on this phone"). */
export function syncStatusText(status: SyncStatus): string {
  return copy(`sync.status.${status}`)
}

/** The accessible name of the status chip and the More item. */
export function syncLabel(status: SyncStatus): string {
  return copy('sync.label', { status: syncStatusText(status) })
}

/** Statuses the player hears about when sync moves into or out of them (not routine saves). */
const NOTABLE: ReadonlySet<SyncStatus> = new Set(['offline', 'paused', 'conflict', 'update'])

/** True when a change from `from` to `to` is worth a polite announcement. */
export function announces(from: SyncStatus, to: SyncStatus): boolean {
  return from !== to && (NOTABLE.has(from) || NOTABLE.has(to))
}
