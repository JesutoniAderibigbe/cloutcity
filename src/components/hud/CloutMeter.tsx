import { copy } from '@/lib/copy'
import { formatCount } from '@/lib/format'

export interface CloutMeterProps {
  /** The current level's display name ("Local"). */
  readonly levelName: string
  /** The player's total clout. */
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
 * to Scene Regular"), and the numbers. At the top level the bar stays full.
 */
export function CloutMeter({ levelName, total, next, pct, atMax }: CloutMeterProps) {
  const count = formatCount(total)
  const target = atMax || next === null ? null : formatCount(next.minClout)
  const label =
    target === null || next === null
      ? copy('hud.clout.maxLabel', { level: levelName, count })
      : copy('hud.clout.progressLabel', { level: levelName, count, target, next: next.name })

  return (
    <div data-clout-meter="" className="flex min-w-0 shrink-0 flex-col items-end gap-1">
      <p aria-hidden="true" className="flex gap-1.5 text-xs leading-none font-bold">
        <span className="text-ink-300">{copy('hud.clout.label')}</span>
        <span className="text-taxi-400">{levelName}</span>
      </p>
      <progress
        aria-label={label}
        max={100}
        value={atMax ? 100 : pct}
        className="h-2 w-28 appearance-none overflow-hidden rounded-full bg-night-800 [&::-moz-progress-bar]:bg-pink-400 [&::-webkit-progress-bar]:bg-night-800 [&::-webkit-progress-value]:bg-pink-400"
      />
      <p aria-hidden="true" className="text-[11px] leading-none text-ink-300">
        {target === null
          ? copy('hud.clout.max', { count })
          : copy('hud.clout.progress', { count, target })}
      </p>
    </div>
  )
}
