'use client'

import { PANEL_BUTTON, PanelDialog } from '@/components/hud/PanelDialog'
import { copy } from '@/lib/copy'
import { closeHudPanel } from '@/state/hudPanel'
import { useSyncStatus } from '@/state/syncStatus'
import { syncStatusText } from './syncCopy'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/sync'

/**
 * The cloud save panel (S18c), opened from the status chip or the More panel: where the save
 * stands, in a sentence. In a conflict the player keeps this phone's progress or takes the
 * account's; while sync is paused or offline they can try again now. The controls come from the
 * running sync (src/state/cloudSync.ts); without a session there is nothing to press.
 */
export function CloudSavePanel() {
  const { status, controls } = useSyncStatus()
  const act = (run: () => void) => () => {
    run()
    closeHudPanel()
  }
  return (
    <PanelDialog
      title={copy('sync.sheet.title')}
      panel="cloud"
      feature="cc-feature:cloud-save-panel"
      onClose={closeHudPanel}
    >
      <p data-sync-status-line="" className="text-sm font-semibold text-taxi-400">
        {syncStatusText(status)}
      </p>
      <p className="text-sm text-ink-50">{copy(`sync.sheet.${status}`)}</p>
      {controls !== null && status === 'conflict' ? (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            data-sync-choice="keep-local"
            onClick={act(() => controls.resolveConflict('keep-local'))}
            className={`${PANEL_BUTTON} bg-pink-400 text-night-950`}
          >
            {copy('sync.sheet.keepLocal')}
          </button>
          <button
            type="button"
            data-sync-choice="use-cloud"
            onClick={act(() => controls.resolveConflict('use-cloud'))}
            className={`${PANEL_BUTTON} bg-night-800 text-ink-50`}
          >
            {copy('sync.sheet.useCloud')}
          </button>
        </div>
      ) : null}
      {controls !== null && (status === 'paused' || status === 'offline') ? (
        <button
          type="button"
          data-sync-retry=""
          onClick={act(controls.retryNow)}
          className={`${PANEL_BUTTON} bg-night-800 text-ink-50`}
        >
          {copy('sync.sheet.retry')}
        </button>
      ) : null}
    </PanelDialog>
  )
}
