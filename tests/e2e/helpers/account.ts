import { expect, type Locator, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { YEAR } from '../fixtures/welcome'
import { holdGameTime } from './hud'
import { waitForMapSettled } from './scene'
import type { LocalStack } from './stack'

/**
 * Accounts (S19, DEC-61, DEC-62) for `*.supabase.spec.ts`: the landing, signing up and logging
 * in through the real screens, the character creator that follows a sign-up, and saved accounts
 * seeded straight against the stack.
 */

/** A fresh address on the reserved test domain: never a real inbox. */
export const freshEmail = (): string => `s19-${crypto.randomUUID()}@example.test`
/** A fresh username within the handle rules. */
export const freshUsername = (): string =>
  `qa_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
export const PASSWORD = 'correct horse 42'

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

export const landing = (page: Page): Locator => page.locator('[data-welcome-dialog="landing"]')
export const authScreen = (page: Page): Locator => page.locator('[data-auth-screen]')

/** Opens the game with the test hooks, the passive clock held (a hidden page). */
export async function openGame(page: Page): Promise<void> {
  await holdGameTime(page)
  await page.addInitScript(() => {
    window.__CLOUTCITY_E2E__ = true
  })
  await page.goto('/')
}

export interface SignUpAnswers {
  readonly username?: string
  readonly email?: string
  readonly password?: string
  readonly birthYear?: number
  readonly consent?: boolean
}

/** Fills the sign-up form (from the landing) and submits it; `inspect` runs just before. */
export async function fillSignUp(
  page: Page,
  answers: SignUpAnswers = {},
  inspect?: (form: Locator) => Promise<void>,
): Promise<void> {
  const form = page.locator('[data-auth-form="signup"]')
  // The landing is a boot island and the screen a lazy one: either can take a moment.
  await expect(landing(page).or(authScreen(page))).toBeVisible({ timeout: 20_000 })
  if (await landing(page).isVisible()) {
    await page.locator('[data-landing="signup"]').click()
  } else if (!(await form.isVisible())) {
    await authScreen(page).locator('[data-auth-tab="signup"]').click()
  }
  await expect(form).toBeVisible({ timeout: 20_000 })
  await form.getByRole('textbox', { name: 'Username' }).fill(answers.username ?? freshUsername())
  await form.getByRole('textbox', { name: 'Email' }).fill(answers.email ?? freshEmail())
  await form.getByLabel('Password', { exact: true }).fill(answers.password ?? PASSWORD)
  await form
    .getByRole('combobox', { name: 'Year you were born' })
    .selectOption(String(answers.birthYear ?? YEAR - 30))
  if (answers.consent ?? true) await form.getByRole('checkbox').check()
  await inspect?.(form)
  await form.getByRole('button', { name: 'Create account' }).click()
}

/** The sound step that follows a sign-up or log-in (GR-13). */
export async function chooseSound(page: Page): Promise<void> {
  const form = page.locator('[data-auth-form="sound"]')
  await expect(form).toBeVisible({ timeout: 20_000 })
  await form.getByRole('radio', { name: "I'll bring my own" }).check()
  await form.getByRole('button', { name: 'Start playing' }).click()
}

/** Closes the creator a sign-up opens, and the room the close leads to. */
export async function skipCreator(page: Page): Promise<void> {
  await expect(page.locator('[data-creator-step]')).toBeVisible({ timeout: 20_000 })
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-creator-step]')).toHaveCount(0)
  // The room opens after the creator; close it too, so the map is in front.
  const home = page.locator('[data-hud-panel-dialog="home"]')
  await expect(home).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(home).toHaveCount(0)
}

/**
 * A new account through the real screens: the landing, the sign-up form, the sound choice. The
 * creator opens next; `skipCreator` closes it.
 */
export async function signUpThroughUi(
  page: Page,
  answers: SignUpAnswers = {},
  inspect?: (form: Locator) => Promise<void>,
): Promise<{ readonly username: string; readonly email: string }> {
  const username = answers.username ?? freshUsername()
  const email = answers.email ?? freshEmail()
  await fillSignUp(page, { ...answers, username, email }, inspect)
  await chooseSound(page)
  await expect.poll(() => sessionStatus(page), { timeout: 20_000 }).toBe('permanent')
  return { username, email }
}

/** Logs in through the landing's Log in screen, then the sound choice. */
export async function logInThroughUi(
  page: Page,
  identifier: string,
  password: string = PASSWORD,
): Promise<void> {
  const form = page.locator('[data-auth-form="login"]')
  await expect(landing(page).or(authScreen(page))).toBeVisible({ timeout: 20_000 })
  if (await landing(page).isVisible()) {
    await page.locator('[data-landing="login"]').click()
  } else if (!(await form.isVisible())) {
    await authScreen(page).locator('[data-auth-tab="login"]').click()
  }
  await expect(form).toBeVisible({ timeout: 20_000 })
  await form.getByRole('textbox', { name: 'Username or email' }).fill(identifier)
  await form.getByLabel('Password', { exact: true }).fill(password)
  await form.getByRole('button', { name: 'Log in' }).click()
}

/** Opens the game and signs up a new account, past the creator, the map settled. */
export async function bootAccount(
  page: Page,
): Promise<{ readonly username: string; readonly email: string }> {
  return bootAccountAs(page, freshUsername())
}

/** {@link bootAccount} with a chosen username; `inspect` sees the filled form before submit. */
export async function bootAccountAs(
  page: Page,
  username: string,
  inspect?: (form: Locator) => Promise<void>,
): Promise<{ readonly username: string; readonly email: string }> {
  await openGame(page)
  await expect(landing(page)).toBeVisible({ timeout: 20_000 })
  const account = await signUpThroughUi(page, { username }, inspect)
  await skipCreator(page)
  await waitForMapSettled(page)
  return account
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
  page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Me', exact: true })

/**
 * A saved account made straight against the stack, the way the sign-up form makes one: signUp
 * (no confirmation email, DEC-61), the attestation, and a username. No cloud save.
 */
export async function newSavedAccount(
  stack: LocalStack,
  options: { readonly username?: string; readonly email?: string } = {},
): Promise<{ readonly id: string; readonly email: string; readonly username: string }> {
  const email = options.email ?? freshEmail()
  const username = options.username ?? freshUsername()
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
  const { data, error } = await client.auth.signUp({ email, password: PASSWORD })
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
  const handle = await client.rpc('set_handle', { p_handle: username })
  if (handle.error !== null) throw handle.error
  return { id: data.user.id, email, username }
}
