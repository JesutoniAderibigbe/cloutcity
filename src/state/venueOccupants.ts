/**
 * Real players inside a venue (S43): the seam the shared-city presence (S42) feeds and the venue
 * interior (src/scene/venue) draws. Session-only and tiny, like apartmentView.ts: presence calls
 * `setInteriorOccupants` with the players its server-authored snapshot puts at a venue (already
 * without blocked, muted or ghosted players, and never padded), and the interior draws each one
 * with their avatar and handle at a spot for their activity. Until presence feeds it, every venue
 * has none, and the interior shows only its locals (who are never counted as players, UX-3).
 *
 * A tap on an occupant's name tag reports them through `onOccupantPicked`, so the player card
 * (with block, mute and report) can open from the interior like from every player surface.
 */
import { useSyncExternalStore } from 'react'
import { createStore } from 'zustand/vanilla'
import type { PublicAvatar } from '@/engine/appearance'

/**
 * What a player is doing inside: the interior puts them at a spot for it (the dance floor, the
 * bar, a booth). Unknown activities stand wherever there is room.
 */
export type InteriorActivity = 'dance' | 'bar' | 'booth' | 'chat' | 'lounge' | 'idle'

export interface InteriorOccupant {
  /** The player's opaque id (never shown). */
  readonly id: string
  /** Their server-accepted handle, shown on the name tag. */
  readonly handle: string
  /** Their server-validated avatar. */
  readonly avatar: PublicAvatar
  readonly activity: InteriorActivity
}

interface OccupantsState {
  readonly byPlace: Readonly<Record<string, readonly InteriorOccupant[]>>
}

const EMPTY: readonly InteriorOccupant[] = []

export const venueOccupantsStore = createStore<OccupantsState>()(() => ({ byPlace: {} }))

/** The players presence puts inside `placeId` now (empty when none, or before presence runs). */
export function interiorOccupants(placeId: string): readonly InteriorOccupant[] {
  return venueOccupantsStore.getState().byPlace[placeId] ?? EMPTY
}

/** Presence's side: replaces who is inside `placeId` (an empty list clears it). */
export function setInteriorOccupants(
  placeId: string,
  occupants: readonly InteriorOccupant[],
): void {
  venueOccupantsStore.setState((state) => {
    const byPlace = { ...state.byPlace }
    if (occupants.length === 0) delete byPlace[placeId]
    else byPlace[placeId] = [...occupants]
    return { byPlace }
  })
}

/** Who is inside `placeId`, re-rendering when presence changes it. */
export function useInteriorOccupants(placeId: string): readonly InteriorOccupant[] {
  return useSyncExternalStore(
    venueOccupantsStore.subscribe,
    () => interiorOccupants(placeId),
    () => EMPTY,
  )
}

const pickListeners = new Set<(placeId: string, occupantId: string) => void>()

/** The interior reports a tap on an occupant's name tag. */
export function pickOccupant(placeId: string, occupantId: string): void {
  for (const listener of [...pickListeners]) listener(placeId, occupantId)
}

/** Listens for taps on occupants' name tags (the player card opens); returns unsubscribe. */
export function onOccupantPicked(
  listener: (placeId: string, occupantId: string) => void,
): () => void {
  pickListeners.add(listener)
  return () => {
    pickListeners.delete(listener)
  }
}
