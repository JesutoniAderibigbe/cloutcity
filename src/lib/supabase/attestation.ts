/**
 * The bridge between the welcome card's local record (S05a) and the server's attestation RPCs
 * (S18, supabase/migrations/*_s18_profiles_attestation.sql). Pure: no Supabase import, so it
 * costs nothing in the shell bundle; the session code (S05) passes its output to
 * `supabase.rpc('attest_and_consent', ...)` right after `signInAnonymously()`.
 */
import * as z from 'zod/mini'
import type { AudioChoice } from '@/lib/forms/welcome'
import type { OnboardingRecord } from '@/state/onboarding'

/** Must match profiles_consent_version_format and attest_and_consent's check. */
export const CONSENT_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** Arguments of public.attest_and_consent, named as the SQL function's parameters. */
export interface AttestationArgs {
  readonly p_adult: true
  readonly p_attested_at: string
  readonly p_consent_version: string
  readonly p_consented_at: string
  readonly p_audio_choice: AudioChoice
}

function toIso(ms: number): string {
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) throw new RangeError('Timestamp is out of range')
  return date.toISOString()
}

/**
 * Maps a completed welcome card to the RPC's arguments. Only a `complete` record carries an
 * attestation; anything else (an under-age lock) must never reach a sign-in, so it throws.
 */
export function toAttestationArgs(record: OnboardingRecord): AttestationArgs {
  if (record.status !== 'complete') {
    throw new Error('Only a completed welcome card can be attested')
  }
  if (!CONSENT_VERSION_PATTERN.test(record.consentVersion)) {
    throw new Error('Consent version must be an ISO date')
  }
  return {
    p_adult: true,
    p_attested_at: toIso(record.attestedAt),
    p_consent_version: record.consentVersion,
    p_consented_at: toIso(record.consentedAt),
    p_audio_choice: record.audioChoice,
  }
}

/** Machine codes the S18 RPCs raise as their error message (with SQLSTATE PTxyz → HTTP xyz). */
export const RPC_ERRORS = [
  'not_authenticated',
  'attestation_required',
  'not_adult',
  'invalid_timestamp',
  'invalid_argument',
  'invalid_target',
  'not_friends',
  'boost_already_sent',
] as const
export type RpcErrorCode = (typeof RPC_ERRORS)[number]

const RpcErrorSchema = z.object({ message: z.enum(RPC_ERRORS) })

/** Reads the code out of a PostgREST error; anything unrecognised is 'unknown'. */
export function parseRpcError(error: unknown): RpcErrorCode | 'unknown' {
  const result = RpcErrorSchema.safeParse(error)
  return result.success ? result.data.message : 'unknown'
}
