/**
 * POST /api/save (S18c): checks a device's save against the last one the server accepted and
 * stores it, or keeps it aside.
 *
 * 1. The caller is the Supabase user whose access token is the Bearer token (401 otherwise).
 * 2. The body fits `UploadBodySchema` (400) and the save fits `sync.maxSaveBytes` (413).
 * 3. The account has attested (403) and the save format is this server's (409 `version`).
 * 4. The upload is based on the cloud's current revision (409 `conflict`, with the cloud copy).
 * 5. Save plausibility (src/engine/plausibility.ts `checkUpload`): a rejected save goes to
 *    `quarantine_save` (422); otherwise `commit_save` stores it with its repairs, the new grant
 *    rows and the public projection (INT-10), under a compare-and-swap on the revision and the
 *    upload rate limit (409, 429).
 *
 * The storage side is a `SaveBackend`, so the rules are tested without a database
 * (handleUpload.test.ts) and against the real one (tests/integration/save-sync.test.ts).
 * Nothing logged here holds the save, the user id or the token.
 */
import 'server-only'
import { z } from 'zod'
import { engineConfig } from '@/engine/config'
import { toServerGrantRow, type ServerGrantRow } from '@/engine/grants'
import { checkUpload, type PlausibilityCeilings } from '@/engine/plausibility'
import { SAVE_VERSION, loadSave, migrateSave, type SaveState } from '@/engine/save'
import { sync } from '@/lib/data/config'
import type { Logger } from '@/lib/log'
import type { CloudCopy, UploadReply } from '@/lib/sync/protocol'

/** Room for the envelope around the save in a request body. */
const ENVELOPE_BYTES = 4096

export const UploadBodySchema = z.strictObject({
  saveVersion: z.int().positive(),
  baseRevision: z.int().nonnegative(),
  deviceId: z.uuid(),
  clientSavedAt: z.int().nonnegative().nullable(),
  save: z.unknown(),
})

/** The account's save row as the server reads it. */
export interface StoredSave extends CloudCopy {
  readonly burstCreditMinutes: number
}

/** What the server holds for a player. */
export interface PlayerRecord {
  readonly attested: boolean
  /** When the account was created (ISO). */
  readonly createdAt: string
  readonly save: StoredSave | null
  /** Grant keys the server holds (`goal:<id>:r<run>`). */
  readonly grantKeys: readonly string[]
  /** Premium items with a live entitlement. */
  readonly entitledItemIds: readonly string[]
}

export interface CommitArgs {
  readonly userId: string
  readonly expectedRevision: number
  readonly saveVersion: number
  readonly data: SaveState
  readonly deviceId: string
  readonly clientSavedAt: string | null
  readonly publicLevel: string
  readonly careerPath: string | null
  readonly sameRun: boolean
  readonly avatar: { readonly cosmetics: readonly string[] }
  readonly grants: readonly ServerGrantRow[]
  readonly burstCreditMinutes: number
}

export type CommitOutcome =
  | { readonly ok: true; readonly revision: number; readonly acceptedAt: string }
  | {
      readonly ok: false
      readonly code: 'conflict' | 'version' | 'rate-limited' | 'attestation-required'
    }

export interface QuarantineArgs {
  readonly userId: string
  readonly baseRevision: number
  readonly saveVersion: number
  readonly data: unknown
  readonly findings: readonly string[]
  readonly deviceId: string
}

/** Storage for cloud saves (the Supabase one is `supabaseSaveBackend`). Failures throw. */
export interface SaveBackend {
  /** The user an access token belongs to, or null for an invalid or expired token. */
  userIdFor(accessToken: string): Promise<string | null>
  /** The player's record, or null when there is no profile. */
  load(userId: string): Promise<PlayerRecord | null>
  commit(args: CommitArgs): Promise<CommitOutcome>
  quarantine(args: QuarantineArgs): Promise<'ok' | 'rate-limited'>
}

export interface UploadRequest {
  readonly authorization: string | null
  readonly bodyText: string
}

export interface UploadResult {
  readonly status: number
  readonly body: UploadReply
}

const reply = (status: number, body: UploadReply): UploadResult => ({ status, body })

function bearer(authorization: string | null): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '')
  return match?.[1] ?? null
}

const cloudOf = (save: StoredSave | null): CloudCopy | null =>
  save === null
    ? null
    : {
        revision: save.revision,
        saveVersion: save.saveVersion,
        data: save.data,
        acceptedAt: save.acceptedAt,
        deviceId: save.deviceId,
      }

/**
 * The stored save in the current format, or null when there is none. A save stored by an older
 * build is upgraded; one from a newer build than this server cannot be checked against.
 */
function previousSave(stored: StoredSave | null): SaveState | null | 'newer' {
  if (stored === null) return null
  if (stored.saveVersion > SAVE_VERSION) return 'newer'
  if (stored.saveVersion < SAVE_VERSION) {
    return migrateSave(stored.data, stored.saveVersion, engineConfig).save
  }
  const loaded = loadSave(stored.data, engineConfig)
  // commit_save stores only saves that passed the checks: an unusable one is a server fault.
  if (!loaded.ok) throw new Error('The stored cloud save does not load')
  return loaded.save
}

export async function handleUpload(
  request: UploadRequest,
  backend: SaveBackend,
  ceilings: PlausibilityCeilings,
  nowMs: number,
  logger: Logger,
): Promise<UploadResult> {
  const token = bearer(request.authorization)
  if (token === null) return reply(401, { ok: false, code: 'unauthenticated' })
  if (Buffer.byteLength(request.bodyText, 'utf8') > sync.maxSaveBytes + ENVELOPE_BYTES) {
    return reply(413, { ok: false, code: 'too-large' })
  }

  let json: unknown
  try {
    json = JSON.parse(request.bodyText)
  } catch {
    return reply(400, { ok: false, code: 'invalid' })
  }
  const parsed = UploadBodySchema.safeParse(json)
  if (!parsed.success) return reply(400, { ok: false, code: 'invalid' })
  const body = parsed.data
  const saveBytes = Buffer.byteLength(JSON.stringify(body.save) ?? '', 'utf8')
  if (saveBytes > sync.maxSaveBytes) return reply(413, { ok: false, code: 'too-large' })

  const userId = await backend.userIdFor(token)
  if (userId === null) return reply(401, { ok: false, code: 'unauthenticated' })
  const player = await backend.load(userId)
  if (player === null || !player.attested) {
    return reply(403, { ok: false, code: 'attestation-required' })
  }
  if (body.saveVersion !== SAVE_VERSION) {
    return reply(409, { ok: false, code: 'version', serverVersion: SAVE_VERSION })
  }
  const stored = player.save
  if ((stored?.revision ?? 0) !== body.baseRevision) {
    return reply(409, { ok: false, code: 'conflict', cloud: cloudOf(stored) })
  }
  const prev = previousSave(stored)
  if (prev === 'newer') {
    return reply(409, { ok: false, code: 'version', serverVersion: SAVE_VERSION })
  }

  const acceptedAtMs = stored?.acceptedAt == null ? nowMs : Date.parse(stored.acceptedAt)
  const verdict = checkUpload(
    prev,
    body.save,
    {
      realMinutesSinceAccept: Math.max(0, nowMs - acceptedAtMs) / 60_000,
      burstCreditMinutes: stored?.burstCreditMinutes ?? ceilings.burstRealMinutes,
      accountAgeMinutes: Math.max(0, nowMs - Date.parse(player.createdAt)) / 60_000,
      serverGrantKeys: player.grantKeys,
      entitledItemIds: player.entitledItemIds,
      firstUpload: stored === null,
    },
    ceilings,
    engineConfig,
  )

  if (verdict.save === null || verdict.publicView === null) {
    logger.info('A cloud save failed plausibility and was kept aside', {
      findings: verdict.findings,
    })
    const kept = await backend.quarantine({
      userId,
      baseRevision: body.baseRevision,
      saveVersion: body.saveVersion,
      // The quarantine keeps objects; anything else is wrapped so it is kept as sent.
      data:
        typeof body.save === 'object' && body.save !== null && !Array.isArray(body.save)
          ? body.save
          : { upload: body.save ?? null },
      findings: verdict.findings,
      deviceId: body.deviceId,
    })
    if (kept === 'rate-limited') {
      return reply(429, { ok: false, code: 'rate-limited', retryAfterMs: 60_000 })
    }
    return reply(422, { ok: false, code: 'rejected' })
  }

  const committed = await backend.commit({
    userId,
    expectedRevision: body.baseRevision,
    saveVersion: body.saveVersion,
    data: verdict.save,
    deviceId: body.deviceId,
    clientSavedAt: body.clientSavedAt === null ? null : new Date(body.clientSavedAt).toISOString(),
    publicLevel: verdict.publicView.level_id,
    careerPath: verdict.publicView.career_path,
    sameRun: verdict.sameRun,
    avatar: { cosmetics: verdict.publicView.cosmetics },
    grants: verdict.grantsToInsert.map((record) => toServerGrantRow(record, userId)),
    burstCreditMinutes: verdict.burstCreditMinutes ?? 0,
  })
  if (!committed.ok) {
    switch (committed.code) {
      case 'conflict': {
        const latest = await backend.load(userId)
        return reply(409, { ok: false, code: 'conflict', cloud: cloudOf(latest?.save ?? null) })
      }
      case 'version':
        return reply(409, { ok: false, code: 'version', serverVersion: SAVE_VERSION })
      case 'rate-limited':
        return reply(429, {
          ok: false,
          code: 'rate-limited',
          retryAfterMs: sync.minUploadIntervalMs,
        })
      case 'attestation-required':
        return reply(403, { ok: false, code: 'attestation-required' })
    }
  }

  if (verdict.findings.length > 0) {
    logger.info('A cloud save was stored with repairs or a capped public level', {
      findings: verdict.findings,
    })
  }
  const held = new Set([...player.grantKeys, ...verdict.grantsToInsert.map((r) => r.key)])
  return reply(200, {
    ok: true,
    revision: committed.revision,
    acceptedAt: committed.acceptedAt,
    repairs: verdict.repairs,
    syncedGrantKeys: verdict.save.grants.log
      .map((record) => record.key)
      .filter((key) => held.has(key)),
  })
}
