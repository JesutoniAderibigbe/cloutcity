import { expect, test } from './fixtures/test'
import { waitForMapSettled } from './helpers/scene'
import { database, newGuest, newPermanentUser } from './helpers/seed'
import { E2E_MODERATOR_EMAIL, localStack } from './helpers/stack'

// S18b part 2, opt-in (`npm run e2e:supabase`): the /mod console against the local stack. The
// test moderator (MODERATOR_EMAILS in playwright.supabase.config.ts) signs in through the link
// Mailpit caught, sees a seeded case with its note, suspends, and exactly one audit row exists;
// a confirmed non-moderator and a guest get 403; the /mod session never replaces the game's
// guest session on the same device.

// One project only: the test moderator's mailbox and the per-IP sign-in limit are shared.
test.skip(({ isMobile }) => !isMobile, 'runs once, on mobile-390')
test.use({ injectedConsoleErrors: [/status of 409/] })

const stack = localStack()
const sql = database(stack)
test.afterAll(async () => {
  await sql.end()
})

interface MailpitSearch {
  readonly messages: readonly { readonly ID: string }[]
}

/** The newest sign-in link sent to `email`, waiting for it to arrive. */
async function signInLink(email: string): Promise<string> {
  const query = encodeURIComponent(`to:"${email}"`)
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const search = (await (
      await fetch(`${stack.mailpitUrl}/api/v1/search?query=${query}`)
    ).json()) as MailpitSearch
    const id = search.messages[0]?.ID
    if (id !== undefined) {
      const message = (await (await fetch(`${stack.mailpitUrl}/api/v1/message/${id}`)).json()) as {
        Text: string
        HTML: string
      }
      const link = `${message.Text}\n${message.HTML}`
        .match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/)?.[0]
        ?.replaceAll('&amp;', '&')
      if (link !== undefined) return link
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`no sign-in email for ${email}`)
}

async function clearMail(email: string): Promise<void> {
  const query = encodeURIComponent(`to:"${email}"`)
  await fetch(`${stack.mailpitUrl}/api/v1/search?query=${query}`, { method: 'DELETE' })
}

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

test('the sign-in answer is the same for a moderator and anyone else', async ({ request }) => {
  const forMod = await request.post('/api/mod/sign-in', { data: { email: E2E_MODERATOR_EMAIL } })
  const forOther = await request.post('/api/mod/sign-in', {
    data: { email: `nobody-${crypto.randomUUID()}@example.test` },
  })
  expect(forMod.status()).toBe(202)
  expect(forOther.status()).toBe(202)
  expect(await forMod.json()).toEqual(await forOther.json())
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

  // A guest session in the game first, to prove /mod never replaces it.
  await page.addInitScript(() => {
    window.__CLOUTCITY_E2E__ = true
  })
  await page.goto('/')
  await waitForMapSettled(page)
  await expect
    .poll(() => page.evaluate(() => window.__cloutcityTest?.session?.state().status ?? null), {
      timeout: 20_000,
    })
    .toBe('anonymous')
  const guestKey = () =>
    page.evaluate(() => {
      const key = Object.keys(localStorage).find((name) => /^sb-.+-auth-token$/.test(name))
      return key === undefined ? null : [key, localStorage.getItem(key)]
    })
  const before = await guestKey()
  expect(before).not.toBeNull()

  await clearMail(E2E_MODERATOR_EMAIL)
  await page.goto('/mod')
  await page.getByRole('textbox', { name: 'Email' }).fill(E2E_MODERATOR_EMAIL)
  await page.getByRole('button', { name: 'Send sign-in link' }).click()
  await expect(page.getByRole('status').first()).toContainText('a sign-in link is on its way')

  // The link verifies and redirects with the session in the URL fragment. Locally the redirect
  // goes to the stack's site_url (supabase/config.toml), so the fragment is carried to /mod here.
  const verify = await fetch(await signInLink(E2E_MODERATOR_EMAIL), { redirect: 'manual' })
  const location = verify.headers.get('location') ?? ''
  const fragment = location.slice(location.indexOf('#'))
  expect(fragment).toMatch(/access_token=/)
  await page.goto(`${baseURL ?? ''}/mod?case=${target.id}${fragment}`)

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

  // The console keeps its own session; the game's guest session is untouched.
  const storage = await page.evaluate(() => Object.keys(localStorage))
  expect(storage).toContain('cloutcity-mod-auth')
  expect(await guestKey()).toEqual(before)
})
