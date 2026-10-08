/**
 * Place facts the phone shows (S58): a place's opening hours now, an action's name and a length
 * of game time, in the place sheet's own words (the `place` copy namespace). Written apart from
 * src/lib/world/placeActionCopy.ts on purpose: importing that module from the phone's chunks
 * made the bundler re-split the place sheet's chunks into new precached ones (about 10 KB gz on
 * install, PERF-7), and the phone needs only these three lines of it.
 */
import type { PlaceHoursNow } from '@/engine/placeActions'
import { copy, isCopyKey } from '@/lib/copy'
import { formatCount } from '@/lib/format'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/place'

const MINUTES_PER_HOUR = 60

/** Game minutes as "20 min", "4 h" or "1 h 30 min". */
export function durationText(minutes: number): string {
  if (minutes < MINUTES_PER_HOUR) {
    return copy('place.duration.minutes', { count: formatCount(minutes) })
  }
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)
  const rest = minutes - hours * MINUTES_PER_HOUR
  return rest === 0
    ? copy('place.duration.hours', { count: formatCount(hours) })
    : copy('place.duration.hoursMinutes', {
        hours: formatCount(hours),
        minutes: formatCount(rest),
      })
}

/** "Open 24 hours", "Open until 19:00" or "Closed. Opens at 22:00." on the personal clock. */
export function hoursText(hours: PlaceHoursNow): string {
  switch (hours.status) {
    case 'always':
      return copy('place.hours.always')
    case 'open':
      return copy('place.hours.open', { time: hours.closesAt })
    case 'closed':
      return copy('place.hours.closed', { time: hours.opensAt })
  }
}

/** A catalog or place action's name ("Coffee"), as its place sheet button says it. */
export function actionName(actionId: string): string {
  const key = `place.actions.${actionId.replace(/-([a-z0-9])/g, (_, next: string) => next.toUpperCase())}.name`
  if (!isCopyKey(key)) throw new Error(`No copy key "${key}" for action ${actionId}`)
  return copy(key)
}
