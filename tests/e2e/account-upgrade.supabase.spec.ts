import { expect, test } from './fixtures/test'
import { answerWelcomeCard, welcomeDialog, YEAR } from './fixtures/welcome'
import {
  accountSheet,
  bootGame,
  bootGuest,
  finishLink,
  freshEmail,
  meTab,
  nudgeUpgradeCheck,
  playerState,
  reachFirstMilestone,
  sessionStatus,
  storedUserId,
} from './helpers/account'
import { clearMail, linkIn, newestMail } from './helpers/mail'
import { database } from './helpers/seed'
import { localStack } from './helpers/stack'

// S19, opt-in (`npm run e2e:supabase`): a guest who reaches their first milestone is prompted to
// save their progress, with the warning that clearing browser data loses a guest game; saving
// by email (the shared form pattern) goes through the link Mailpit caught, finished by a tap on
// /auth/callback; the same user, cash and clout carry over, here or confirmed on another device.
// The Google button asks GoTrue to link with PKCE (the real round trip is a manual check). The
// welcome card's "Create account" opens the save sheet once the card is done; a guest's level-up
// nudges them to save.

// One project only: the shared stack's per-IP sign-in and verification limits.
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

const banner = (page: import('@playwright/test').Page) =>
  page.locator('[data-overlay-zone="banner"] [data-cc-notice="save-progress"]')

test.describe('saving by email', () => {
  // A reload right after an upload sends the page-leave keepalive upload inside the server's
  // upload interval, which it refuses with a 429 (S18c; the next upload carries the change).
  test.use({ injectedConsoleErrors: [/status of 429/] })

  test('after the first milestone a guest saves by email link and keeps their game', async ({
    page,
    context,
    checkA11y,
  }) => {
    test.setTimeout(150_000)
    await bootGuest(page)
    const userId = await storedUserId(page)
    expect(userId).not.toBeNull()

    // No prompt before the first milestone; the Me tab offers saving any time, with the warning.
    await expect(banner(page)).toHaveCount(0)
    await meTab(page).click()
    const me = page.getByRole('dialog', { name: 'Me' })
    await expect(me.locator('[data-me-account="guest"]')).toContainText('Playing as a guest')
    await expect(me).toContainText('Clearing your browser data wipes a guest game.')
    await me.getByRole('button', { name: 'Close Me' }).click()

    await reachFirstMilestone(page)
    await expect(banner(page)).toBeVisible()
    await expect(banner(page)).toContainText('Clearing your browser wipes a guest game.')
    await banner(page).getByRole('button', { name: 'Create account' }).click()

    const sheet = accountSheet(page, 'Create account')
    await expect(sheet).toBeVisible()
    await expect(banner(page)).toHaveCount(0)
    await expect(sheet.locator('[data-account-warning]')).toHaveText(
      'Clearing your browser data wipes a guest game.',
    )
    await expect(sheet.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
    await expect(sheet.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms')
    await expect(sheet.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
      'href',
      '/privacy',
    )

    // The shared form pattern: no native bubble, the error under the field, focus on it.
    const field = sheet.getByRole('textbox', { name: 'Email' })
    await sheet.getByRole('button', { name: 'Send my link' }).click()
    await expect(field).toBeFocused()
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await expect(sheet.getByText('Type your email to continue.')).toBeVisible()
    await field.fill('jordan@')
    await expect(sheet.getByText("That email doesn't look right. Check for typos.")).toBeVisible()
    const email = freshEmail()
    await field.fill(`  ${email} `)
    await expect(field).not.toHaveAttribute('aria-invalid', 'true')
    await expect(sheet.locator('[data-account-email-preview]')).toHaveText(
      `We'll send it to ${email}`,
    )
    await checkA11y()

    const before = await playerState(page)
    await clearMail(email)
    await sheet.getByRole('button', { name: 'Send my link' }).click()
    await expect(sheet.getByRole('heading', { name: 'Check your inbox' })).toBeVisible()
    await expect(sheet).toContainText(`Link's on the way to ${email.slice(0, 1)}•••@example.test`)
    await expect(sheet.locator('[data-account-resend]')).toBeDisabled()
    await expect(sheet.locator('[data-account-resend]')).toHaveAccessibleName(
      /^Resend available in \d+ seconds$/,
    )
    // Mid-save, the banner stays away.
    await expect(banner(page)).toHaveCount(0)

    // The link opens in another tab of this browser and finishes on a tap.
    const link = linkIn(await newestMail(email))
    expect(new URL(link).pathname).toBe('/auth/callback')
    const tab = await context.newPage()
    await finishLink(tab, link, 'Tap to save your progress')
    await expect(tab.getByRole('heading', { name: "You're saved" })).toBeVisible()
    await expect(tab.getByRole('link', { name: 'Back to the game' })).toHaveAttribute('href', '/')
    await tab.close()

    // This tab picks it up: same user, now saved; the sheet says so.
    await nudgeUpgradeCheck(page)
    await expect.poll(() => sessionStatus(page), { timeout: 40_000 }).toBe('permanent')
    await expect(sheet.locator('[data-account-done="saved"]')).toBeVisible()
    expect(await storedUserId(page)).toBe(userId)
    expect(await playerState(page)).toEqual(before)
    const [row] = await sql<{ is_anonymous: boolean; attested: boolean }[]>`
    select u.is_anonymous, p.attested from auth.users u join public.profiles p on p.id = u.id
    where u.id = ${userId ?? ''}
  `
    expect(row).toEqual({ is_anonymous: false, attested: true })

    // A reload is still the saved account, with the same game, and no prompt.
    await page.reload()
    await expect.poll(() => sessionStatus(page), { timeout: 20_000 }).toBe('permanent')
    expect(await playerState(page)).toEqual(before)
    await expect(banner(page)).toHaveCount(0)
    await meTab(page).click()
    await expect(page.locator('[data-me-account="account"]')).toContainText(
      `Signed in as ${email.slice(0, 1)}•••@example.test`,
    )
  })
})

test('a link confirmed on another device saves this one', async ({ page, browser }) => {
  test.setTimeout(120_000)
  await bootGuest(page)
  const userId = await storedUserId(page)
  const email = freshEmail()
  await clearMail(email)
  await meTab(page).click()
  await page
    .getByRole('dialog', { name: 'Me' })
    .getByRole('button', { name: 'Create account' })
    .click()
  const sheet = accountSheet(page, 'Create account')
  await sheet.getByRole('textbox', { name: 'Email' }).fill(email)
  await sheet.getByRole('button', { name: 'Send my link' }).click()
  await expect(sheet.getByRole('heading', { name: 'Check your inbox' })).toBeVisible()

  const laptop = await browser.newContext()
  const other = await laptop.newPage()
  await finishLink(other, linkIn(await newestMail(email)), 'Tap to save your progress')
  // The laptop confirms the address but never takes the account (review F1).
  await expect(other.getByRole('heading', { name: 'Saved', exact: true })).toBeVisible()
  await expect(other.locator('[data-auth-callback]')).toContainText(
    'Head back to the device where you asked',
  )
  expect(
    await other.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('sb-'))),
  ).toEqual([])
  await laptop.close()

  await nudgeUpgradeCheck(page)
  await expect.poll(() => sessionStatus(page), { timeout: 40_000 }).toBe('permanent')
  expect(await storedUserId(page)).toBe(userId)
})

test.describe('Google', () => {
  test.use({ injectedConsoleErrors: [/status of 400/] })

  test('the button asks GoTrue to link Google with PKCE, back to /auth/callback', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90_000)
    await bootGuest(page)
    await meTab(page).click()
    await page
      .getByRole('dialog', { name: 'Me' })
      .getByRole('button', { name: 'Create account' })
      .click()
    const sheet = accountSheet(page, 'Create account')
    const asked = page.waitForRequest((request) =>
      request.url().includes('/auth/v1/user/identities/authorize'),
    )
    await sheet.getByRole('button', { name: 'Continue with Google' }).click()
    const url = new URL((await asked).url())
    expect(url.searchParams.get('provider')).toBe('google')
    expect(url.searchParams.get('redirect_to')).toBe(`${baseURL ?? ''}/auth/callback`)
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(url.searchParams.get('code_challenge_method')).toBe('s256')
    // Google is off on the local stack: the sheet says so and offers email instead.
    await expect(sheet.getByRole('alert')).toHaveText(
      "Google sign-in isn't available right now. Use email.",
    )
  })
})

test("the welcome card's Create account finishes the card first, then opens the save sheet", async ({
  page,
}) => {
  test.setTimeout(90_000)
  await bootGame(page, { fresh: false })
  const card = welcomeDialog(page)
  const create = card.getByRole('button', { name: 'Create account' })
  await expect(card.getByRole('button', { name: 'Have an account? Log in' })).toBeVisible()
  const box = await create.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)

  // An unfinished card stays: its errors show, and no sheet opens.
  await create.click()
  await expect(card.getByText('Pick the year you were born to continue.')).toBeVisible()
  await expect(accountSheet(page, 'Create account')).toHaveCount(0)

  await card.getByRole('combobox', { name: 'Year you were born' }).selectOption(String(YEAR - 30))
  await card.getByRole('checkbox').check()
  await card.getByRole('radio', { name: "I'll bring my own" }).check()
  await create.click()
  await expect(card).toHaveCount(0)
  const sheet = accountSheet(page, 'Create account')
  await expect(sheet).toBeVisible()
  await expect.poll(() => sessionStatus(page), { timeout: 20_000 }).toBe('anonymous')
  await expect(sheet.getByRole('textbox', { name: 'Email' })).toBeVisible()
})

test.describe('the level-up nudge', () => {
  // The clout set through the hook is not plausible to the server: the save is refused (422).
  test.use({ injectedConsoleErrors: [/status of 422/] })

  test("a guest's level-up offers saving their progress", async ({ page }) => {
    test.setTimeout(90_000)
    await bootGuest(page)
    await page.evaluate(() => {
      const places = window.__cloutcityPlaces
      if (places === undefined) throw new Error('place test hook is not installed')
      places.setClout(98)
      places.setTimeOfDay(12 * 60)
      places.setLocation('queens-ballpark')
      if (!places.open('queens-ballpark')) throw new Error('no queens-ballpark')
    })
    const card = page.locator('[data-place-sheet="queens-ballpark"]')
    await card.getByRole('button', { name: /^Flex: / }).click()
    const toast = page.locator('[data-overlay-zone="toast"] [data-level-up]')
    await expect(toast).toBeVisible()
    const save = toast.getByRole('button', { name: /^Save your progress\./ })
    await expect(save).toHaveText('Save')
    await save.click()
    await expect(accountSheet(page, 'Create account')).toBeVisible()
  })
})

test('logging in from the welcome card never makes a guest first', async ({ page }) => {
  const signUps: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/auth/v1/signup') signUps.push(request.url())
  })
  await bootGame(page, { fresh: false })
  await welcomeDialog(page).getByRole('button', { name: 'Have an account? Log in' }).click()
  const login = page.getByRole('dialog', { name: 'Log in to Clout City' })
  await expect(login.getByRole('textbox', { name: 'Email' })).toBeVisible()
  await login.getByRole('button', { name: 'Back' }).click()
  await answerWelcomeCard(page, { birthYear: YEAR - 30, consent: true, audio: 'Play our music' })
  await expect.poll(() => sessionStatus(page), { timeout: 20_000 }).toBe('anonymous')
  expect(signUps).toHaveLength(1)
})
