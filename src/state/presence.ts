/**
 * Real players on the map (S42 phase 1): the online count, who is drawn where, the player whose
 * card is open and the ones hidden on this device. Session-only, never persisted. The presence
 * chunk (src/scene/players/PlayersOverlay.tsx) writes it; the living city
 * (src/scene/ambient/AmbientLife.tsx) draws from it. Deliberately tiny: no Supabase, no three.
 *
 * Every number here comes from the server's presence rows (CLAUDE.md "never padded"): townsfolk
 * are never counted.
 */
import { useSyncExternalStore } from 'react'
import { createStore } from 'zustand/vanilla'
import type { CloutLevelId, LookIds, PresenceSnapshot, PublicSnapshot } from '@/realtime/types'

/** One real player drawn on the map. */
export interface MapPlayer {
  readonly id: string
  readonly place: string
  readonly look: LookIds | null
  readonly handle: string
  readonly level: CloutLevelId
}

/** What a player card shows: a signed-in view's player. */
export interface PlayerCard {
  readonly id: string
  readonly handle: string
  readonly level: CloutLevelId
  readonly look: LookIds | null
}

interface PresenceState {
  /** The online count, or null while unknown or after reads keep failing (the chip hides). */
  readonly online: number | null
  /** Players at places, as the server answered (hidden ones still listed; see `visiblePlayers`). */
  readonly players: readonly MapPlayer[]
  /** Players at home or travelling: counted, never drawn. */
  readonly elsewhere: number
  /** Blocked or muted on this device this session (the server hides them from the next read). */
  readonly hidden: ReadonlySet<string>
  readonly selected: PlayerCard | null
}

const INITIAL: PresenceState = {
  online: null,
  players: [],
  elsewhere: 0,
  hidden: new Set(),
  selected: null,
}

export const presenceStore = createStore<PresenceState>()(() => INITIAL)

/** A signed-in read: identified players. */
export function applySnapshot(snapshot: PresenceSnapshot): void {
  const players: MapPlayer[] = []
  let elsewhere = 0
  for (const p of snapshot.players) {
    if (p.spot !== 'place' || p.place === null) {
      elsewhere++
      continue
    }
    players.push({ id: p.id, place: p.place, look: p.look, handle: p.handle, level: p.level })
  }
  const { selected } = presenceStore.getState()
  const still = selected === null ? null : snapshot.players.find((p) => p.id === selected.id)
  presenceStore.setState({
    online: snapshot.online,
    players,
    elsewhere,
    // A player who left, or whom the server now hides, closes their card.
    selected:
      still === undefined || still === null
        ? null
        : { id: still.id, handle: still.handle, level: still.level, look: still.look },
  })
}

/** A signed-out read: the online count only; nobody is drawn. */
export function applyPublicSnapshot(snapshot: PublicSnapshot): void {
  presenceStore.setState({ online: snapshot.online, players: [], elsewhere: 0, selected: null })
}

/** Reads keep failing: hide the count and the players rather than show stale ones. */
export function presenceUnavailable(): void {
  presenceStore.setState({ online: null, players: [], elsewhere: 0, selected: null })
}

export function resetPresence(): void {
  presenceStore.setState({ ...INITIAL, hidden: presenceStore.getState().hidden })
}

/** Hides (or shows again, after an Undo) a player on this device at once. */
export function setPlayerHidden(id: string, hidden: boolean): void {
  const current = presenceStore.getState()
  if (current.hidden.has(id) === hidden) return
  const next = new Set(current.hidden)
  if (hidden) next.add(id)
  else next.delete(id)
  presenceStore.setState({ hidden: next })
}

export function selectPlayer(id: string | null): void {
  const state = presenceStore.getState()
  if ((state.selected?.id ?? null) === id) return
  if (id === null) {
    presenceStore.setState({ selected: null })
    return
  }
  const player = state.players.find((p) => p.id === id)
  if (player === undefined || state.hidden.has(id)) return
  presenceStore.setState({
    selected: { id: player.id, handle: player.handle, level: player.level, look: player.look },
  })
}

/** The players to draw: hidden ones left out. */
export function visiblePlayers(state: PresenceState = presenceStore.getState()): MapPlayer[] {
  return state.hidden.size === 0
    ? [...state.players]
    : state.players.filter((p) => !state.hidden.has(p.id))
}

const onlineNow = () => presenceStore.getState().online
const selectedNow = () => presenceStore.getState().selected
const none = () => null

export function useOnlineCount(): number | null {
  return useSyncExternalStore(presenceStore.subscribe, onlineNow, none)
}

export function useSelectedPlayer(): PlayerCard | null {
  return useSyncExternalStore(presenceStore.subscribe, selectedNow, none)
}

/** What the DOM overlay asks of the map: drawn players' heads on screen, nearest first. */
export interface PlayersBridge {
  heads(): readonly { readonly id: string; readonly x: number; readonly y: number }[]
}

export const playersBridge: { current: PlayersBridge | null } = { current: null }
