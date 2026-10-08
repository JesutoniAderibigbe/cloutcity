import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures/test'
import { welcomeDialog } from './fixtures/welcome'
import {
  accountSheet,
  bootGame,
  bootGuest,
  freshEmail,
  loginCode,
  meTab,
  newSavedAccount,
  nudgeUpgradeCheck,
  playerState,
  reachFirstMilestone,
  saveProgressByEmail,
  sessionStatus,
  waitSynced,
} from './helpers/account'
import { clearMail } from './helpers/mail'
import { database } from './helpers/seed'
import { localStack } from './helpers/stack'

// S19, opt-in (`npm run e2e:supabase`): a saved account logs in on a new device from the
// welcome card by the emailed 6-digit code and gets its game back (the card asks only the sound
// choice: the server holds its 18+ check); a guest with progress who logs in to an account with
// progress picks the game to keep; an email that already has an account turns "Create account"
// into "Log in" with the email as typed; signing out keeps the game on the device and never
// makes a new guest on the next boot, until the player starts one.

test.skip(({ isMobile }) => !isMobile, 'runs once, on mobile-390')
test.use({ onboarding: 'fresh' })

const START_CASH = (
  JSON.parse(readFileSync(join(import.meta.dirname, '../../data/config/balance.json'), 'utf8')) as {
    start: { cash: number }
  }
).start.cash

/** Opens the cloud save panel: the HUD chip where it shows, else the More panel's row. */
async function openCloudPanel(page: Page): Promise<void> {
  const chip = page.locator('[data-hud-panel="cloud"]')
  if (await chip.isVisible()) {
    await chip.click()
    return
  }
  await page.locator('[data-hud-panel="more"]').click()
  await page.locator('[data-more-item="cloud"]').click()
}

const stack = localStack()
let sql: ReturnType<typeof database>
test.beforeAll(() => {
  sql = database(stack)
})
test.afterAll(async () => {
  await sql.end()
})

/** A saved account with a played game in the cloud, made through the game on its own device. */
async function accountWithProgress(page: Page): Promise<{ email: string; cash: number }> {
  await bootGuest(page)
  await reachFirstMilestone(page)
  await waitSynced(page)
  const email = freshEmail()
  await saveProgressByEmail(page, await page.context().newPage(), email)
  await nudgeUpgradeCheck(page)
  await expect.poll(() => sessionStatus(page), { timeout: 40_000 }).toBe('permanent')
  await waitSynced(page)
  return { email, cash: (await playerState(page)).cash }
}

test('a new device logs in by code from the welcome card and gets the account game', async ({
  page,
  browser,
  checkA11y,
}) => {
  test.setTimeout(180_000)
  const account = await accountWithProgress(page)

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const other = await phone.newPage()
  await bootGame(other, { fresh: false })
  await welcomeDialog(other).getByRole('button', { name: 'Have an account? Log in' }).click()
  const login = other.getByRole('dialog', { name: 'Log in to Clout City' })
  await clearMail(account.email)
  await login.getByRole('textbox', { name: 'Email' }).fill(account.email)
  await login.getByRole('button', { name: 'Email me a link and code' }).click()
  await expect(login.getByRole('heading', { name: 'Check your inbox' })).toBeVisible()
  const code = login.getByRole('textbox', { name: 'Or type the 6-digit code' })
  await expect(code).toHaveAttribute('autocomplete', 'one-time-code')
  await expect(code).toHaveAttribute('inputmode', 'numeric')
  await code.fill(await loginCode(account.email))
  await login.getByRole('button', { name: 'Log in with code' }).click()

  // The account's 18+ check is the server's: only the sound choice is asked.
  const card = welcomeDialog(other)
  await expect(card).toContainText("You're logged in. Last thing: how do you want the sound?")
  await expect(card.getByRole('combobox', { name: 'Year you were born' })).toHaveCount(0)
  await expect(card.getByRole('checkbox')).toHaveCount(0)
  await checkA11y()
  await card.getByRole('radio', { name: "I'll bring my own" }).check()
  await card.getByRole('button', { name: 'Start playing' }).click()
  await expect(card).toHaveCount(0)
  await expect.poll(() => sessionStatus(other), { timeout: 20_000 }).toBe('permanent')
  await waitSynced(other)
  expect((await playerState(other)).cash).toBe(account.cash)
  await phone.close()
})

test('a guest with progress logging in to an account with progress picks the game to keep', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000)
  const account = await accountWithProgress(page)

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const other = await phone.newPage()
  await bootGuest(other)
  await other.evaluate(() => {
    const places = window.__cloutcityPlaces
    if (places === undefined) throw new Error('place test hook is not installed')
    places.setTimeOfDay(9 * 60)
    places.setLocation('late-lantern-deli')
    if (!places.open('late-lantern-deli')) throw new Error('no late-lantern-deli')
  })
  await other
    .locator('[data-place-sheet="late-lantern-deli"]')
    .getByRole('button', { name: /^Breakfast sandwich/ })
    .click()
  await waitSynced(other)
  const mine = (await playerState(other)).cash
  expect(mine).not.toBe(account.cash)

  await meTab(other).click()
  await other
    .getByRole('dialog', { name: 'Me' })
    .getByRole('button', { name: 'Have an account? Log in' })
    .click()
  const sheet = accountSheet(other, 'Log in')
  await expect(sheet).toContainText('This device switches to your account.')
  await clearMail(account.email)
  await sheet.getByRole('textbox', { name: 'Email' }).fill(account.email)
  await sheet.getByRole('button', { name: 'Email me a link and code' }).click()
  await sheet
    .getByRole('textbox', { name: 'Or type the 6-digit code' })
    .fill(await loginCode(account.email))
  await sheet.getByRole('button', { name: 'Log in with code' }).click()
  await expect(sheet.locator('[data-account-done="login"]')).toBeVisible()
  await expect.poll(() => sessionStatus(other), { timeout: 20_000 }).toBe('permanent')

  // Both have progress: nothing is overwritten until the player picks.
  await expect
    .poll(() => other.locator('[data-sync-status]').first().getAttribute('data-sync-status'), {
      timeout: 30_000,
    })
    .toBe('conflict')
  expect((await playerState(other)).cash).toBe(mine)
  await openCloudPanel(other)
  const panel = other.getByRole('dialog', { name: 'Cloud save' })
  await expect(panel).toContainText("a guest game on this device can't be recovered after this")
  await panel.getByRole('button', { name: 'Use the account game' }).click()
  await expect.poll(async () => (await playerState(other)).cash).toBe(account.cash)
  await phone.close()
})

test.describe('an email already in use', () => {
  // GoTrue answers the email change with 422 email_exists; the browser logs that response.
  test.use({ injectedConsoleErrors: [/status of 422/] })

  test('an email that already has an account turns saving into logging in, as typed', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90_000)
    const { email } = await newSavedAccount(stack, `${baseURL ?? ''}/auth/callback`)
    await bootGuest(page)
    await meTab(page).click()
    await page
      .getByRole('dialog', { name: 'Me' })
      .getByRole('button', { name: 'Create account' })
      .click()
    const sheet = accountSheet(page, 'Create account')
    await sheet.getByRole('textbox', { name: 'Email' }).fill(` ${email}`)
    await sheet.getByRole('button', { name: 'Send my link' }).click()
    await expect(sheet.getByText('That email already has an account.')).toBeVisible()
    await sheet.getByRole('button', { name: 'Log in instead' }).click()
    const login = accountSheet(page, 'Log in')
    await expect(login.getByRole('textbox', { name: 'Email' })).toHaveValue(email)
  })
})

test('signing out keeps the game here and never makes a new guest until asked', async ({
  page,
}) => {
  test.setTimeout(150_000)
  const signUps: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/auth/v1/signup') signUps.push(request.url())
  })
  const account = await accountWithProgress(page)
  expect(signUps).toHaveLength(1)

  await meTab(page).click()
  const me = page.getByRole('dialog', { name: 'Me' })
  await me.getByRole('button', { name: 'Sign out' }).click()
  await expect(me.locator('[data-me-account="signed-out"]')).toBeVisible()
  await expect.poll(() => sessionStatus(page)).toBe('local')
  expect((await playerState(page)).cash).toBe(account.cash)
  await expect(page.locator('[data-sync-status]').first()).toHaveAttribute(
    'data-sync-status',
    'signedOut',
  )

  await page.reload()
  await expect
    .poll(() => page.evaluate(() => window.__cloutcityTest?.session?.state().reason ?? null), {
      timeout: 20_000,
    })
    .toBe('signed-out')
  expect(signUps).toHaveLength(1)
  expect((await playerState(page)).cash).toBe(account.cash)

  await meTab(page).click()
  await me.getByRole('button', { name: 'Start a new guest game' }).click()
  await me.getByRole('button', { name: 'Start over' }).click()
  await expect.poll(() => sessionStatus(page), { timeout: 30_000 }).toBe('anonymous')
  expect(signUps).toHaveLength(2)
  expect((await playerState(page)).cash).toBe(START_CASH)
  const [owned] = await sql<{ count: number }[]>`
    select count(*)::int as count from auth.users where email = ${account.email}
  `
  expect(owned?.count).toBe(1)
})
