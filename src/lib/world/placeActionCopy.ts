/**
 * Player-facing text for the location action sheet (S09), built from what
 * src/engine/placeActions.ts reports, through the copy layer and the shared formatters.
 * Buttons stay plain ("Coffee: 15 min, $5"); flavour (the club door, results) uses the active
 * slang pack. Memorial copy is base-only and plain (src/lib/world/placeActions-content.test.ts).
 */
import { effectiveDuration } from '@/engine/actions'
import { engineConfig, type EngineConfig } from '@/engine/config'
import type { GameSnapshot } from '@/engine/game'
import type {
  PlaceAction,
  PlaceActionBlock,
  PlaceActionResult,
  PlaceHoursNow,
} from '@/engine/placeActions'
import { copy as activeCopy, isCopyKey, type CopyFn, type CopyKey } from '@/lib/copy'
import { cloutLevelName, jobLockedLabel, jobName } from '@/lib/economyCopy'
import { formatCount, formatMoney } from '@/lib/format'
import { boroughClosedReason, placeName, type MapPlace } from './places'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/club'
import '@/lib/copy/ns/place'

export interface PlaceActionCopyOptions {
  readonly copy?: CopyFn
  readonly config?: EngineConfig
}

type PlaceRef = Pick<MapPlace, 'id' | 'nameKey' | 'borough'>

const MINUTES_PER_HOUR = 60

function requireKey(key: string, what: string): CopyKey {
  if (!isCopyKey(key)) throw new Error(`No copy key "${key}" for ${what}`)
  return key
}

/** `street-meal` → `streetMeal`, the copy-key segment for a kebab-case id. */
function camelSegment(id: string): string {
  return id.replace(/-([a-z0-9])/g, (_, next: string) => next.toUpperCase())
}

/** Game minutes as "20 min", "4 h" or "1 h 30 min". */
export function formatDuration(
  minutes: number,
  { copy = activeCopy }: PlaceActionCopyOptions = {},
) {
  if (minutes < MINUTES_PER_HOUR)
    return copy('place.duration.minutes', { count: formatCount(minutes) })
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)
  const rest = minutes - hours * MINUTES_PER_HOUR
  return rest === 0
    ? copy('place.duration.hours', { count: formatCount(hours) })
    : copy('place.duration.hoursMinutes', {
        hours: formatCount(hours),
        minutes: formatCount(rest),
      })
}

/** The action's name: "Coffee", "Work a Barista shift", "Go in", "Visit", "Flex". */
export function placeActionName(action: PlaceAction, options: PlaceActionCopyOptions = {}) {
  const { copy = activeCopy } = options
  switch (action.kind) {
    case 'shift':
      return copy('place.actions.shift.name', { job: jobName(action.jobId, options) })
    case 'club-night':
      return copy('place.actions.clubNight.name')
    case 'visit':
      return copy('place.actions.visit.name')
    case 'flex':
      return copy('clout.flex.name')
    case 'consume':
      return copy(
        requireKey(`place.actions.${camelSegment(action.id)}.name`, `action ${action.id}`),
      )
  }
}

/** Positive outcomes, in order: pay, stat gains, clout ("$56 pay", "+10 mood", "+10 clout"). */
function gains(
  action: PlaceAction,
  cloutGained: number,
  { copy = activeCopy }: PlaceActionCopyOptions,
): string[] {
  const parts: string[] = []
  if (action.kind === 'shift')
    parts.push(copy('place.effect.pay', { pay: formatMoney(action.wage) }))
  const { energy = 0, hunger = 0, mood = 0 } = action.def.statEffects
  if (energy > 0) parts.push(copy('place.effect.energy', { count: formatCount(energy) }))
  if (hunger > 0) parts.push(copy('place.effect.hunger', { count: formatCount(hunger) }))
  if (mood > 0) parts.push(copy('place.effect.mood', { count: formatCount(mood) }))
  if (cloutGained > 0) parts.push(copy('place.effect.clout', { count: formatCount(cloutGained) }))
  return parts
}

/** Duration (with any tiredness slowdown), cost and what it gives: "15 min, $5, +10 energy". */
export function placeActionDetails(
  action: PlaceAction,
  snapshot: GameSnapshot,
  options: PlaceActionCopyOptions = {},
): string {
  const { copy = activeCopy, config = engineConfig } = options
  if (action.kind === 'flex') {
    return copy('clout.flex.details', {
      duration: formatDuration(effectiveDuration(action.def, snapshot, config), options),
      energy: formatCount(action.def.energyCost),
      count: formatCount(action.cloutGain),
    })
  }
  const cost =
    action.kind === 'club-night'
      ? copy('place.cost.cover', { price: formatMoney(action.coverCharge) })
      : action.def.cashCost > 0
        ? formatMoney(action.def.cashCost)
        : copy('place.cost.free')
  const clout = action.kind === 'club-night' ? action.cloutGain : 0
  return [
    formatDuration(effectiveDuration(action.def, snapshot, config), options),
    cost,
    ...gains(action, clout, options),
    ...(action.kind === 'club-night' && action.cloutEarnedTonight
      ? [copy('place.effect.cloutEarnedTonight')]
      : []),
  ].join(', ')
}

/** Why an action cannot be done, in voice where it is flavour (the club door). */
export function placeBlockReason(
  block: PlaceActionBlock,
  place: PlaceRef,
  options: PlaceActionCopyOptions = {},
): string {
  const { copy = activeCopy } = options
  switch (block.code) {
    case 'borough-locked':
      // An open borough never blocks, but if the access ever disagrees, say something plain.
      return (
        boroughClosedReason(place.borough, block.access, options) ??
        copy('place.blocked.boroughLocked')
      )
    case 'closed':
      return copy('place.hours.closed', { time: block.opensAt })
    case 'door':
      return copy(requireKey(block.refusalKey, `club door ${place.id}`), {
        level: cloutLevelName(block.requiredLevel, options),
        current: cloutLevelName(block.currentLevel, options),
      })
    case 'job-locked':
      return jobLockedLabel(block.lock, options)
    case 'flexed-here-today':
      return copy('clout.flex.blocked.here')
    case 'flex-daily-limit':
      return copy('clout.flex.blocked.daily', { count: formatCount(block.max) })
    case 'funds':
      return copy('place.blocked.funds', {
        required: formatMoney(block.required),
        available: formatMoney(block.available),
      })
    case 'energy':
      return copy('place.blocked.energy', {
        required: formatCount(block.required),
        available: formatCount(block.available),
      })
  }
}

/** The accessible name of an action button: its label, plus why it is blocked when it is. */
export function placeActionAccessibleName(
  action: PlaceAction,
  place: PlaceRef,
  snapshot: GameSnapshot,
  options: PlaceActionCopyOptions = {},
): string {
  const { copy = activeCopy } = options
  const label = copy('place.action.label', {
    name: placeActionName(action, options),
    details: placeActionDetails(action, snapshot, options),
  })
  return action.block === null
    ? label
    : copy('place.action.blockedLabel', {
        action: label,
        reason: placeBlockReason(action.block, place, options),
      })
}

/** "Open 24 hours", "Open until 19:00" or "Closed. Opens at 22:00." on the personal clock. */
export function placeHoursLine(
  hours: PlaceHoursNow,
  { copy = activeCopy }: PlaceActionCopyOptions = {},
) {
  switch (hours.status) {
    case 'always':
      return copy('place.hours.always')
    case 'open':
      return copy('place.hours.open', { time: hours.closesAt })
    case 'closed':
      return copy('place.hours.closed', { time: hours.opensAt })
  }
}

/** What a finished action did, for the sheet's status line. */
export function placeActionDone(
  result: Extract<PlaceActionResult, { ok: true }>,
  place: PlaceRef,
  options: PlaceActionCopyOptions = {},
): string {
  const { copy = activeCopy } = options
  const effects = gains(result.action, result.cloutGained, options).join(', ')
  switch (result.action.kind) {
    case 'shift':
      return copy('jobs.shift.done', { pay: formatMoney(result.wage) })
    case 'club-night':
      return result.action.cloutEarnedTonight
        ? copy('place.done.clubNightRepeat', { effects })
        : copy('place.done.clubNight', { effects })
    case 'visit':
      return copy('place.done.visit', { place: placeName(place, options), effects })
    case 'flex': {
      const count = formatCount(result.cloutGained)
      return result.flex?.viral === true
        ? copy('clout.flex.viral', { count })
        : copy('clout.flex.normal', { place: placeName(place, options), count })
    }
    case 'consume':
      return copy('place.done.consume', { effects })
  }
}
