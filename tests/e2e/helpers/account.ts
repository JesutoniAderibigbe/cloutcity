import { expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { answerWelcomeCard, YEAR } from '../fixtures/welcome'
import { holdGameTime } from './hud'
import { codeIn, clearMail, linkFragment, linkIn, newestMail, ourLink } from './mail'
import { waitForMapSettled } from './scene'
import type { LocalStack } from './stack'

/**
 * Accounts (S19) for `*.supabase.spec.ts`: guests made through the welcome card, the first
 * milestone reached through play, saving progress through the account sheet and the emailed
 * link, and saved accounts seeded straight against the stack.
 */

/** A fresh address on the reserved test domain: never a real inbox. */
export const freshEmail = (): string => `s19-${crypto.randomUUID()}@example.test`

export const sessionStatus = (page: Page) =>
  page.evaluate(() => window.__cloutcityTest?.session?.state().status ?? null)

export const playerState = (page: Page) =>
  page.evaluate(() => {
    const places = window.__cloutcityPlaces
    if (places === undefined) throw new Error('place test hook is not installed')
    const { cash, clout } = places.state()
    return { cash, clout }
  })

/** The signed-in user id the game's client holds (its `sb-<ref>-auth-token` key). */
export const storedUserId = (page: Page) =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) => /^sb-.+-auth-token$/.test(name))
    const raw = key === undefined ? null : localStorage.getItem(key)
    return raw === null ? null : ((JSON.parse(raw) as { user?: { id?: string } }).user?.id ?? null)
  })

/**
 * Opens the game with the test hooks, as a returning player or past a fresh welcome card. The
 * passive clock is held (a hidden page), so a change is uploaded after the sync debounce rather
 * than whenever passive time stops moving the stats.
 */
export async function bootGame(page: Page, options: { fresh: boolean }): Promise<void> {
  await holdGameTime(page)
  await page.addInitScript(() => {
    window.__CLOUTCITY_E2E__ = true
  })
  await page.goto('/')
  if (options.fresh) {
    await page.waitForFunction(() => window.__cloutcityTest?.session !== undefined)
    await answerWelcomeCard(page, {
      birthYear: YEAR - 30,
      consent: true,
      audio: "I'll bring my own",
    })
  }
  await waitForMapSettled(page)
}

/** A new guest with a server session: past the welcome card, signed in anonymously. */
export async function bootGuest(page: Page): Promise<void> {
  await bootGame(page, { fresh: true })
  await expect.poll(() => sessionStatus(page), { timeout: 20_000 }).toBe('anonymous')
}

/** Reaches the first milestone (a goal) through play: a landmark visit. */
export async function reachFirstMilestone(page: Page): Promise<void> {
  await page.evaluate(() => {
    const places = window.__cloutcityPlaces
    if (places === undefined) throw new Error('place test hook is not installed')
    // Open hours, and there already: the visit is the play under test, not the trip.
    places.setTimeOfDay(10 * 60)
    places.setLocation('flushing-meadows')
    if (!places.open('flushing-meadows')) throw new Error('no flushing-meadows')
  })
  const card = page.locator('[data-place-sheet="flushing-meadows"]')
  await card.getByRole('button', { name: /^Visit: / }).click()
  await expect(card.getByRole('status')).not.toBeEmpty()
  await card.getByRole('button', { name: /^Close/ }).click()
}

export const cloudStatus = (page: Page) =>
  page.locator('[data-hud-panel="cloud"]').getAttribute('data-sync-status')

/** Waits for the account to hold this device's game (the cloud chip, or the More row). */
export async function waitSynced(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.querySelector('[data-sync-status]')?.getAttribute('data-sync-status') ?? null,
        ),
      { timeout: 30_000 },
    )
    .toBe('synced')
}

export const meTab = (page: Page) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Me' })

export const accountSheet = (page: Page, title: 'Create account' | 'Log in') =>
  page.getByRole('dialog', { name: title })

/**
 * Saves a guest's progress by email through the sheet (opened from the Me tab), then opens the
 * emailed link in `linkPage` (another tab, or another device) and taps Finish there.
 */
export async function saveProgressByEmail(
  page: Page,
  linkPage: Page,
  email: string,
): Promise<void> {
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
  await finishLink(linkPage, linkIn(await newestMail(email)), 'Tap to save your progress')
}

/** Opens an emailed link of ours on `page` (the server under test) and taps Finish. */
export async function finishLink(page: Page, link: string, heading: string): Promise<void> {
  const response = await page.goto(ourLink(link, '/auth/callback'))
  // The page that holds a one-time token is never stored and never sends a Referer.
  const headers = response?.headers() ?? {}
  expect(headers['cache-control']).toContain('no-store')
  expect(headers['referrer-policy']).toBe('no-referrer')
  await expect(page.getByRole('heading', { name: heading })).toBeVisible()
  // The token is out of the address bar before anything is tapped. A save link names the
  // address (masked) it is for; a log-in link's fragment is never trusted for display (N1).
  expect(page.url()).not.toContain('token_hash')
  if (heading === 'Tap to save your progress') {
    await expect(page.locator('[data-auth-for]')).toContainText('•••@')
  } else {
    await expect(page.locator('[data-auth-for]')).toHaveCount(0)
  }
  await page.getByRole('button', { name: 'Finish' }).click()
}

/** The log-in code emailed to `email` (waits for a new email). */
export async function loginCode(email: string): Promise<string> {
  return codeIn(await newestMail(email))
}

/** Asks this page to check a waiting upgrade now (the coordinator also polls on a timer). */
export async function nudgeUpgradeCheck(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
}

/**
 * A saved account made straight against the stack, the way the game makes one: an attested
 * guest whose email change was confirmed through the emailed link. No cloud save.
 */
export async function newSavedAccount(
  stack: LocalStack,
  callback: string,
  email: string = freshEmail(),
): Promise<{ readonly id: string; readonly email: string }> {
  const memory = new Map<string, string>()
  const client = createClient(stack.apiUrl, stack.anonKey, {
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
  const { data, error } = await client.auth.signInAnonymously()
  if (error !== null || data.user === null) throw error ?? new Error('no user')
  const now = Date.now()
  const attested = await client.rpc('attest_and_consent', {
    p_adult: true,
    p_attested_at: new Date(now - 60_000).toISOString(),
    p_consent_version: '2026-10-06',
    p_consented_at: new Date(now - 60_000).toISOString(),
    p_audio_choice: 'ours',
  })
  if (attested.error !== null) throw attested.error
  const update = await client.auth.updateUser({ email }, { emailRedirectTo: callback })
  if (update.error !== null) throw update.error
  const hash = linkFragment(linkIn(await newestMail(email))).get('token_hash') ?? ''
  const verified = await client.auth.verifyOtp({ token_hash: hash, type: 'email_change' })
  if (verified.error !== null) throw verified.error
  await clearMail(email)
  return { id: data.user.id, email }
}
