/**
 * The shared live city's transport port (CLAUDE.md "Transport abstraction"): every realtime call
 * goes through {@link PresenceTransport}, so a move to another transport (Supabase Broadcast,
 * Durable Objects) touches only this folder and the RPC layer. S42 phase 1 implements it with a
 * polled heartbeat and snapshot (supabasePresence.ts) and an in-memory fake (fakePresence.ts).
 *
 * What crosses the wire is coarse on purpose: a spot (at a place, at home, travelling), a place
 * pin id and a borough. Never coordinates, never an address.
 */
import type { ApiResult } from '@/lib/supabase/rpc'

export const PRESENCE_BOROUGHS = [
  'queens',
  'brooklyn',
  'manhattan',
  'bronx',
  'staten-island',
] as const
export type PresenceBorough = (typeof PRESENCE_BOROUGHS)[number]

export const PRESENCE_SPOTS = ['place', 'home', 'travelling'] as const
export type PresenceSpot = (typeof PRESENCE_SPOTS)[number]

export const CLOUT_LEVEL_IDS = [
  'nobody',
  'local',
  'scene-regular',
  'known',
  'famous',
  'icon',
] as const
export type CloutLevelId = (typeof CLOUT_LEVEL_IDS)[number]

/** Where this player says they are. `place` is set exactly when `spot` is `place`. */
export interface Announce {
  readonly spot: PresenceSpot
  readonly place: string | null
  readonly borough: PresenceBorough
}

/** A look as other players see it: option ids only (src/engine/appearance.ts `PublicAvatar`). */
export type LookIds = Readonly<Record<string, string>>

/** Another player as the server lets this viewer see them. */
export interface PresencePlayer {
  readonly id: string
  readonly handle: string
  readonly level: CloutLevelId
  readonly career: string | null
  /** Null when their save has not synced a look yet. */
  readonly look: LookIds | null
  readonly spot: PresenceSpot
  readonly place: string | null
  readonly borough: PresenceBorough
}

export interface PresenceSnapshot {
  /** Every player online now (the viewer included): never padded. */
  readonly online: number
  readonly players: readonly PresencePlayer[]
}

export interface PublicSnapshot {
  /** Every player online now. The signed-out view is the count only: no one is drawn. */
  readonly online: number
}

export interface PresenceTransport {
  /** Announces where the player is (signed-in players with an account only). */
  beat(announce: Announce): Promise<ApiResult<null>>
  /** Who is online, as this signed-in viewer may see them. */
  snapshot(): Promise<ApiResult<PresenceSnapshot>>
  /** Takes the player off the map at once. */
  leave(): Promise<ApiResult<null>>
  /** The signed-out view: the online count only (a cached server route). */
  publicSnapshot(): Promise<ApiResult<PublicSnapshot>>
}
