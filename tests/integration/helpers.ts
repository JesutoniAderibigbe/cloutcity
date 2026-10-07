/**
 * Shared helpers for the integration suites. Tests never reset the database: each test signs in
 * fresh guests, so suites can run in any order against a stack other lanes may also use.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import { afterAll, expect, inject } from 'vitest'
import type { Database } from '@/lib/supabase/database.types'
import { toAttestationArgs } from '@/lib/supabase/attestation'
import type { OnboardingRecord } from '@/state/onboarding'

export type Client = SupabaseClient<Database>

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const

/** Bypasses RLS: stands in for server code (webhooks, the grant function, S20+ RPC setup). */
export function serviceClient(): Client {
  return createClient<Database>(inject('apiUrl'), inject('serviceRoleKey'), clientOptions)
}

/** A visitor with no session (the `anon` role). */
export function anonClient(): Client {
  return createClient<Database>(inject('apiUrl'), inject('anonKey'), clientOptions)
}

export interface Guest {
  readonly client: Client
  readonly id: string
}

/** A fresh anonymous guest, as after the welcome card but before attestation is recorded. */
export async function newGuest(): Promise<Guest> {
  const client = anonClient()
  const { data, error } = await client.auth.signInAnonymously()
  if (error !== null) throw error
  const id = data.user?.id
  if (id === undefined) throw new Error('signInAnonymously returned no user')
  return { client, id }
}

/** A completed S05a welcome card, a minute old. */
export function welcomeRecord(
  nowMs: number = Date.now(),
): Extract<OnboardingRecord, { status: 'complete' }> {
  return {
    status: 'complete',
    attested: true,
    attestedAt: nowMs - 60_000,
    consentVersion: '2026-10-06',
    consentedAt: nowMs - 60_000,
    audioChoice: 'ours',
  }
}

/** A guest whose welcome-card answers the server has recorded, the way S05 will do it. */
export async function newAttestedGuest(): Promise<Guest> {
  const guest = await newGuest()
  const { error } = await guest.client.rpc('attest_and_consent', toAttestationArgs(welcomeRecord()))
  if (error !== null) throw error
  return guest
}

/** Makes two players accepted friends (S20 adds the request flow). */
export async function befriend(a: Guest, b: Guest): Promise<void> {
  const { error } = await serviceClient().from('friendships').insert({
    requester_id: a.id,
    addressee_id: b.id,
    status: 'accepted',
    responded_at: new Date().toISOString(),
  })
  if (error !== null) throw error
}

/** Direct SQL as the postgres superuser, for catalog checks and seeding past days. */
export const sql = postgres(inject('dbUrl'), { max: 2, onnotice: () => undefined })
afterAll(async () => {
  await sql.end()
})

/** Asserts an RPC failed with the given machine code (the error message) and HTTP-mapped SQLSTATE. */
export function expectRpcError(
  error: { code?: string; message: string } | null,
  message: string,
  code?: string,
): void {
  expect(error, `expected ${message}`).not.toBeNull()
  expect(error?.message).toBe(message)
  if (code !== undefined) expect(error?.code).toBe(code)
}
