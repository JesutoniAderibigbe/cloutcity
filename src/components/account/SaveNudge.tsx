'use client'

import { copy } from '@/lib/copy'
import { openAccountSheet } from '@/state/accountSheet'
import { gameStore } from '@/state/store'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/account'

/**
 * The level-up nudge (S19, GR-4): on every level-up a guest gets a Save button in the toast,
 * until they have saved their progress. Its accessible name carries the warning; it fits the
 * 72 px toast zone beside Close at 390 px (UX-1).
 */
export function SaveNudge() {
  return (
    <button
      type="button"
      data-save-nudge=""
      aria-label={copy('account.nudge.label')}
      onClick={() => {
        gameStore.getState().dismissLevelUp()
        openAccountSheet('save')
      }}
      className="min-h-11 min-w-11 shrink-0 rounded-xl bg-taxi px-3 text-sm font-semibold text-on-taxi focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {copy('account.nudge.save')}
    </button>
  )
}
