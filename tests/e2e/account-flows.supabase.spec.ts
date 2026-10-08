import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures/test'
import {
  accountSheet,
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
  storedUserId,
  waitSynced,
} from './helpers/account'
import { clearMail } from './helpers/mail'
import { database } from './helpers/seed'
import { localStack } from './helpers/stack'

// S19 honest flows, opt-in (`npm run e2e:supabase`; from the security review's hunt): keeping
// this device's game in a conflict, a signed-out game meeting another (empty) account with both
// choices, and signing out offline with unsent progress (the device signs out anyway, no token
// left behind).

test.skip(({ isMobile }) => !isMobile, 'runs once, on mobile-390')
test.use({ onboarding: 'fresh' })

const START_CASH = (
  JSON.parse(readFileSync(join(import.meta.dirname, '../../data/config/balance.json'), 'utf8')) as {
    start: { cash: number }
  }
).start.cash

const stack = localStack()
let sql: ReturnType<typeof database>
test.beforeAll(() => {
  sql = database(stack)
})
test.afterAll(async () => {
  await sql.end()
})

async function cloudCash(id: string) {
  const rows = await sql<{ cash: number }[]>`
    select (data->'player'->>'cash')::numeric::float8 as cash from public.saves where user_id = ${id}`
  return rows[0]?.cash ?? null
}

async function openCloudPanel(page: Page): Promise<void> {
  const chip = page.locator('[data-hud-panel="cloud"]')
  if (await chip.isVisible()) {
    await chip.click()
    return
  }
  await page.locator('[data-hud-panel="more"]').click()
  await page.locator('[data-more-item="cloud"]').click()
}

async function buyBreakfast(page: Page) {
  await page.evaluate(() => {
    const places = window.__cloutcityPlaces
    if (places === undefined) throw new Error('place test hook is not installed')
    places.setTimeOfDay(9 * 60)
    places.setLocation('late-lantern-deli')
    if (!places.open('late-lantern-deli')) throw new Error('no late-lantern-deli')
  })
  await page
    .locator('[data-place-sheet="late-lantern-deli"]')
    .getByRole('button', { name: /^Breakfast sandwich/ })
    .click()
  await page
    .locator('[data-place-sheet="late-lantern-deli"]')
    .getByRole('button', { name: /^Close/ })
    .click()
}

async function accountWithProgress(page: Page) {
  await bootGuest(page)
  await reachFirstMilestone(page)
  await waitSynced(page)
  const email = freshEmail()
  await saveProgressByEmail(page, await page.context().newPage(), email)
  await nudgeUpgradeCheck(page)
  await expect.poll(() => sessionStatus(page), { timeout: 40_000 }).toBe('permanent')
  await waitSynced(page)
  return { email, id: (await storedUserId(page)) ?? '', cash: (await playerState(page)).cash }
}

async function loginFromMe(
  page: Page,
  email: string,
  button: 'Have an account? Log in' | 'Log in',
) {
  await meTab(page).click()
  await page
    .getByRole('dialog', { name: 'Me' })
    .getByRole('button', { name: button, exact: true })
    .click()
  const sheet = accountSheet(page, 'Log in')
  await clearMail(email)
  await sheet.getByRole('textbox', { name: 'Email' }).fill(email)
  await sheet.getByRole('button', { name: 'Email me a link and code' }).click()
  await sheet
    .getByRole('textbox', { name: 'Or type the 6-digit code' })
    .fill(await loginCode(email))
  await sheet.getByRole('button', { name: 'Log in with code' }).click()
  await expect(sheet.locator('[data-account-done="login"]')).toBeVisible()
  await page.keyboard.press('Escape')
}

const syncOf = (page: Page) =>
  page.locator('[data-sync-status]').first().getAttribute('data-sync-status')

test('conflict: keep this device', async ({ page, browser }) => {
  test.setTimeout(180_000)
  const account = await accountWithProgress(page)
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const other = await phone.newPage()
  await bootGuest(other)
  await buyBreakfast(other)
  await waitSynced(other)
  const mine = (await playerState(other)).cash
  await loginFromMe(other, account.email, 'Have an account? Log in')
  await expect.poll(() => syncOf(other), { timeout: 30_000 }).toBe('conflict')
  await openCloudPanel(other)
  await other
    .getByRole('dialog', { name: 'Cloud save' })
    .getByRole('button', { name: "Keep this device's game" })
    .click()
  await expect.poll(() => cloudCash(account.id), { timeout: 30_000 }).toBe(mine)
  await phone.close()
})

for (const choice of ["Keep this device's game", 'Start fresh on this account'] as const) {
  test(`signed-out game into another (empty) account asks: ${choice}`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(180_000)
    const a = await accountWithProgress(page)
    await meTab(page).click()
    const me = page.getByRole('dialog', { name: 'Me' })
    await me.getByRole('button', { name: 'Sign out' }).click()
    await expect(me.locator('[data-me-account="signed-out"]')).toBeVisible()
    await page.keyboard.press('Escape')
    const b = await newSavedAccount(stack, `${baseURL ?? ''}/auth/callback`)
    await loginFromMe(page, b.email, 'Log in')
    await expect.poll(() => syncOf(page), { timeout: 30_000 }).toBe('conflict')
    await openCloudPanel(page)
    const panel = page.getByRole('dialog', { name: 'Cloud save' })
    await expect(panel).toContainText('This device has a game from another account.')
    await panel.getByRole('button', { name: choice }).click()
    const expected = choice === 'Start fresh on this account' ? START_CASH : a.cash
    await expect.poll(() => cloudCash(b.id), { timeout: 30_000 }).toBe(expected)
    expect((await playerState(page)).cash).toBe(expected)
    expect(await cloudCash(a.id)).toBe(a.cash)
  })
}

test.describe('offline', () => {
  // Offline, the browser logs each request it could not send (the profile read, a page prefetch,
  // the sign-out call): expected here, nothing else is.
  test.use({ injectedConsoleErrors: [/net::ERR_INTERNET_DISCONNECTED/] })

  test('sign-out with unsent progress, and offline', async ({ page, context }) => {
    test.setTimeout(180_000)
    await accountWithProgress(page)
    await context.setOffline(true)
    await buyBreakfast(page)
    await meTab(page).click()
    const me = page.getByRole('dialog', { name: 'Me' })
    await me.getByRole('button', { name: 'Sign out' }).click()
    await expect(me.getByText("Some progress hasn't reached your account yet")).toBeVisible({
      timeout: 30_000,
    })
    await me.getByRole('button', { name: 'Sign out anyway' }).click()
    await page.waitForTimeout(3000)
    const offlineResult = {
      signedOutView: await me.locator('[data-me-account="signed-out"]').count(),
      status: await sessionStatus(page),
      tokenStillStored: (await storedUserId(page)) !== null,
      alert: await me.locator('[role=status], [role=alert]').allInnerTexts(),
    }
    await context.setOffline(false)
    expect(offlineResult.tokenStillStored).toBe(false)
  })
})
