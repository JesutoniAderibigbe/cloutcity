/**
 * An in-memory {@link PresenceTransport} for unit tests: holds the other players, records every
 * beat and leave, and can be told to fail. Applies no safety filters itself (the server does);
 * tests set `players` to what the server would answer.
 */
import { failure, type ApiErrorCode, type ApiResult } from '@/lib/supabase/rpc'
import type {
  Announce,
  PresencePlayer,
  PresenceSnapshot,
  PresenceTransport,
  PublicSnapshot,
} from './types'

export interface FakePresence extends PresenceTransport {
  players: PresencePlayer[]
  /** Added to the answered online count (players not in this viewer's list). */
  othersOnline: number
  readonly beats: Announce[]
  leaves: number
  snapshots: number
  publicSnapshots: number
  /** This viewer's ghost mode, as the server holds it (setGhost changes it). */
  ghost: boolean
  /** While set, every call answers this code. */
  failWith: ApiErrorCode | null
}

export function createFakePresence(players: PresencePlayer[] = []): FakePresence {
  const fake: FakePresence = {
    players,
    othersOnline: 0,
    beats: [],
    leaves: 0,
    snapshots: 0,
    publicSnapshots: 0,
    ghost: false,
    failWith: null,
    beat: (announce) => {
      if (fake.failWith !== null) return Promise.resolve(failure(fake.failWith))
      fake.beats.push(announce)
      return Promise.resolve({ ok: true, data: null })
    },
    snapshot: (): Promise<ApiResult<PresenceSnapshot>> => {
      fake.snapshots++
      if (fake.failWith !== null) return Promise.resolve(failure(fake.failWith))
      return Promise.resolve({
        ok: true,
        data: {
          online: fake.players.length + (fake.ghost ? 0 : 1) + fake.othersOnline,
          ghost: fake.ghost,
          players: [...fake.players],
        },
      })
    },
    leave: () => {
      fake.leaves++
      return Promise.resolve({ ok: true, data: null })
    },
    setGhost: (ghost) => {
      if (fake.failWith !== null) return Promise.resolve(failure(fake.failWith))
      fake.ghost = ghost
      return Promise.resolve({ ok: true, data: null })
    },
    publicSnapshot: (): Promise<ApiResult<PublicSnapshot>> => {
      fake.publicSnapshots++
      if (fake.failWith !== null) return Promise.resolve(failure(fake.failWith))
      return Promise.resolve({
        ok: true,
        data: { online: fake.othersOnline },
      })
    },
  }
  return fake
}
