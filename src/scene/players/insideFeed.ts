/**
 * Real players inside venues (S42c): presence's side of src/state/venueOccupants.ts. While the
 * player stands at a venue with an interior, every other signed-in player the server puts at the
 * same place goes inside it, with their own look, their handle on the name tag and a spot for
 * what they are doing:
 *
 * - the activity they announced (their last place action there, presenceRuntime.ts), else
 * - one their id picks from the interior's list (realtime.json `inside.byInterior`): the same
 *   player always does the same thing, and it suits the room (a club dances, a lounge lounges);
 *   an interior with no list (S43b's) stands them at any free standing spot (`idle`).
 *
 * Blocked, muted, banned, suspended and ghost players never reach the snapshot (the server), and
 * players blocked or muted on this device this session are left out at once. Nobody is padded in.
 * How many are drawn is the interior's per-tier cap (data/config/interiors.json
 * `occupants.max`, applied where it draws).
 */
import realtimeJson from '@data/config/realtime.json'
import typesJson from '@data/interiors/types.json'
import type { Look } from '@/engine/appearance'
import type { RealtimeConfig } from '@/lib/data/schemas/config'
import { presenceStore, visiblePlayers, type MapPlayer } from '@/state/presence'
import { tripStore } from '@/state/trip'
import {
  setInteriorOccupants,
  type InteriorActivity,
  type InteriorOccupant,
} from '@/state/venueOccupants'

const inside = (realtimeJson.presence as RealtimeConfig['presence']).inside
const byVenueType: Readonly<Record<string, string | undefined>> = typesJson.byVenueType
const byVenue: Readonly<Record<string, string | undefined>> = typesJson.byVenue

/**
 * The interior a place opens (data/interiors/types.json): its own when it has one (S43b: the
 * boxing gym, the warehouse), else its venue type's; or null.
 */
export function interiorOf(category: string | undefined, placeId?: string): string | null {
  const own = placeId === undefined ? undefined : byVenue[placeId]
  return own ?? (category === undefined ? null : (byVenueType[category] ?? null))
}

/** 32-bit FNV-1a: a stable pick from a player's opaque id. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** What `id` does inside `interiorId` when they announced nothing: the same every time. */
export function fallbackActivity(id: string, interiorId: string): InteriorActivity {
  const list = inside.byInterior[interiorId]
  if (list === undefined || list.length === 0) return 'idle'
  return list[hash(`${interiorId}:${id}`) % list.length] ?? 'idle'
}

/** The players at `placeId` as the interior draws them, in the server's order. */
export function occupantsAt(
  players: readonly MapPlayer[],
  placeId: string,
  interiorId: string,
): InteriorOccupant[] {
  return players
    .filter((player) => player.place === placeId)
    .map((player) => ({
      id: player.id,
      handle: player.handle,
      // Option ids as the server accepted them; the avatar repairs any it does not know, and a
      // player whose look has not synced yet is drawn in the default look.
      avatar: { look: (player.look ?? {}) as Look, worn: player.worn },
      activity: player.activity ?? fallbackActivity(player.id, interiorId),
    }))
}

/** The place the player stands at now (not travelling), or null. */
function placeNow(): string | null {
  const { active, spot } = tripStore.getState()
  return active === null && spot?.kind === 'place' ? spot.placeId : null
}

/**
 * Keeps the interior of the place the player stands at filled from presence; answers the stop
 * (which empties it). `categoryOf` maps each place pin id to its venue type or landmark category.
 */
export function startInsideFeed(categoryOf: ReadonlyMap<string, string>): () => void {
  let fed: string | null = null
  let lastKey = ''
  const sync = () => {
    const placeId = placeNow()
    const interiorId = placeId === null ? null : interiorOf(categoryOf.get(placeId), placeId)
    const target = interiorId === null ? null : placeId
    if (fed !== null && fed !== target) {
      setInteriorOccupants(fed, [])
      lastKey = ''
    }
    fed = target
    if (target === null || interiorId === null) return
    const occupants = occupantsAt(visiblePlayers(), target, interiorId)
    // Every read answers new objects: only a real change redraws the interior.
    const key = JSON.stringify(occupants)
    if (key === lastKey) return
    lastKey = key
    setInteriorOccupants(target, occupants)
  }
  sync()
  const offPresence = presenceStore.subscribe(sync)
  const offTrip = tripStore.subscribe(sync)
  return () => {
    offPresence()
    offTrip()
    if (fed !== null) setInteriorOccupants(fed, [])
    fed = null
  }
}
