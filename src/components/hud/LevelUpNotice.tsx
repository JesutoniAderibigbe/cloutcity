'use client'

import type { LevelUp } from '@/engine/clout'
import { copy } from '@/lib/copy'
import { levelUpCloseLabel, levelUpMessage, levelUpTitle, levelUpUnlocked } from '@/lib/levelUpCopy'
import { gameStore } from '@/state/store'
import { useToastTimer } from './LevelUpToast'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/clout'

/**
 * The level-up toast (S13), in the overlay toast zone, whose live region announces it. It
 * never takes focus (play carries on under it), closes itself after `overlay.toastMs`, and has
 * a Close button, with the pause rules of {@link useToastTimer}. Its one pop animation is off
 * under reduced motion (globals.css).
 */
export function LevelUpNotice({ levelUp }: { readonly levelUp: LevelUp }) {
  const { ref, paused } = useToastTimer(() => gameStore.getState().dismissLevelUp())

  const unlocked = levelUpUnlocked(levelUp)
  return (
    <div
      ref={ref}
      data-level-up={levelUp.to}
      data-cc-feature="cc-feature:level-up"
      data-cc-notice="level-up"
      data-paused={paused ? '' : undefined}
      className="level-up-pop mx-2 flex items-center gap-2 rounded-2xl border border-taxi glass px-3 py-1 shadow-lg"
    >
      {/* Title and message share one flow so the longest level-up (every unlock on the way to
          Icon) still fits the 72 px toast zone at 390 px (UX-1). */}
      <div className="min-w-0 flex-1 text-xs leading-tight">
        <p>
          <strong className="font-extrabold text-taxi-ink">{levelUpTitle(levelUp)}</strong>{' '}
          <span className="text-fg">{levelUpMessage(levelUp)}</span>
        </p>
        {unlocked === null ? null : <p className="text-taxi-ink">{unlocked}</p>}
      </div>
      <button
        type="button"
        onClick={() => gameStore.getState().dismissLevelUp()}
        aria-label={levelUpCloseLabel(levelUp)}
        className="min-h-11 min-w-11 shrink-0 rounded-xl bg-raised px-3 text-sm font-semibold text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {copy('clout.levelUp.close')}
      </button>
    </div>
  )
}
