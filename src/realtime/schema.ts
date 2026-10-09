/**
 * The presence answers, validated at the boundary (zod/mini): the signed-in snapshot
 * (presence_snapshot) and the signed-out view (/api/presence, the count only). A row that does not
 * fit is dropped, never trusted: one bad row must not blank the whole map.
 */
import * as z from 'zod/mini'
import {
  CLOUT_LEVEL_IDS,
  PRESENCE_BOROUGHS,
  PRESENCE_SPOTS,
  type LookIds,
  type PresencePlayer,
  type PresenceSnapshot,
  type PublicSnapshot,
} from './types'

const PLACE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const OPTION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const LookSchema = z.record(z.string(), z.string().check(z.maxLength(64), z.regex(OPTION_ID)))

/** A look's option ids from `profiles.avatar.look` (or a bare look), or null. */
export function readLook(value: unknown): LookIds | null {
  const parsed = LookSchema.safeParse(value)
  return parsed.success && Object.keys(parsed.data).length > 0 ? parsed.data : null
}

const PlayerSchema = z.object({
  id: z.string().check(z.regex(/^[0-9a-f-]{36}$/)),
  handle: z.string().check(z.minLength(1), z.maxLength(40)),
  level: z.enum(CLOUT_LEVEL_IDS),
  career: z.nullable(z.string()),
  avatar: z.unknown(),
  spot: z.enum(PRESENCE_SPOTS),
  place: z.nullable(z.string().check(z.maxLength(64), z.regex(PLACE_ID))),
  borough: z.enum(PRESENCE_BOROUGHS),
})

const SnapshotSchema = z.object({
  online: z.int().check(z.gte(0)),
  players: z.array(z.unknown()),
})

const PublicSchema = z.object({ online: z.int().check(z.gte(0)) })

/** The signed-in snapshot, or null when its shape is wrong. Bad rows are skipped. */
export function parseSnapshot(value: unknown): PresenceSnapshot | null {
  const parsed = SnapshotSchema.safeParse(value)
  if (!parsed.success) return null
  const players: PresencePlayer[] = []
  for (const raw of parsed.data.players) {
    const row = PlayerSchema.safeParse(raw)
    if (!row.success) continue
    const { avatar, ...rest } = row.data
    const nested = typeof avatar === 'object' && avatar !== null && 'look' in avatar
    players.push({
      ...rest,
      place: rest.spot === 'place' ? rest.place : null,
      look: readLook(nested ? (avatar as { look: unknown }).look : null),
    })
  }
  return { online: parsed.data.online, players }
}

/** The signed-out view (the online count only), or null when its shape is wrong. */
export function parsePublicSnapshot(value: unknown): PublicSnapshot | null {
  const parsed = PublicSchema.safeParse(value)
  return parsed.success ? { online: parsed.data.online } : null
}
