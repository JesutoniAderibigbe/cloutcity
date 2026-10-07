import { copy } from '@/lib/copy'
import { formatCount } from '@/lib/format'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/hud'

export interface CloutMeterProps {
  /** The current level's display name ("Local"). */
  readonly levelName: string
  /**
   * The clout counted toward the next level: the player's total, or their earned (goal) clout
   * on the way to Icon once the total alone would hold it (src/engine/clout.ts `cloutProgress`).
   */
  readonly total: number
  /** The next level's name and threshold, or null at the top level. */
  readonly next: { readonly name: string; readonly minClout: number } | null
  /** Whole percent of the way to the next level, 0..100. */
  readonly pct: number
  readonly atMax: boolean
}

/**
 * The player's clout level and progress to the next level (S13). Purely presentational: the
 * level name, a native <progress> whose accessible name says it all ("Clout: Local, 140 of 300
 * to Scene Regular"), and the numbers, on one line under the HUD's goal line (S05). At the top
 * level the bar stays full.
 */
export function CloutMeter({ levelName, total, next, pct, atMax }: CloutMeterProps) {
  const count = formatCount(total)
  const target = atMax || next === null ? null : formatCount(next.minClout)
  const label =
    target === null || next === null
      ? copy('hud.clout.maxLabel', { level: levelName, count })
      : copy('hud.clout.progressLabel', { level: levelName, count, target, next: next.name })

  return (
    <div
      data-clout-meter=""
      data-cc-feature="cc-feature:clout-hud"
      className="flex min-w-0 items-center gap-1.5"
    >
      {/* One line under the goal line (S05): level, bar, numbers. The bar's accessible name
          says it all, so the visible text is hidden from screen readers. */}
      <span
        aria-hidden="true"
        className="max-w-[45%] shrink-0 truncate text-[11px] leading-none font-bold text-taxi-400"
      >
        {levelName}
      </span>
      <progress
        aria-label={label}
        max={100}
        value={atMax ? 100 : pct}
        className="h-1.5 min-w-6 flex-1 appearance-none overflow-hidden rounded-full bg-night-950 [&::-moz-progress-bar]:bg-pink-400 [&::-webkit-progress-bar]:bg-night-950 [&::-webkit-progress-value]:bg-pink-400"
      />
      <span aria-hidden="true" className="shrink-0 text-[11px] leading-none text-ink-300">
        {target === null
          ? copy('hud.clout.max', { count })
          : copy('hud.clout.progress', { count, target })}
      </span>
    </div>
  )
}
