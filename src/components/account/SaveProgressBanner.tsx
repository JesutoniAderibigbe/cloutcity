'use client'

import { useStore } from 'zustand'
import { useModalOpen } from '@/components/overlay/modalState'
import { copy } from '@/lib/copy'
import { accountStore, savePromptDue } from '@/state/account'
import { openAccountSheet } from '@/state/accountSheet'
import { guestSessionStore } from '@/state/guestSession'
import { useHudPanel } from '@/state/hudPanel'
import { useGameStore } from '@/state/store'
import { tourStore } from '@/state/tour'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/account'

const BUTTON =
  'min-h-11 shrink-0 rounded-xl px-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'

/**
 * The save-progress prompt (S19, CLAUDE.md principle 1, GR-4): a banner, once the guest has
 * reached their first milestone, with the warning that clearing browser data loses a guest game.
 * "Create account" opens the save sheet; "Not now" hides it for good (the Me tab and the
 * level-up nudge still offer saving). Never over the tour, a modal or the account sheet itself.
 */
export function SaveProgressBanner() {
  const goals = useGameStore((state) => state.goals)
  const prestige = useGameStore((state) => state.prestige)
  const status = useStore(guestSessionStore, (state) => state.status)
  const dismissed = useStore(accountStore, (state) => state.promptDismissed)
  const pendingAt = useStore(accountStore, (state) => state.pendingUpgradeAt)
  const touring = useStore(tourStore, (state) => state.record?.status === 'active')
  const modalOpen = useModalOpen()
  const panel = useHudPanel()

  const due = savePromptDue({
    save: { goals, prestige },
    session: { status },
    dismissed,
    tourActive: touring,
    // The coordinator forgets a link that ran out (src/lib/supabase/accountSession.ts).
    pending: pendingAt !== null,
  })
  if (!due || modalOpen || panel === 'account') return null

  return (
    <div
      data-cc-notice="save-progress"
      data-cc-feature="cc-feature:save-progress"
      role="status"
      className="mx-2 flex h-full items-center gap-2 rounded-2xl border border-taxi glass px-3 text-fg shadow-lg"
    >
      <p className="line-clamp-3 min-w-0 flex-1 text-xs leading-tight">
        {copy('account.banner.text')}
      </p>
      <button
        type="button"
        data-save-progress-create=""
        onClick={() => openAccountSheet('save')}
        className={`${BUTTON} bg-taxi text-sm text-on-taxi`}
      >
        {copy('account.banner.save')}
      </button>
      <button
        type="button"
        data-save-progress-later=""
        aria-label={copy('account.banner.laterLabel')}
        title={copy('account.banner.later')}
        onClick={() => accountStore.getState().dismissPrompt()}
        className={`${BUTTON} min-w-11 bg-raised text-fg`}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="mx-auto h-4 w-4 fill-current">
          <path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4z" />
        </svg>
      </button>
    </div>
  )
}
