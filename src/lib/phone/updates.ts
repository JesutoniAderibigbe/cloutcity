/**
 * The Updates inbox (S58, S47 lite): one list of what the game already tells the player in other
 * places, read from the save as it is now, never invented (UX-3):
 * - goals reached and not yet claimed (the Goals panel's own rule);
 * - back rent owed, the next rent due and the last rent notice this session;
 * - the "Make it you" offer while the look is unfinished;
 * - the city events that fired lately (the event log keeps when each last fired).
 *
 * `needsYou` items are the ones the player can act on; only they count toward the badge, which
 * stays capped (GR-21). Pure: the caller passes the state and the config.
 */
import type { EngineConfig } from '@/engine/config'
import type { CreatorState } from '@/engine/creator'
import type { EventsState } from '@/engine/events'
import { goalsView } from '@/engine/goals'
import type { GrantSnapshot } from '@/engine/grants'
import { nextRentDueDay, type RentEvent } from '@/engine/rent'

export type UpdateItem =
  | { readonly kind: 'goal'; readonly goalId: string }
  | { readonly kind: 'rent-owed'; readonly owed: number }
  | { readonly kind: 'creator' }
  | { readonly kind: 'rent-notice'; readonly event: RentEvent }
  | { readonly kind: 'rent-due'; readonly day: number }
  | { readonly kind: 'event'; readonly eventId: string; readonly at: number }

export interface UpdatesInput {
  readonly save: GrantSnapshot & {
    readonly creator: CreatorState
    readonly events: EventsState
  }
  readonly lastRentEvent: RentEvent | null
  readonly maxEvents: number
}

export interface Updates {
  readonly needsYou: readonly UpdateItem[]
  readonly recent: readonly UpdateItem[]
}

export function phoneUpdates(input: UpdatesInput, config: EngineConfig): Updates {
  const { save, lastRentEvent, maxEvents } = input
  const needsYou: UpdateItem[] = goalsView(save, config)
    .filter((goal) => goal.claimable)
    .map((goal) => ({ kind: 'goal', goalId: goal.id }))
  if (save.player.rent.owed > 0) needsYou.push({ kind: 'rent-owed', owed: save.player.rent.owed })
  const { creator } = save
  const offerOpen = creator.offeredAt !== null && creator.completedAt === null
  if (offerOpen && creator.dismissedAt === null) needsYou.push({ kind: 'creator' })

  const recent: UpdateItem[] = []
  if (lastRentEvent !== null) recent.push({ kind: 'rent-notice', event: lastRentEvent })
  recent.push({ kind: 'rent-due', day: nextRentDueDay(save.clock.minute, config) })
  if (offerOpen && creator.dismissedAt !== null) recent.push({ kind: 'creator' })
  const known = new Set(config.events.catalog.map((event) => event.id))
  const events = Object.entries(save.events.history)
    .filter(([id]) => known.has(id))
    .sort(([a, atA], [b, atB]) => atB - atA || a.localeCompare(b))
    .slice(0, maxEvents)
  for (const [eventId, at] of events) recent.push({ kind: 'event', eventId, at })
  return { needsYou, recent }
}
