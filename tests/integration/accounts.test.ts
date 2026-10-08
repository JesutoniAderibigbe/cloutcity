/**
 * S19 accounts against the real GoTrue and Postgres: a guest who saves their progress with an
 * email keeps the same user (profile, attestation, consent, handle and cloud save untouched),
 * confirmed through the email-change link Mailpit catches; log-in by code never creates an
 * account; the banned-email pre-check and the triggers that refuse a banned email however
 * GoTrue is called; and private.require_permanent.
 */
import { createClient } from '@supabase/supabase-js'
import { describe, expect, inject, it } from 'vitest'
import type { Database } from '@/lib/supabase/database.types'
import {
  anonClient,
  errorOf,
  expectRpcError,
  newAttestedGuest,
  newGuest,
  serviceClient,
  sql,
  type Guest,
} from './helpers'

const CALLBACK = 'http://localhost:3102/auth/callback'

/** A client like the game's guest client (PKCE), with its own in-memory session. */
function pkceClient() {
  const store = new Map<string, string>()
  return createClient<Database>(inject('apiUrl'), inject('anonKey'), {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: {
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => void store.set(key, value),
        removeItem: (key) => void store.delete(key),
      },
    },
  })
}

const freshEmail = () => `s19-${crypto.randomUUID()}@example.test`

interface MailpitMessage {
  readonly Text: string
  readonly HTML: string
}

/** The newest email to `email`, waiting for it to arrive. */
async function mailTo(email: string): Promise<MailpitMessage> {
  const base = inject('mailpitUrl')
  const query = encodeURIComponent(`to:"${email}"`)
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const search = (await (await fetch(`${base}/api/v1/search?query=${query}`)).json()) as {
      messages?: { ID: string }[]
    }
    const id = search.messages?.[0]?.ID
    if (id !== undefined) {
      return (await (await fetch(`${base}/api/v1/message/${id}`)).json()) as MailpitMessage
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('no email arrived')
}

function linkParams(message: MailpitMessage): URLSearchParams {
  const link = /href="([^"]+)"/.exec(message.HTML)?.[1]?.replaceAll('&amp;', '&')
  if (link === undefined) throw new Error('no link in the email')
  const url = new URL(link)
  expect(`${url.origin}${url.pathname}`).toBe(CALLBACK)
  return url.searchParams
}

async function ban(email: string): Promise<void> {
  await sql`
    insert into private.banned_identities (identity_hash, kind, sanction_id)
    values (private.identity_hash(${email}), 'email', gen_random_uuid())
  `
}

/** A guest on a PKCE client who has attested (the game's guest after the welcome card). */
async function pkceGuest(): Promise<Guest & { client: ReturnType<typeof pkceClient> }> {
  const client = pkceClient()
  const { data, error } = await client.auth.signInAnonymously()
  if (error !== null || data.user === null) throw error ?? new Error('no user')
  const now = Date.now()
  const attested = await client.rpc('attest_and_consent', {
    p_adult: true,
    p_attested_at: new Date(now - 60_000).toISOString(),
    p_consent_version: '2026-10-06',
    p_consented_at: new Date(now - 60_000).toISOString(),
    p_audio_choice: 'own',
  })
  if (attested.error !== null) throw attested.error
  return { client, id: data.user.id }
}

describe('saving progress with an email (S19)', () => {
  it('keeps the same user: attestation, consent, handle and save stay; the link confirms it', async () => {
    const guest = await pkceGuest()
    const email = freshEmail()
    const [before] = await sql<
      {
        attested: boolean
        attested_at: Date
        consent_version: string
        consented_at: Date
        handle: string | null
      }[]
    >`select attested, attested_at, consent_version, consented_at, handle
      from public.profiles where id = ${guest.id}`
    await sql`
      insert into public.saves (user_id, revision, save_version, data, last_device_id)
      values (${guest.id}, 3, 11, ${sql.json({ marker: 'kept' })}, ${crypto.randomUUID()})
      on conflict (user_id) do nothing
    `

    expect((await guest.client.rpc('check_account_email', { p_email: email })).data).toBe('ok')
    const update = await guest.client.auth.updateUser({ email }, { emailRedirectTo: CALLBACK })
    expect(update.error).toBeNull()
    // Nothing changes until the link is opened.
    expect(update.data.user?.is_anonymous).toBe(true)

    const params = linkParams(await mailTo(email))
    expect(params.get('type')).toBe('email_change')
    // Opened on another device: that device signs in to the same user.
    const other = pkceClient()
    const verified = await other.auth.verifyOtp({
      token_hash: params.get('token_hash') ?? '',
      type: 'email_change',
    })
    expect(verified.error).toBeNull()
    expect(verified.data.user?.id).toBe(guest.id)
    expect(verified.data.user?.is_anonymous).toBe(false)

    // The first device's own session now reads as the saved account (the poll's path).
    const fromServer = await guest.client.auth.getUser()
    expect(fromServer.data.user?.id).toBe(guest.id)
    expect(fromServer.data.user?.is_anonymous).toBe(false)
    expect(fromServer.data.user?.email).toBe(email)

    const [after] = await sql<(typeof before)[]>`
      select attested, attested_at, consent_version, consented_at, handle
      from public.profiles where id = ${guest.id}`
    expect(after).toEqual(before)
    const [save] = await sql<{ revision: number; data: unknown }[]>`
      select revision::int as revision, data from public.saves where user_id = ${guest.id}`
    expect(save).toEqual({ revision: 3, data: { marker: 'kept' } })
    const [auth] = await sql<{ is_anonymous: boolean }[]>`
      select is_anonymous from auth.users where id = ${guest.id}`
    expect(auth?.is_anonymous).toBe(false)
  })

  it('an email that already has an account answers email_exists', async () => {
    const first = await pkceGuest()
    const email = freshEmail()
    await first.client.auth.updateUser({ email }, { emailRedirectTo: CALLBACK })
    const params = linkParams(await mailTo(email))
    await pkceClient().auth.verifyOtp({
      token_hash: params.get('token_hash') ?? '',
      type: 'email_change',
    })
    const second = await pkceGuest()
    const { error } = await second.client.auth.updateUser({ email }, { emailRedirectTo: CALLBACK })
    expect(error?.code).toBe('email_exists')
  })

  it('a used confirmation link does not work twice', async () => {
    const guest = await pkceGuest()
    const email = freshEmail()
    await guest.client.auth.updateUser({ email }, { emailRedirectTo: CALLBACK })
    const hash = linkParams(await mailTo(email)).get('token_hash') ?? ''
    expect(
      (await pkceClient().auth.verifyOtp({ token_hash: hash, type: 'email_change' })).error,
    ).toBeNull()
    const again = await pkceClient().auth.verifyOtp({ token_hash: hash, type: 'email_change' })
    expect(again.error).not.toBeNull()
  })
})

describe('logging in (S19)', () => {
  it('a saved account logs in on a new device by code, as the same user', async () => {
    const guest = await pkceGuest()
    const email = freshEmail()
    await guest.client.auth.updateUser({ email }, { emailRedirectTo: CALLBACK })
    await pkceClient().auth.verifyOtp({
      token_hash: linkParams(await mailTo(email)).get('token_hash') ?? '',
      type: 'email_change',
    })

    const device = pkceClient()
    const sent = await device.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: CALLBACK },
    })
    expect(sent.error).toBeNull()
    const message = await mailTo(email)
    const code = /<strong>(\d{6})<\/strong>/.exec(message.HTML)?.[1]
    expect(code).toMatch(/^\d{6}$/)
    expect(linkParams(message).get('type')).toBe('email')
    const verified = await device.auth.verifyOtp({ email, token: code ?? '', type: 'email' })
    expect(verified.error).toBeNull()
    expect(verified.data.user?.id).toBe(guest.id)
  })

  it('never creates an account for an unknown email', async () => {
    const email = freshEmail()
    const { error } = await pkceClient().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: CALLBACK },
    })
    expect(error?.code).toBe('otp_disabled')
    const rows = await sql`select 1 from auth.users where email = ${email}`
    expect(rows).toHaveLength(0)
  })
})

describe('banned emails (S19)', () => {
  it('check_account_email: ok, not_allowed for a banned email (any case, padded), invalid input', async () => {
    const guest = await newAttestedGuest()
    const email = freshEmail()
    await ban(email)
    const check = (value: string) => guest.client.rpc('check_account_email', { p_email: value })
    expect((await check(freshEmail())).data).toBe('ok')
    expect((await check(` ${email.toUpperCase()} `)).data).toBe('not_allowed')
    expectRpcError((await check('not-an-email')).error, 'invalid_argument', 'PT400')
    expectRpcError((await check(`${'a'.repeat(320)}@x.co`)).error, 'invalid_argument', 'PT400')
  })

  it('check_account_email needs the attestation, and is rate limited per player', async () => {
    const unattested = await newGuest()
    expectRpcError(
      (await unattested.client.rpc('check_account_email', { p_email: freshEmail() })).error,
      'attestation_required',
      'PT403',
    )
    expectRpcError(
      (await anonClient().rpc('check_account_email', { p_email: freshEmail() })).error,
      'permission denied for function check_account_email',
    )
    const guest = await newAttestedGuest()
    for (let i = 0; i < 10; i += 1) {
      const { error } = await guest.client.rpc('check_account_email', { p_email: freshEmail() })
      expect(error).toBeNull()
    }
    expectRpcError(
      (await guest.client.rpc('check_account_email', { p_email: freshEmail() })).error,
      'rate_limited',
      'PT429',
    )
  })

  it('a banned player gets not_allowed for any email', async () => {
    const guest = await newAttestedGuest()
    await sql`
      insert into private.sanctions (user_id, kind, reason, created_by)
      values (${guest.id}, 'ban', 'hate', ${guest.id})
    `
    expect((await guest.client.rpc('check_account_email', { p_email: freshEmail() })).data).toBe(
      'not_allowed',
    )
  })

  it('the trigger refuses a banned email on updateUser, however the client calls GoTrue', async () => {
    const guest = await pkceGuest()
    const email = freshEmail()
    await ban(email)
    const { error } = await guest.client.auth.updateUser({ email }, { emailRedirectTo: CALLBACK })
    expect(error).not.toBeNull()
    const [row] = await sql<{ email: string | null; email_change: string | null }[]>`
      select email, email_change from auth.users where id = ${guest.id}`
    expect(row?.email ?? '').toBe('')
    expect(row?.email_change ?? '').toBe('')
  })

  it('the triggers refuse a banned email on a new user and on a linked identity', async () => {
    const email = freshEmail()
    await ban(email)
    const created = await serviceClient().auth.admin.createUser({ email, email_confirm: true })
    expect(created.error).not.toBeNull()

    const guest = await newGuest()
    const insertIdentity = await sql.begin((tx) =>
      errorOf(
        tx,
        (sp) => sp`insert into auth.identities (provider_id, user_id, identity_data, provider)
           values (${crypto.randomUUID()}, ${guest.id},
             ${sp.json({ sub: 'google-1', email })}, 'google')`,
      ),
    )
    expect(insertIdentity?.message).toBe('email_not_allowed')
  })

  it('a banned account cannot add an email at all', async () => {
    const guest = await pkceGuest()
    await sql`
      insert into private.sanctions (user_id, kind, reason, created_by)
      values (${guest.id}, 'ban', 'hate', ${guest.id})
    `
    const { error } = await guest.client.auth.updateUser(
      { email: freshEmail() },
      { emailRedirectTo: CALLBACK },
    )
    expect(error).not.toBeNull()
  })
})

describe('private.require_permanent (S19, for S26)', () => {
  /** Calls the gate as the database owner would from a security-definer RPC, for `userId`. */
  const gate = (userId: string) =>
    sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`
      return errorOf(tx, (sp) => sp`select private.require_permanent()`)
    })

  it('refuses a guest, passes a saved account, and is closed to clients', async () => {
    const guest = await newAttestedGuest()
    expect((await gate(guest.id))?.message).toBe('account_required')

    const saved = await pkceGuest()
    const email = freshEmail()
    await saved.client.auth.updateUser({ email }, { emailRedirectTo: CALLBACK })
    await pkceClient().auth.verifyOtp({
      token_hash: linkParams(await mailTo(email)).get('token_hash') ?? '',
      type: 'email_change',
    })
    expect(await gate(saved.id)).toBeNull()

    const [grants] = await sql<{ auth: boolean; anon: boolean }[]>`
      select has_function_privilege('authenticated', 'private.require_permanent()', 'execute') as auth,
        has_function_privilege('anon', 'private.require_permanent()', 'execute') as anon`
    expect(grants).toEqual({ auth: false, anon: false })
  })
})
