import type { Page } from '@playwright/test'
import { expect, test } from './fixtures/test'
import { lockDialog, YEAR } from './fixtures/welcome'
import {
  authScreen,
  chooseSound,
  fillSignUp,
  freshEmail,
  freshUsername,
  landing,
  logInThroughUi,
  meTab,
  newSavedAccount,
  openGame,
  PASSWORD,
  sessionStatus,
  signUpThroughUi,
  skipCreator,
  storedUserId,
  waitSynced,
} from './helpers/account'
import { waitForMapSettled } from './helpers/scene'
import {
  SERVICE_WORKER_PATH,
  geoCacheUrls,
  reloadControlled,
  waitForActiveWorker,
  warmUrlsFromWorker,
} from './helpers/serviceWorker'
import { localStack } from './helpers/stack'

// DEC-61 / DEC-62, opt-in (`npm run e2e:supabase`): onboarding like Lagos Life against the local
// stack. A visitor lands on the live city with Sign up / Log in and no guest; signing up
// (username, email, password, 18+ year, consent, then sound) opens the character creator, and
// closing it lands in the room; signing out brings the landing back; logging in by username or
// email (on another device) restores the account's game; one answer for every wrong pair; an
// under-18 answer locks the device with no account made; a taken email is refused inline; and a
// first visit offline says a connection is needed. The stack is shared: only new users.

test.use({
  onboarding: 'fresh',
  // A refused sign-up or log-in is an HTTP error the browser itself logs.
  injectedConsoleErrors: [/status of (400|401|422) /],
})

const stack = localStack()
const authError = (page: Page) => authScreen(page).locator('[data-auth-error], [role="alert"]')

test('sign up, the creator, the room; sign out to the landing; log in by username', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await openGame(page)
  await expect(landing(page)).toBeVisible({ timeout: 20_000 })
  await expect(landing(page).locator('[data-landing="signup"]')).toHaveText('Sign up free')
  await expect(landing(page).locator('[data-landing="login"]')).toHaveText('Log in')
  expect(await sessionStatus(page)).not.toBe('anonymous')

  const account = await signUpThroughUi(page)
  const userId = await storedUserId(page)
  // The creator opens straight away, on Look.
  await expect(page.locator('[data-creator-step="look"]')).toBeVisible({ timeout: 20_000 })
  await skipCreator(page)
  await waitForMapSettled(page)

  // Sign out from the Me tab: the landing comes back, and no guest is made.
  await meTab(page).click()
  const me = page.getByRole('dialog', { name: 'Me' })
  await expect(me.locator('[data-me-account]')).toContainText('Signed in as')
  await me.getByRole('button', { name: 'Sign out' }).click()
  await expect(landing(page)).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => storedUserId(page)).toBeNull()

  // Log in by username: the same account, back in the game.
  await logInThroughUi(page, account.username)
  await chooseSound(page)
  await expect.poll(() => sessionStatus(page), { timeout: 20_000 }).toBe('permanent')
  expect(await storedUserId(page)).toBe(userId)
  // No creator record yet: the creator opens.
  await expect(page.locator('[data-creator-step]')).toBeVisible({ timeout: 20_000 })
})

test('log in by email on another device restores the cloud save', async ({ page, browser }) => {
  test.setTimeout(180_000)
  await openGame(page)
  const account = await signUpThroughUi(page)
  await skipCreator(page)
  await waitForMapSettled(page)
  // A change the server accepts as plausible (S18c), synced to the account.
  await page.waitForFunction(() => window.__cloutcityTest?.hud !== undefined)
  await page.evaluate(() => window.__cloutcityTest?.hud?.setEnergy(42))
  await waitSynced(page)

  const other = await browser.newContext()
  const device = await other.newPage()
  try {
    await openGame(device)
    await expect(landing(device)).toBeVisible({ timeout: 20_000 })
    await logInThroughUi(device, account.email)
    await chooseSound(device)
    await expect.poll(() => sessionStatus(device), { timeout: 20_000 }).toBe('permanent')
    await expect
      .poll(
        () =>
          device.evaluate(
            () =>
              JSON.parse(localStorage.getItem('cloutcity:game') ?? '{}').state?.player?.stats
                ?.energy,
          ),
        { timeout: 30_000 },
      )
      .toBe(42)
  } finally {
    await other.close()
  }
})

test('every wrong pair gets one answer; a taken email is refused inline', async ({ page }) => {
  test.setTimeout(120_000)
  const saved = await newSavedAccount(stack)
  await openGame(page)
  await expect(landing(page)).toBeVisible({ timeout: 20_000 })

  const answers: string[] = []
  for (const [identifier, password] of [
    [saved.username, 'not the password'],
    [freshUsername(), PASSWORD],
    [saved.email, 'not the password'],
  ] as const) {
    await logInThroughUi(page, identifier, password)
    await expect(authError(page)).toBeVisible()
    answers.push((await authError(page).textContent()) ?? '')
  }
  expect(new Set(answers).size).toBe(1)
  expect(answers[0]).toBe("That username or email and password don't match.")

  await fillSignUp(page, { email: saved.email })
  const email = page.locator('[data-auth-form="signup"]').getByRole('textbox', { name: 'Email' })
  await expect(email).toHaveAttribute('aria-invalid', 'true')
  await expect(page.locator('[data-auth-form="signup"]')).toContainText(
    'That email already has an account. Log in instead.',
  )
})

test('an under-18 answer locks the device and makes no account', async ({ page }) => {
  const signUps: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/auth/v1/signup') signUps.push(request.url())
  })
  await openGame(page)
  await expect(landing(page)).toBeVisible({ timeout: 20_000 })
  await fillSignUp(page, { birthYear: YEAR - 15, email: freshEmail() })
  await expect(lockDialog(page)).toBeVisible()
  expect(signUps).toEqual([])
  await page.reload()
  await expect(lockDialog(page)).toBeVisible()
})

test.describe('offline', () => {
  test.use({ serviceWorkers: 'allow' })

  // The page has loaded once (the service worker holds the shell), but nobody has signed up on
  // this device: offline, the landing says an account needs a connection.
  test('a first visit offline says a connection is needed', async ({ page, context, request }) => {
    test.setTimeout(120_000)
    const warm = warmUrlsFromWorker(await (await request.get(SERVICE_WORKER_PATH)).text())
    await openGame(page)
    await expect(landing(page)).toBeVisible({ timeout: 20_000 })
    await waitForActiveWorker(page)
    await expect
      .poll(async () => {
        const cached = await geoCacheUrls(page)
        return warm.low.filter((url) => !cached.includes(url))
      })
      .toEqual([])
    await reloadControlled(page)
    await expect(landing(page)).toBeVisible({ timeout: 20_000 })
    await waitForMapSettled(page)

    await context.setOffline(true)
    await page.reload()
    await expect(landing(page).locator('[data-landing-offline]')).toHaveText(
      'You need a connection to create your account.',
      { timeout: 20_000 },
    )
    // The landing still works: the city plays behind it; the forms load once back online (their
    // chunk is optional, PERF-7, as it needs the network anyway).
    await waitForMapSettled(page)
    await context.setOffline(false)
  })
})
