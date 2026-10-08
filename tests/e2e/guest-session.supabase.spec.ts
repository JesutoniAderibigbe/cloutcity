import { expect, test } from './fixtures/test'
import { supabaseStorageKeys } from './fixtures/welcome'
import { landing, openGame, signUpThroughUi, skipCreator } from './helpers/account'
import { waitForMapSettled } from './helpers/scene'

// S05 with DEC-62, opt-in (`npm run e2e:supabase`, playwright.supabase.config.ts): against the
// local Supabase stack, a new visitor gets no session at all until they sign up (no guest is
// ever created); the sign-up makes one account with the attestation recorded, and a reload
// reuses its session instead of signing in again. The stack is shared by every checkout: this
// only creates its own users and never resets it.

test.use({ onboarding: 'fresh' })

const session = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.__cloutcityTest?.session?.state() ?? null)

test('no guest for a visitor; one account at sign-up, reused after a reload', async ({ page }) => {
  test.setTimeout(120_000)
  const signUps: string[] = []
  const attests: number[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/auth/v1/signup') signUps.push(request.postData() ?? '')
  })
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (url.pathname === '/rest/v1/rpc/attest_and_consent') attests.push(response.status())
  })

  await openGame(page)
  await expect(landing(page)).toBeVisible({ timeout: 20_000 })
  await waitForMapSettled(page)
  // The live city loads behind the landing, with nobody signed in.
  expect(signUps).toHaveLength(0)
  expect(await supabaseStorageKeys(page)).toEqual([])

  await signUpThroughUi(page)
  await skipCreator(page)
  expect(await session(page)).toMatchObject({ status: 'permanent', reason: null })
  // One sign-up, with an email and password: never an anonymous one.
  expect(signUps).toHaveLength(1)
  expect(signUps[0]).toContain('"email"')
  expect(attests[0]).toBe(200)
  // One session key (supabase-js also keeps PKCE verifiers beside it).
  expect((await supabaseStorageKeys(page)).filter((key) => key.endsWith('-auth-token'))).toEqual([
    expect.stringMatching(/^sb-.+-auth-token$/),
  ])

  await page.reload()
  await waitForMapSettled(page)
  await expect(landing(page)).toHaveCount(0)
  await expect
    .poll(async () => (await session(page))?.status, { timeout: 20_000 })
    .toBe('permanent')
  expect(await session(page)).toEqual({ status: 'permanent', reason: null, reused: true })
  expect(signUps).toHaveLength(1)
})
