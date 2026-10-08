import { request as httpRequest } from 'node:http'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from './fixtures/test'
import { bootAccount } from './helpers/account'
import { database, newGuest, newPermanentUser } from './helpers/seed'
import { STACK_SITE_URL, clearMail, linkIn, newestMail, ourLink } from './helpers/mail'
import { E2E_MODERATOR_EMAIL, localStack } from './helpers/stack'

// S18b part 2, opt-in (`npm run e2e:supabase`): the /mod console against the local stack. The
// test moderator (MODERATOR_EMAILS in playwright.supabase.config.ts) signs in through the link
// Mailpit caught, sees a seeded case with its note, suspends, and exactly one audit row exists;
// a confirmed non-moderator and a guest get 403; the /mod session never replaces the game's
// account session on the same device.

// One project only: the test moderator's mailbox and the per-IP sign-in limit are shared.
test.skip(({ isMobile }) => !isMobile, 'runs once, on mobile-390')
test.use({ injectedConsoleErrors: [/status of 409/] })

const stack = localStack()
// Opened and closed per group of tests: with fullyParallel, one worker can run this file's
// tests in several groups, and a connection ended after the first would fail the next.
let sql: ReturnType<typeof database>
test.beforeAll(() => {
  sql = database(stack)
})
test.afterAll(async () => {
  await sql.end()
})

test('a non-moderator and a guest are refused; no token is a 401', async ({ request }) => {
  const [player, guest] = await Promise.all([newPermanentUser(stack), newGuest(stack)])
  for (const user of [player, guest]) {
    const response = await request.get('/api/mod/queue', {
      headers: { authorization: `Bearer ${user.accessToken}` },
    })
    expect(response.status()).toBe(403)
    expect(await response.json()).toEqual({ ok: false, code: 'not_moderator' })
  }
  expect((await request.get('/api/mod/queue')).status()).toBe(401)
  const action = await request.post('/api/mod/action', {
    headers: { authorization: `Bearer ${player.accessToken}` },
    data: {
      action: 'ban',
      caseId: guest.id,
      idempotencyKey: `e2e-${crypto.randomUUID()}`,
      reason: 'spam',
    },
  })
  expect(action.status()).toBe(403)
})

/** POSTs JSON with a Host header of the caller's choosing (fetch cannot set one). */
function postWithHost(
  base: string,
  path: string,
  host: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  const data = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      new URL(path, base),
      {
        method: 'POST',
        headers: {
          host,
          'x-forwarded-host': host,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let text = ''
        res.on('data', (chunk: Buffer) => (text += chunk.toString()))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(text) }))
      },
    )
    req.on('error', reject)
    req.end(data)
  })
}

test('the sign-in answer is the same for a moderator and anyone else', async ({
  request,
  baseURL,
}) => {
  await clearMail(E2E_MODERATOR_EMAIL)
  // A spoofed Host must not choose where the link lands (SITE_URL's /mod; handlers.test.ts).
  const forMod = await postWithHost(baseURL ?? '', '/api/mod/sign-in', 'attacker.example', {
    email: E2E_MODERATOR_EMAIL,
  })
  const forOther = await request.post('/api/mod/sign-in', {
    data: { email: `nobody-${crypto.randomUUID()}@example.test` },
  })
  expect(forMod.status).toBe(202)
  expect(forOther.status()).toBe(202)
  expect(forMod.json).toEqual(await forOther.json())
  // Never the spoofed host: our token-hash link goes to the stack's own site URL whatever the
  // request named (review F4); GoTrue's verify link (a first sign-up) to SITE_URL's /mod.
  const link = new URL(linkIn(await newestMail(E2E_MODERATOR_EMAIL)))
  expect(link.href).not.toContain('attacker.example')
  if (link.pathname === '/auth/v1/verify') {
    expect(link.searchParams.get('redirect_to')).toBe(`${baseURL ?? ''}/mod`)
  } else {
    expect(link.origin).toBe(STACK_SITE_URL)
    expect(link.search).toBe('')
  }
})

test("the moderator's address with a password session (no emailed link) is refused", async ({
  request,
}) => {
  // An address can be marked confirmed without its owner's emailed link (an admin, or a project
  // with confirmations off). Only a session from the emailed link (amr otp) is a moderator's.
  const admin = createClient(stack.apiUrl, stack.serviceRoleKey, {
    auth: { persistSession: false },
  })
  const password = `pw-${crypto.randomUUID()}`
  const [existing] = await sql<{ id: string }[]>`
    select id from auth.users where email = ${E2E_MODERATOR_EMAIL}
  `
  const updated =
    existing === undefined
      ? await admin.auth.admin.createUser({
          email: E2E_MODERATOR_EMAIL,
          password,
          email_confirm: true,
        })
      : await admin.auth.admin.updateUserById(existing.id, { password })
  if (updated.error !== null) throw updated.error
  const client = createClient(stack.apiUrl, stack.anonKey, { auth: { persistSession: false } })
  const { data, error } = await client.auth.signInWithPassword({
    email: E2E_MODERATOR_EMAIL,
    password,
  })
  if (error !== null || data.session === null) throw error ?? new Error('no session')
  const response = await request.get('/api/mod/queue', {
    headers: { authorization: `Bearer ${data.session.access_token}` },
  })
  expect(response.status()).toBe(403)
  expect(await response.json()).toEqual({ ok: false, code: 'not_moderator' })
})

test('a moderator signs in by email link, opens a seeded case and suspends; one audit row', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000)
  const [target, reporter] = await Promise.all([newGuest(stack), newGuest(stack)])
  const { error } = await reporter.client.rpc('submit_report', {
    p_target: target.id,
    p_kind: 'player',
    p_reason: 'harassment',
    p_note: 'kept following me around',
    p_idempotency_key: `e2e-${crypto.randomUUID()}`,
  })
  if (error !== null) throw error

  // A player's account in the game first, to prove /mod never replaces it.
  await bootAccount(page)
  const gameKey = () =>
    page.evaluate(() => {
      const key = Object.keys(localStorage).find((name) => /^sb-.+-auth-token$/.test(name))
      return key === undefined ? null : [key, localStorage.getItem(key)]
    })
  const before = await gameKey()
  expect(before).not.toBeNull()

  await clearMail(E2E_MODERATOR_EMAIL)
  await page.goto('/mod')
  await page.getByRole('textbox', { name: 'Email' }).fill(E2E_MODERATOR_EMAIL)
  await page.getByRole('button', { name: 'Send sign-in link' }).click()
  await expect(page.getByRole('status').first()).toContainText('a sign-in link is on its way')

  // A returning moderator's email (S19's magic-link template) links to /mod with a token hash,
  // finished by a tap; a first sign-up's confirmation goes through GoTrue's verify endpoint and
  // redirects with the session in the fragment (locally to the stack's site_url, so the fragment
  // is carried to /mod here).
  const link = linkIn(await newestMail(E2E_MODERATOR_EMAIL))
  if (new URL(link).pathname !== '/auth/v1/verify') {
    // The template always links to the site's own /mod (locally the stack's site URL, not this
    // server's); the token is carried to this server's /mod the way it rides there: in the
    // fragment.
    const { hash } = new URL(link)
    expect(ourLink(link, '/mod')).toContain('#token_hash=')
    await page.goto(`/mod?case=${target.id}${hash}`)
    // The token never stays in the address bar; the linked case does.
    await expect.poll(() => page.url()).not.toContain('token_hash')
    expect(page.url()).toContain(`case=${target.id}`)
    await page.getByRole('button', { name: 'Finish signing in' }).click()
  } else {
    const verify = await fetch(link, { redirect: 'manual' })
    const location = verify.headers.get('location') ?? ''
    const fragment = location.slice(location.indexOf('#'))
    expect(fragment).toMatch(/access_token=/)
    await page.goto(`${baseURL ?? ''}/mod?case=${target.id}${fragment}`)
  }

  const kase = page.locator(`[data-mod-case="${target.id}"]`)
  await expect(kase).toBeVisible({ timeout: 20_000 })
  await expect(kase).toContainText('Note: kept following me around')
  await expect(kase).toContainText('Harassment or bullying')
  await kase.getByRole('combobox', { name: 'Reason' }).selectOption('harassment')
  await kase.getByRole('spinbutton', { name: 'Days' }).fill('3')
  await kase.getByRole('button', { name: 'Suspend' }).click()
  await expect(page.locator('[data-mod-status]')).toHaveText('Done: Suspend.')

  const rows = await sql<{ action: string; moderator_email: string; correlation_id: string }[]>`
    select a.action, u.email as moderator_email, a.correlation_id
    from private.moderation_audit a join auth.users u on u.id = a.moderator_id
    where a.case_id = ${target.id}
  `
  expect(rows).toEqual([
    {
      action: 'suspend',
      moderator_email: E2E_MODERATOR_EMAIL,
      correlation_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    },
  ])

  // Acting again on the resolved case is a clear 409, not a second action.
  await kase.getByRole('combobox', { name: 'Reason' }).selectOption('harassment')
  await kase.getByRole('button', { name: 'Ban' }).click()
  await expect(page.locator('[data-mod-error]')).toHaveText(
    'Someone already resolved this case. Reload the queue to see what changed.',
  )

  // The console keeps its own session; the game's account session is untouched.
  const storage = await page.evaluate(() => Object.keys(localStorage))
  expect(storage).toContain('cloutcity-mod-auth')
  expect(await gameKey()).toEqual(before)
})
