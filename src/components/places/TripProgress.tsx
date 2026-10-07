'use client'

import { useEffect, useRef } from 'react'
import { copy } from '@/lib/copy'
import { formatCount } from '@/lib/format'
import { tripProgressText } from '@/lib/world/travelCopy'
import { useTripProgress, type ActiveTrip } from '@/state/trip'
import '@/lib/copy/ns/travel'

const PERCENT = 100

/**
 * The trip under way (S08 part 2), in the sheet zone while the avatar travels: where to, how,
 * a progress bar, and Skip. One compact row, so it fits the 90 px sheet zone of a short
 * landscape phone (UX-11). The trip is already in the save; Skip only ends the animation.
 */
export function TripProgress({ trip }: { readonly trip: ActiveTrip }) {
  const progress = useTripProgress()
  const text = tripProgressText(trip.destination, trip.mode)
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * PERCENT)
  const skipButton = useRef<HTMLButtonElement>(null)

  // Focus stays with the trip: the button the player pressed has gone with the sheet.
  useEffect(() => {
    skipButton.current?.focus()
  }, [trip.id])

  return (
    <div
      data-trip-progress={trip.mode}
      data-cc-feature="cc-feature:trip-progress"
      className="m-2 flex items-center gap-2 rounded-2xl border border-night-700 bg-night-900/95 p-2 shadow-lg"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm leading-tight font-extrabold text-ink-50">{text.title}</p>
        <p className="truncate text-xs text-ink-300">{text.mode}</p>
        <div
          role="progressbar"
          aria-label={copy('travel.progress.label')}
          aria-valuemin={0}
          aria-valuemax={PERCENT}
          aria-valuenow={percent}
          aria-valuetext={copy('travel.progress.value', { percent: formatCount(percent) })}
          className="mt-1 h-1.5 overflow-hidden rounded-full bg-night-800"
        >
          <div className="h-full bg-taxi-400" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <button
        ref={skipButton}
        type="button"
        data-trip-skip=""
        aria-label={copy('travel.skipLabel')}
        onClick={() => void import('@/state/tripDriver').then((module) => module.skipTrip())}
        className="min-h-11 min-w-11 shrink-0 rounded-xl bg-night-800 px-3 text-sm font-bold text-ink-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-taxi-400"
      >
        {copy('travel.skip')}
      </button>
    </div>
  )
}
