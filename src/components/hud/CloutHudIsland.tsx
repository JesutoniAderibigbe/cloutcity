'use client'

import { useEffect, useMemo } from 'react'
import { cloutProgress } from '@/engine/clout'
import { engineConfig } from '@/engine/config'
import { claimableCount } from '@/engine/goals'
import { copy } from '@/lib/copy'
import { cloutLevelName } from '@/lib/economyCopy'
import { formatCount } from '@/lib/format'
import { closeHudPanel, openHudPanel, useHudPanel } from '@/state/hudPanel'
import { setIconMomentPending } from '@/state/iconMoment'
import { useGameStore } from '@/state/store'
import { CloutMeter } from './CloutMeter'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/hud'

/** A trophy (24×24, stroked). */
const TROPHY_ICON =
  'M8 4h8v5a4 4 0 0 1-8 0V4Zm0 2H5a3 3 0 0 0 3 4m8-4h3a3 3 0 0 1-3 4m-4 3v4m-3 3h6'

/**
 * The store-backed adapter for the HUD's clout meter: the engine's `cloutProgress` turned into
 * CloutMeter's props, and the Goals button beside it (S15). Loaded lazily by CloutHudMount
 * (DEC-11), so the store and engine stay out of the shell. It also tells the shell's Icon
 * moment mount when the moment is due (src/state/iconMoment.ts).
 */
export function CloutHudIsland() {
  const player = useGameStore((state) => state.player)
  const progress = useMemo(() => cloutProgress(player, engineConfig), [player])
  const { next } = progress
  const icon = useGameStore((state) => state.goals.icon)

  useEffect(() => {
    setIconMomentPending(icon.reachedAt !== null && !icon.acknowledged)
  }, [icon])

  return (
    <div className="flex items-center gap-1.5">
      <CloutMeter
        levelName={cloutLevelName(progress.level.id)}
        total={progress.counted}
        next={next === null ? null : { name: cloutLevelName(next.id), minClout: next.minClout }}
        pct={progress.pct}
        atMax={progress.atMax}
      />
      <GoalsButton />
    </div>
  )
}

/**
 * Opens the Goals panel. Its accessible name counts the rewards ready to claim ("Goals, 2
 * rewards ready"); no toast ever announces one (GR-9). The HUD row is full at 390 px, so below
 * `sm` it is a 44 px trophy icon with the count as a badge; from `sm` up the label shows.
 */
function GoalsButton() {
  const open = useHudPanel()
  const clock = useGameStore((state) => state.clock)
  const player = useGameStore((state) => state.player)
  const goals = useGameStore((state) => state.goals)
  const grants = useGameStore((state) => state.grants)
  const prestige = useGameStore((state) => state.prestige)
  const events = useGameStore((state) => state.events)
  const ready = useMemo(
    () => claimableCount({ clock, player, goals, grants, prestige, events }, engineConfig),
    [clock, player, goals, grants, prestige, events],
  )
  const label =
    ready === 0
      ? copy('hud.goals')
      : ready === 1
        ? copy('hud.goalsReadyOne')
        : copy('hud.goalsReady', { count: formatCount(ready) })

  return (
    <button
      type="button"
      data-hud-panel="goals"
      data-goals-ready={ready}
      aria-expanded={open === 'goals'}
      aria-label={label}
      onClick={() => (open === 'goals' ? closeHudPanel() : openHudPanel('goals'))}
      className={`relative flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-taxi-400 sm:px-3 ${
        open === 'goals' ? 'bg-pink-400 text-night-950' : 'bg-night-800 text-ink-50'
      }`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-5 w-5 fill-none stroke-current stroke-2 sm:hidden"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={TROPHY_ICON} />
      </svg>
      <span aria-hidden="true" className="hidden sm:inline">
        {copy('hud.goals')}
      </span>
      {ready === 0 ? null : (
        <span
          aria-hidden="true"
          className="absolute -top-1 -right-1 min-w-4 rounded-full bg-taxi-400 px-1 text-center text-[10px] leading-4 font-bold text-night-950"
        >
          {formatCount(ready)}
        </span>
      )}
    </button>
  )
}
