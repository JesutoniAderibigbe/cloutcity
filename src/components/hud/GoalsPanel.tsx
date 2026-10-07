'use client'

import { useEffect, useMemo, useState } from 'react'
import { useActionGuard } from '@/components/overlay/useActionGuard'
import { engineConfig } from '@/engine/config'
import { goalsView, type GoalView } from '@/engine/goals'
import { copy } from '@/lib/copy'
import { formatCount } from '@/lib/format'
import {
  badgeName,
  claimButton,
  claimedText,
  goalHint,
  goalName,
  goalProgressLabel,
  goalStatusText,
  rewardLine,
} from '@/lib/goalsCopy'
import { log } from '@/lib/log'
import { closeHudPanel } from '@/state/hudPanel'
import { gameStore, useGameStore } from '@/state/store'
import { PANEL_BUTTON, PanelDialog, PanelStatus } from './PanelDialog'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/goals'

const STATUS_CLASS: Readonly<Record<GoalView['status'], string>> = {
  'coming-soon': 'text-ink-300',
  'in-progress': 'text-ink-300',
  done: 'text-taxi-400',
  claimed: 'text-pink-400',
}

/**
 * The Goals panel (S15), opened from the HUD: every goal with its progress, its reward and a
 * Claim button. Amounts are the grant function's own preview (capped), so the button names
 * exactly what lands; a reward the cap holds back says so. A Claim that cannot be used now stays
 * focusable (`aria-disabled`) and its accessible name says why. Granted clout never counts
 * toward a goal, and the panel says so. Loaded lazily by HudPanelMount (DEC-11).
 */
export function GoalsPanel() {
  const clock = useGameStore((state) => state.clock)
  const player = useGameStore((state) => state.player)
  const goals = useGameStore((state) => state.goals)
  const grants = useGameStore((state) => state.grants)
  const prestige = useGameStore((state) => state.prestige)
  const events = useGameStore((state) => state.events)
  const views = useMemo(
    () => goalsView({ clock, player, goals, grants, prestige, events }, engineConfig),
    [clock, player, goals, grants, prestige, events],
  )
  // The nonce re-runs the focus check for every claim, even when two results read the same.
  const [result, setResult] = useState<{ readonly text: string; readonly nonce: number } | null>(
    null,
  )
  const { guard: act, onKeyDown, coolingDown } = useActionGuard()

  // A claim replaces its button with the claimed status, which would drop focus on the body;
  // keep it in the panel instead.
  useEffect(() => {
    const dialog = document.querySelector<HTMLElement>('[data-hud-panel-dialog="goals"]')
    if (result === null || dialog === null || dialog.contains(document.activeElement)) return
    dialog.querySelector<HTMLElement>('h2')?.focus()
  }, [result])

  const claim = (view: GoalView) => {
    if (!view.claimable) return
    const outcome = gameStore.getState().claimGoalReward(view.id)
    const text = outcome.ok
      ? claimedText(view.id, outcome.record.applied)
      : copy('goals.claim.refused')
    // The panel only offers what the engine allows, so a refusal means the state moved under it.
    if (!outcome.ok)
      log.info('A goal reward claim was refused', { goalId: view.id, code: outcome.error.code })
    setResult((last) => ({ text, nonce: (last?.nonce ?? 0) + 1 }))
  }

  return (
    <PanelDialog
      title={copy('goals.heading')}
      panel="goals"
      feature="cc-feature:goals-panel"
      onClose={closeHudPanel}
      scrollBody
    >
      <p className="text-sm text-ink-50">{copy('goals.intro')}</p>
      <p data-goals-note="" className="text-xs text-ink-300">
        {copy('goals.note')}
      </p>
      {prestige.badges.length === 0 ? null : (
        <section aria-label={copy('goals.badges.heading')} className="flex flex-col gap-1">
          <h3 className="text-xs font-bold text-ink-300 uppercase">
            {copy('goals.badges.heading')}{' '}
            <span className="font-semibold normal-case">
              {copy('goals.run', { run: formatCount(goals.run) })}
            </span>
          </h3>
          <ul className="flex flex-wrap gap-1.5">
            {prestige.badges.map((badge) => (
              <li
                key={badge}
                data-badge={badge}
                className="rounded-full bg-pink-400 px-2 py-0.5 text-xs font-bold text-night-950"
              >
                {badgeName(badge)}
              </li>
            ))}
          </ul>
        </section>
      )}
      <ul aria-busy={coolingDown} className="flex flex-col gap-1.5">
        {views.map((view) => {
          const button = claimButton(view)
          return (
            <li
              key={view.id}
              data-goal={view.id}
              data-goal-status={view.status}
              className="flex flex-col gap-1 rounded-xl bg-night-950/60 p-2"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold text-ink-50">{goalName(view.id)}</p>
                <span className={`shrink-0 text-xs font-bold ${STATUS_CLASS[view.status]}`}>
                  {goalStatusText(view)}
                </span>
              </div>
              <p className="text-xs text-ink-300">{goalHint(view.id)}</p>
              <progress
                aria-label={goalProgressLabel(view)}
                max={view.progress.target}
                value={view.progress.current}
                className="h-2 w-full appearance-none overflow-hidden rounded-full bg-night-800 [&::-moz-progress-bar]:bg-pink-400 [&::-webkit-progress-bar]:bg-night-800 [&::-webkit-progress-value]:bg-pink-400"
              />
              <p className="text-xs text-ink-50">{rewardLine(view)}</p>
              {view.capped && view.status === 'done' ? (
                <p data-goal-capped="" className="text-xs text-taxi-400">
                  {copy('goals.capped')}
                </p>
              ) : null}
              {view.status === 'done' || view.status === 'in-progress' ? (
                <button
                  type="button"
                  aria-disabled={view.claimable ? undefined : true}
                  aria-label={button.label}
                  onKeyDown={onKeyDown}
                  onClick={(event) => act(event, view.id, () => claim(view))}
                  className={`${PANEL_BUTTON} self-start text-sm ${
                    view.claimable
                      ? 'bg-pink-400 text-night-950'
                      : 'cursor-not-allowed bg-night-800 text-ink-300'
                  }`}
                >
                  {button.text}
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
      <PanelStatus text={result?.text ?? null} />
    </PanelDialog>
  )
}
