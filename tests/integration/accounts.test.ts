/**
 * S19 password accounts (DEC-61, DEC-62) against the real GoTrue and Postgres: a sign-up gets a
 * session at once (no confirmation email); a guest from before DEC-62 signs up on their own user
 * and keeps profile, attestation, consent, handle and cloud save; a taken email and a weak
 * password are refused; the banned-email triggers refuse a banned email however GoTrue is
 * called; the log-in route's service-only rate limit and username lookup; the moderator
 * console's log-in email; and private.require_permanent.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, inject, it, vi } from 'vitest'
import type { Database } from '@/lib/supabase/database.types'
import { handleLogin } from '@/server/auth/login'
import { loginDeps } from '@/server/auth/deps'
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

/** A client like the game's (PKCE), with its own in-memory session. */
function gameClient() {
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
const PASSWORD = 'correct horse 42'
const ATTEST = () => {
  const at = new Date(Date.now() - 60_000).toISOString()
  return {
    p_adult: true,
    p_attested_at: at,
    p_consent_version: '2026-10-06',
    p_consented_at: at,
    p_audio_choice: 'own',
  } as const
}
const sha = (n: number) => n.toString(16).padStart(64, '0')

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

/** supabase/config.toml `site_url`: the moderator log-in email links there, whatever was asked. */
const SITE_URL = /^site_url = "([^"]+)"/m.exec(
  readFileSync(join(import.meta.dirname, '../../supabase/config.toml'), 'utf8'),
)?.[1]

async function ban(email: string): Promise<void> {
  await sql`
    insert into private.banned_identities (identity_hash, kind, sanction_id)
    values (private.identity_hash(${email}), 'email', gen_random_uuid())
  `
}

/** A guest from before DEC-62 on a game client, attested (the old welcome card's guest). */
async function legacyGuest(): Promise<Guest & { client: ReturnType<typeof gameClient> }> {
  const client = gameClient()
  const { data, error } = await client.auth.signInAnonymously()
  if (error !== null || data.user === null) throw error ?? new Error('no user')
  const attested = await client.rpc('attest_and_consent', ATTEST())
  if (attested.error !== null) throw attested.error
  return { client, id: data.user.id }
}

/** Signs up the way the sign-up form does: account, attestation, username. */
async function signUp(email = freshEmail(), username?: string) {
  const client = gameClient()
  const { data, error } = await client.auth.signUp({ email, password: PASSWORD })
  if (error !== null) throw error
  if (data.session === null || data.user === null) throw new Error('no session after sign-up')
  const attested = await client.rpc('attest_and_consent', ATTEST())
  if (attested.error !== null) throw attested.error
  if (username !== undefined) {
    const saved = await client.rpc('set_handle', { p_handle: username })
    if (saved.error !== null) throw saved.error
  }
  return { client, id: data.user.id, email }
}

const freshUsername = () => `pw_${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`

describe('signing up with a password (DEC-61)', () => {
  it('gets a saved account and a session at once: no email, no guest', async () => {
    const account = await signUp(freshEmail(), freshUsername())
    const [row] = await sql<{ is_anonymous: boolean; confirmed: boolean; attested: boolean }[]>`
      select u.is_anonymous, u.email_confirmed_at is not null as confirmed, p.attested
      from auth.users u join public.profiles p on p.id = u.id where u.id = ${account.id}`
    expect(row).toEqual({ is_anonymous: false, confirmed: true, attested: true })
    // The password logs in on another device as the same user.
    const other = await gameClient().auth.signInWithPassword({
      email: account.email,
      password: PASSWORD,
    })
    expect(other.error).toBeNull()
    expect(other.data.user?.id).toBe(account.id)
  })

  it('a guest from before DEC-62 signs up on their own user: the game and profile stay', async () => {
    const guest = await legacyGuest()
    const handle = freshUsername()
    expect((await guest.client.rpc('set_handle', { p_handle: handle })).error).toBeNull()
    const [before] = await sql<
      { attested_at: Date; consent_version: string; consented_at: Date; handle: string | null }[]
    >`select attested_at, consent_version, consented_at, handle
      from public.profiles where id = ${guest.id}`
    await sql`
      insert into public.saves (user_id, revision, save_version, data, last_device_id)
      values (${guest.id}, 3, 11, ${sql.json({ marker: 'kept' })}, ${crypto.randomUUID()})
      on conflict (user_id) do nothing
    `
    const email = freshEmail()
    const update = await guest.client.auth.updateUser({ email, password: PASSWORD })
    expect(update.error).toBeNull()
    expect(update.data.user?.id).toBe(guest.id)
    expect(update.data.user?.is_anonymous).toBe(false)

    const [after] = await sql<(typeof before)[]>`
      select attested_at, consent_version, consented_at, handle
      from public.profiles where id = ${guest.id}`
    expect(after).toEqual(before)
    const [save] = await sql<{ revision: number; data: unknown }[]>`
      select revision::int as revision, data from public.saves where user_id = ${guest.id}`
    expect(save).toEqual({ revision: 3, data: { marker: 'kept' } })
    const signedIn = await gameClient().auth.signInWithPassword({ email, password: PASSWORD })
    expect(signedIn.data.user?.id).toBe(guest.id)
  })

  it('a taken email is refused, by sign-up and by a guest alike', async () => {
    const account = await signUp()
    const again = await gameClient().auth.signUp({ email: account.email, password: PASSWORD })
    expect(again.error?.code).toMatch(/^(user_already_exists|email_exists)$/)
    const guest = await legacyGuest()
    const update = await guest.client.auth.updateUser({ email: account.email, password: PASSWORD })
    expect(update.error?.code).toBe('email_exists')
  })

  it('a password under the minimum is refused as weak_password', async () => {
    const { error } = await gameClient().auth.signUp({ email: freshEmail(), password: 'short7!' })
    expect(error?.code).toBe('weak_password')
    expect(error?.status).toBe(422)
  })

  it("a saved account's email change stays pending: the game offers none (no email service)", async () => {
    // GoTrue applies a sign-up at once with confirmations off, but an email change on a saved
    // account still waits for a link (double_confirm_changes). The game has no email-change
    // control, so the account's email stays what it signed up with.
    const account = await signUp()
    const next = freshEmail()
    const { error } = await account.client.auth.updateUser({ email: next })
    expect(error).toBeNull()
    const [row] = await sql<{ current: boolean; pending: boolean }[]>`
      select email = ${account.email} as current, email_change = ${next} as pending
      from auth.users where id = ${account.id}`
    expect(row).toEqual({ current: true, pending: true })
  })
})

describe('banned emails on sign-up (DEC-61)', () => {
  it('the trigger refuses a banned email on signUp, in any spelling, and creates no user', async () => {
    const local = `s19ban${crypto.randomUUID().slice(0, 8)}`
    await ban(`${local}@example.test`)
    for (const email of [`${local}@example.test`, `${local.toUpperCase()}+alt@example.test`]) {
      const { error } = await gameClient().auth.signUp({ email, password: PASSWORD })
      expect(error, email).not.toBeNull()
    }
    const rows = await sql`select 1 from auth.users where email ilike ${`${local}%`}`
    expect(rows).toHaveLength(0)
  })

  it("the trigger refuses a banned email on a guest's sign-up (updateUser)", async () => {
    const guest = await legacyGuest()
    const email = freshEmail()
    await ban(email)
    const { error } = await guest.client.auth.updateUser({ email, password: PASSWORD })
    expect(error).not.toBeNull()
    const [row] = await sql<{ email: string | null; is_anonymous: boolean }[]>`
      select email, is_anonymous from auth.users where id = ${guest.id}`
    expect(row).toEqual({ email: null, is_anonymous: true })
  })
})

describe('log-in by username: the route and its service-only functions (DEC-61)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const configureServer = () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', inject('apiUrl'))
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', inject('anonKey'))
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', inject('serviceRoleKey'))
  }

  const post = (identifier: string, password: string, ip: string) =>
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ identifier, password }),
    })

  it('both functions are closed to every client role', async () => {
    const [grants] = await sql<Record<string, boolean>[]>`
      select
        has_function_privilege('anon', 'public.consume_login_attempt(text, text, integer, integer)', 'execute') as consume_anon,
        has_function_privilege('authenticated', 'public.consume_login_attempt(text, text, integer, integer)', 'execute') as consume_auth,
        has_function_privilege('service_role', 'public.consume_login_attempt(text, text, integer, integer)', 'execute') as consume_service,
        has_function_privilege('anon', 'public.login_email_for_handle(text)', 'execute') as lookup_anon,
        has_function_privilege('authenticated', 'public.login_email_for_handle(text)', 'execute') as lookup_auth,
        has_function_privilege('service_role', 'public.login_email_for_handle(text)', 'execute') as lookup_service`
    expect(grants).toEqual({
      consume_anon: false,
      consume_auth: false,
      consume_service: true,
      lookup_anon: false,
      lookup_auth: false,
      lookup_service: true,
    })
    const guest = await newAttestedGuest()
    expect(
      (await guest.client.rpc('login_email_for_handle', { p_handle: 'x' })).error,
    ).not.toBeNull()
  })

  it("the lookup finds a saved account's email by username, never a guest's", async () => {
    const username = freshUsername()
    const account = await signUp(freshEmail(), username)
    const lookup = (handle: string) =>
      serviceClient().rpc('login_email_for_handle', { p_handle: handle })
    expect((await lookup(username)).data).toBe(account.email)
    expect((await lookup(` @${username.toUpperCase()} `)).data).toBe(account.email)
    expect((await lookup(freshUsername())).data).toBeNull()

    const guest = await newAttestedGuest()
    const guestHandle = freshUsername()
    expect((await guest.client.rpc('set_handle', { p_handle: guestHandle })).error).toBeNull()
    expect((await lookup(guestHandle)).data).toBeNull()
  })

  it('the attempt counter refuses past the limit, per key and bucket, and validates input', async () => {
    const service = serviceClient()
    const key = sha(Date.now())
    const consume = (bucket: string, k = key) =>
      service.rpc('consume_login_attempt', {
        p_key_hash: k,
        p_bucket: bucket,
        p_max: 2,
        p_window_ms: 60_000,
      })
    expect((await consume('ip')).error).toBeNull()
    expect((await consume('ip')).error).toBeNull()
    expectRpcError((await consume('ip')).error, 'rate_limited', 'PT429')
    // The other bucket and another key count apart.
    expect((await consume('identifier')).error).toBeNull()
    expect((await consume('ip', sha(Date.now() + 1))).error).toBeNull()
    expectRpcError((await consume('elsewhere')).error, 'invalid_argument', 'PT400')
    expectRpcError((await consume('ip', 'not-a-hash')).error, 'invalid_argument', 'PT400')
    const stored = await sql`select 1 from private.login_attempts where key_hash = ${key}`
    expect(stored.length).toBe(2)
  })

  it('the route logs in by username with the real stack, one answer for every wrong pair', async () => {
    configureServer()
    const username = freshUsername()
    const account = await signUp(freshEmail(), username)
    const ip = `198.51.100.${Math.floor(Math.random() * 250)}`

    const ok = await handleLogin(post(`@${username}`, PASSWORD, ip), loginDeps())
    expect(ok.status).toBe(200)
    const tokens = (await ok.json()) as { access_token: string; refresh_token: string }
    const device = gameClient()
    const adopted = await device.auth.setSession(tokens)
    expect(adopted.data.user?.id).toBe(account.id)

    const wrong = await handleLogin(post(username, 'wrong password', ip), loginDeps())
    const unknown = await handleLogin(post(freshUsername(), PASSWORD, ip), loginDeps())
    for (const response of [wrong, unknown]) {
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ ok: false, code: 'invalid_credentials' })
    }
  })
})

describe('the moderator console log-in email (/mod)', () => {
  it("always links to the site's own /mod, whatever redirect the request named", async () => {
    const account = await signUp()
    for (const target of [
      `${SITE_URL ?? ''}/mod`,
      'http://127.0.0.1:9999/mod',
      'https://evil.example/auth/callback',
    ]) {
      await fetch(
        `${inject('mailpitUrl')}/api/v1/search?query=${encodeURIComponent(`to:"${account.email}"`)}`,
        { method: 'DELETE' },
      )
      await new Promise((resolve) => setTimeout(resolve, 1100))
      const sent = await gameClient().auth.signInWithOtp({
        email: account.email,
        options: { shouldCreateUser: false, emailRedirectTo: target },
      })
      expect(sent.error).toBeNull()
      const message = await mailTo(account.email)
      const link = /href="([^"]+)"/.exec(message.HTML)?.[1]?.replaceAll('&amp;', '&')
      const url = new URL(link ?? 'invalid:')
      expect(`${url.origin}${url.pathname}`).toBe(`${SITE_URL ?? ''}/mod`)
      expect(url.search).toBe('')
      const params = new URLSearchParams(url.hash.slice(1))
      expect(params.get('type')).toBe('email')
      expect(params.get('token_hash')).toMatch(/\S{8,}/)
    }
  })

  it('never creates an account for an unknown email', async () => {
    const email = freshEmail()
    const { error } = await gameClient().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
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
    const guest = await legacyGuest()
    const email = freshEmail()
    await ban(email)
    const { error } = await guest.client.auth.updateUser({ email, password: PASSWORD })
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
    const guest = await legacyGuest()
    await sql`
      insert into private.sanctions (user_id, kind, reason, created_by)
      values (${guest.id}, 'ban', 'hate', ${guest.id})
    `
    const { error } = await guest.client.auth.updateUser({
      email: freshEmail(),
      password: PASSWORD,
    })
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
    const account = await signUp()
    expect(await gate(account.id)).toBeNull()

    const [grants] = await sql<{ auth: boolean; anon: boolean }[]>`
      select has_function_privilege('authenticated', 'private.require_permanent()', 'execute') as auth,
        has_function_privilege('anon', 'private.require_permanent()', 'execute') as anon`
    expect(grants).toEqual({ auth: false, anon: false })
  })
})

describe('banned emails follow the person, not the spelling (review F3)', () => {
  it.each([
    ['plus tags, any domain', (local: string) => `${local}+alt@example.test`],
    ['case and whitespace', (local: string) => `\t ${local.toUpperCase()}@EXAMPLE.TEST \n`],
  ])('%s', async (_name, variant) => {
    const local = `s19ban${crypto.randomUUID().slice(0, 8)}`
    await ban(`${local}@example.test`)
    const guest = await newAttestedGuest()
    expect((await guest.client.rpc('check_account_email', { p_email: variant(local) })).data).toBe(
      'not_allowed',
    )
  })

  it('an empty local part is never canonicalised to a shared `@domain` (N2)', async () => {
    const [rows] = await sql<{ a: string; b: string; c: string }[]>`
      select private.canonical_email('+a@d.test') as a,
        private.canonical_email('+b@d.test') as b,
        private.canonical_email('.+x@gmail.com') as c`
    expect(rows).toEqual({ a: '+a@d.test', b: '+b@d.test', c: '.+x@gmail.com' })
    const domain = `s19n2${crypto.randomUUID().slice(0, 8)}.test`
    await ban(`+one@${domain}`)
    const guest = await newAttestedGuest()
    expect(
      (await guest.client.rpc('check_account_email', { p_email: `+two@${domain}` })).data,
    ).toBe('ok')
  })

  it('gmail dots and googlemail.com are the same inbox', async () => {
    const local = `s19ban${crypto.randomUUID().slice(0, 8)}`
    await ban(`${local}@gmail.com`)
    const guest = await newAttestedGuest()
    for (const variant of [
      `${local.slice(0, 3)}.${local.slice(3)}@gmail.com`,
      `${local}+x@googlemail.com`,
      `${local.slice(0, 2)}.${local.slice(2, 5)}.${local.slice(5)}@GoogleMail.com`,
    ]) {
      expect(
        (await guest.client.rpc('check_account_email', { p_email: variant })).data,
        variant,
      ).toBe('not_allowed')
    }
    // Dots matter on other domains.
    expect(
      (
        await guest.client.rpc('check_account_email', {
          p_email: `${local.slice(0, 3)}.${local.slice(3)}@example.test`,
        })
      ).data,
    ).toBe('ok')
  })

  it('the trigger refuses a variant of a banned email too', async () => {
    const local = `s19ban${crypto.randomUUID().slice(0, 8)}`
    await ban(`${local}@example.test`)
    const guest = await legacyGuest()
    const { error } = await guest.client.auth.updateUser({
      email: `${local}+again@example.test`,
      password: PASSWORD,
    })
    expect(error).not.toBeNull()
  })

  it('a ban recorded with the old hash still holds, and gains the canonical hash', async () => {
    const local = `s19leg${crypto.randomUUID().slice(0, 8)}`
    const email = `${local}@example.test`
    await sql`
      insert into private.banned_identities (identity_hash, kind, sanction_id)
      values (private.legacy_identity_hash(${email}), 'email', gen_random_uuid())
    `
    const guest = await newAttestedGuest()
    expect((await guest.client.rpc('check_account_email', { p_email: email })).data).toBe(
      'not_allowed',
    )
    const [canonical] = await sql<{ email: string }[]>`
      select private.canonical_email(${'  Na.Me+x@GoogleMail.com '}) as email`
    expect(canonical?.email).toBe('name@gmail.com')
  })

  it('the identity trigger also runs when a linked identity changes its email (F7)', async () => {
    const banned = freshEmail()
    await ban(banned)
    const email = freshEmail()
    const { data, error } = await serviceClient().auth.admin.createUser({
      email,
      email_confirm: true,
    })
    if (error !== null) throw error
    const refused = await sql.begin((tx) =>
      errorOf(
        tx,
        (sp) => sp`update auth.identities
          set identity_data = identity_data || jsonb_build_object('email', ${banned}::text)
          where user_id = ${data.user.id}`,
      ),
    )
    expect(refused?.message).toBe('email_not_allowed')
  })

  it('40 pre-checks at once answer at most the limit', async () => {
    const guest = await newAttestedGuest()
    const results = await Promise.all(
      Array.from({ length: 40 }, () =>
        guest.client.rpc('check_account_email', { p_email: freshEmail() }),
      ),
    )
    expect(results.filter((result) => result.error === null).length).toBeLessThanOrEqual(10)
  })
})
