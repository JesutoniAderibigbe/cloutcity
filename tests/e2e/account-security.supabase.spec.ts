import { createClient } from '@supabase/supabase-js'
import { expect, test } from './fixtures/test'
import { answerWelcomeCard, welcomeDialog, YEAR } from './fixtures/welcome'
import {
  accountSheet,
  bootGame,
  bootGuest,
  finishLink,
  freshEmail,
  meTab,
  newSavedAccount,
  reachFirstMilestone,
  sessionStatus,
  storedUserId,
  waitSynced,
} from './helpers/account'
import { clearMail, linkFragment, linkIn, newestMail } from './helpers/mail'
import { database } from './helpers/seed'
import { localStack } from './helpers/stack'

// S19 security review (F1, F2, F5), opt-in (`npm run e2e:supabase`): a link someone else
// requested never moves this device, or its game, into their account.
//  - F1 session fixation: an attacker's guest asks to save with the victim's address; the victim
//    taps the link. The address is confirmed, but the victim's browser never takes the attacker's
//    account, and the victim's game never reaches it.
//  - F2 login CSRF: an attacker sends a log-in link for their own account. The victim's browser
//    asks "Log in as …?" first; even on yes, a played guest game is never uploaded silently.
//  - F5: /auth/callback is a static, never-stored page; the token never reaches the server.

test.skip(({ isMobile }) => !isMobile, 'runs once, on mobile-390')
test.use({ onboarding: 'fresh' })

const stack = localStack()
let sql: ReturnType<typeof database>
test.beforeAll(() => {
  sql = database(stack)
})
test.afterAll(async () => {
  await sql.end()
})

function memoryClient() {
  const memory = new Map<string, string>()
  return createClient(stack.apiUrl, stack.anonKey, {
    auth: {
      flowType: 'pkce',
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: {
        getItem: (key) => memory.get(key) ?? null,
        setItem: (key, value) => void memory.set(key, value),
        removeItem: (key) => void memory.delete(key),
      },
    },
  })
}

/** A log-in link for `email`, requested from somewhere else (not the victim's browser). */
async function foreignLoginLink(email: string, callback: string): Promise<string> {
  await clearMail(email)
  const { error } = await memoryClient().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: callback },
  })
  if (error !== null) throw error
  return linkIn(await newestMail(email))
}

async function cloudOf(id: string) {
  const rows = await sql<{ cash: number | null }[]>`
    select (data->'player'->>'cash')::numeric::float8 as cash
    from public.saves where user_id = ${id}`
  return rows[0] ?? null
}

const syncOf = (page: import('@playwright/test').Page) =>
  page.locator('[data-sync-status]').first().getAttribute('data-sync-status')

test("F2: a log-in link this browser did not ask for asks first; 'Not me' changes nothing", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(150_000)
  const callback = `${baseURL ?? ''}/auth/callback`
  const attacker = await newSavedAccount(stack, callback)
  const link = await foreignLoginLink(attacker.email, callback)

  await bootGuest(page)
  const victim = await storedUserId(page)
  await finishLink(page, link, 'Tap to finish logging in')
  const callbackPage = page.locator('[data-auth-callback]')
  await expect(
    page.getByRole('heading', { name: /^Log in as .•••@example\.test\?$/ }),
  ).toBeVisible()
  await expect(callbackPage).toContainText("Didn't ask to log in? Tap Not me.")
  await page.getByRole('button', { name: 'Not me' }).click()
  await expect(page.getByRole('heading', { name: 'Not logged in' })).toBeVisible()
  expect(await storedUserId(page)).toBe(victim)
})

test("F2: even on yes, a played guest game never lands in the link's account silently", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(180_000)
  const callback = `${baseURL ?? ''}/auth/callback`
  const attacker = await newSavedAccount(stack, callback)
  const link = await foreignLoginLink(attacker.email, callback)

  await bootGuest(page)
  await reachFirstMilestone(page)
  await waitSynced(page)
  await finishLink(page, link, 'Tap to finish logging in')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await page.locator('[data-auth-back]').click()
  await expect.poll(() => sessionStatus(page), { timeout: 30_000 }).toBe('permanent')
  expect(await storedUserId(page)).toBe(attacker.id)
  await expect.poll(() => syncOf(page), { timeout: 30_000 }).toBe('conflict')
  expect(await cloudOf(attacker.id)).toBeNull()
})

test('F1 and pre-hijack: a save link someone else asked for is never used here, nor moves this device', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(180_000)
  const callback = `${baseURL ?? ''}/auth/callback`
  const victimEmail = freshEmail()
  const attacker = memoryClient()
  const { data } = await attacker.auth.signInAnonymously()
  const attackerId = data.user?.id ?? ''
  const now = Date.now()
  await attacker.rpc('attest_and_consent', {
    p_adult: true,
    p_attested_at: new Date(now - 60_000).toISOString(),
    p_consent_version: '2026-10-06',
    p_consented_at: new Date(now - 60_000).toISOString(),
    p_audio_choice: 'ours',
  })
  await clearMail(victimEmail)
  const up = await attacker.auth.updateUser({ email: victimEmail }, { emailRedirectTo: callback })
  expect(up.error).toBeNull()
  const link = linkIn(await newestMail(victimEmail))

  await bootGuest(page)
  await reachFirstMilestone(page)
  await waitSynced(page)
  const victim = await storedUserId(page)
  await finishLink(page, link, 'Tap to save your progress')
  // Not the device that asked to save with this address: the token is not even used.
  await expect(page.getByRole('heading', { name: 'Finish on your device' })).toBeVisible()
  const refreshed = await attacker.auth.refreshSession()
  expect(refreshed.data.user?.is_anonymous).toBe(true)
  expect(refreshed.data.user?.email ?? '').toBe('')
  await page.locator('[data-auth-back]').click()
  await expect.poll(() => sessionStatus(page), { timeout: 30_000 }).toBe('anonymous')
  expect(await storedUserId(page)).toBe(victim)
  await waitSynced(page)
  // The victim's game is in the victim's own guest account, never the attacker's.
  expect(await cloudOf(attackerId)).toBeNull()
  expect(await cloudOf(victim ?? '')).not.toBeNull()
})

test.describe('X1', () => {
  // The log-in request for an address with no account is refused by GoTrue (422 otp_disabled);
  // the browser logs that response.
  test.use({ injectedConsoleErrors: [/status of 422/] })

  test("X1 (N1): a forged log-in link within an hour of this browser's own request still asks", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(240_000)
    const callback = `${baseURL ?? ''}/auth/callback`
    const attacker = await newSavedAccount(stack, callback, `zz-${freshEmail()}`)
    const forged = await foreignLoginLink(attacker.email, callback)
    const hash = linkFragment(forged).get('token_hash') ?? ''
    const victim = await newSavedAccount(stack, callback, `aa-${freshEmail()}`)

    await bootGuest(page)
    await reachFirstMilestone(page)
    await waitSynced(page)
    const guest = await storedUserId(page)

    // A log-in for an address with no account sends nothing, so it leaves no mark.
    await meTab(page).click()
    await page
      .getByRole('dialog', { name: 'Me' })
      .getByRole('button', { name: 'Have an account? Log in' })
      .click()
    const sheet = accountSheet(page, 'Log in')
    await sheet.getByRole('textbox', { name: 'Email' }).fill(freshEmail())
    await sheet.getByRole('button', { name: 'Email me a link and code' }).click()
    await expect(sheet.getByText('No account uses that email yet.', { exact: false })).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('cloutcity:login-requested'))).toBeNull()

    // A real request for the victim's own account marks this browser, with no address in it.
    await clearMail(victim.email)
    await sheet.getByRole('textbox', { name: 'Email' }).fill(victim.email)
    await sheet.getByRole('button', { name: 'Email me a link and code' }).click()
    await expect(sheet.getByRole('heading', { name: 'Check your inbox' })).toBeVisible()
    const mark = await page.evaluate(() => localStorage.getItem('cloutcity:login-requested'))
    expect(mark).not.toBeNull()
    expect(mark).not.toContain('@')

    // The forged link names the victim's address in its fragment: never shown, never trusted.
    await page.goto(
      `/auth/callback#token_hash=${hash}&type=email&email=${encodeURIComponent(victim.email)}`,
    )
    await expect(page.getByRole('heading', { name: 'Tap to finish logging in' })).toBeVisible()
    await expect(page.locator('[data-auth-for]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Finish' }).click()
    // The server's address (the attacker's), not the fragment's.
    await expect(page.getByRole('heading', { name: 'Log in as z•••@example.test?' })).toBeVisible()
    expect(await storedUserId(page)).toBe(guest)
    await page.getByRole('button', { name: 'Not me' }).click()
    await expect(page.getByRole('heading', { name: 'Not logged in' })).toBeVisible()
    expect(await storedUserId(page)).toBe(guest)
    expect(await cloudOf(attacker.id)).toBeNull()
  })
})

test('N1: the log-in link this browser asked for, for that address, is taken without asking', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(150_000)
  const callback = `${baseURL ?? ''}/auth/callback`
  const account = await newSavedAccount(stack, callback)
  await bootGuest(page)
  await meTab(page).click()
  await page
    .getByRole('dialog', { name: 'Me' })
    .getByRole('button', { name: 'Have an account? Log in' })
    .click()
  const sheet = accountSheet(page, 'Log in')
  await clearMail(account.email)
  await sheet.getByRole('textbox', { name: 'Email' }).fill(account.email)
  await sheet.getByRole('button', { name: 'Email me a link and code' }).click()
  await expect(sheet.getByRole('heading', { name: 'Check your inbox' })).toBeVisible()
  await finishLink(page, linkIn(await newestMail(account.email)), 'Tap to finish logging in')
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  expect(await storedUserId(page)).toBe(account.id)
})

test('F8 (recorded): an under-18 answer after a log-in drops the session from the device', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000)
  const callback = `${baseURL ?? ''}/auth/callback`
  const email = freshEmail()
  const svc = createClient(stack.apiUrl, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const created = await svc.auth.admin.createUser({ email, email_confirm: true })
  const id = created.data.user?.id ?? ''
  const link = await foreignLoginLink(email, callback)

  await bootGame(page, { fresh: false })
  await finishLink(page, link, 'Tap to finish logging in')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await page.locator('[data-auth-back]').click()
  await expect(welcomeDialog(page)).toBeVisible()
  await answerWelcomeCard(page, { birthYear: YEAR - 15, consent: true, audio: "I'll bring my own" })
  await expect.poll(() => storedUserId(page), { timeout: 15_000 }).toBeNull()
  const [profile] = await sql<{ attested: boolean | null }[]>`
    select attested from public.profiles where id = ${id}`
  expect(profile?.attested ?? false).toBe(false)
})

test('F5: /auth/callback is a static page, never stored, that sends no Referer', async ({
  request,
}) => {
  const response = await request.get('/auth/callback')
  const headers = response.headers()
  expect(headers['cache-control']).toContain('no-store')
  expect(headers['referrer-policy']).toBe('no-referrer')
  expect(headers['x-robots-tag']).toBe('noindex')
  expect(await response.text()).toMatch(/<meta name="referrer" content="no-referrer"/)
})

test('F5: a token hash in the query is refused, and wiped from the address bar', async ({
  page,
}) => {
  await page.goto('/auth/callback?token_hash=abcdefgh123&type=email')
  await expect(page.getByRole('heading', { name: /^That link isn't complete/ })).toBeVisible()
  expect(page.url()).not.toContain('token_hash')
  await expect(page.locator('[data-auth-back]')).toHaveAttribute('href', '/')
})
