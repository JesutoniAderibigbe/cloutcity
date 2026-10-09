import type { Page } from '@playwright/test'
import { expect, test, waitForWelcomeGate } from './fixtures/test'
import { waitForMapSettled } from './helpers/scene'

// S16c: the club's dance floor dances the dance moves (scripts/blender/avatar-anim/dance.py),
// fetched only inside the venue: the player's Sim after "Go in", and the locals on the floor in
// more than one move. Under reduced motion nobody dances (the Sim holds its pose).
test.use({ location: 'follow' })

const CLUB_NIGHT = 23 * 60 + 30

async function goIn(page: Page) {
  await page.addInitScript(() => {
    window.__CLOUTCITY_E2E__ = true
  })
  await page.goto('/')
  await waitForWelcomeGate(page)
  await page.waitForFunction(() => window.__cloutcityPlaces !== undefined)
  await waitForMapSettled(page)
  await page.evaluate((minute) => {
    const places = window.__cloutcityPlaces
    if (places === undefined) throw new Error('place test hook is not installed')
    places.setClout(400)
    places.setCash(20000)
    places.setTimeOfDay(minute)
    places.setLocation('glowmatic')
    if (!places.open('glowmatic')) throw new Error('no club')
  }, CLUB_NIGHT)
  await page.waitForFunction(() => window.__cloutcityTest?.venue?.ready === true, null, {
    timeout: 120_000,
  })
  await page.locator('button[data-place-action="club-night"]').first().click()
}

const venue = (page: Page) =>
  page.evaluate(() => {
    const hook = window.__cloutcityTest?.venue
    if (hook === undefined) throw new Error('venue test hook is not installed')
    return {
      avatar: hook.avatar(),
      kits: hook.crowdKits(),
      info: hook.renderInfo(),
      budget: hook.budget(),
    }
  })

test('the player and the locals dance the dance moves inside the budget', async ({ page }) => {
  test.slow()
  await goIn(page)
  await expect
    .poll(async () => (await venue(page)).avatar?.move ?? null, { timeout: 90_000 })
    .toMatch(/^dance-/)
  await expect
    .poll(async () => (await venue(page)).kits.filter((kit) => kit.includes('-dance-')).length, {
      timeout: 60_000,
    })
    .toBeGreaterThan(0)
  const { avatar, info, budget } = await venue(page)
  // The controller still reports the dance pose; the move plays over it.
  expect(avatar?.clip).toBe('wave')
  expect(info.calls).toBeLessThanOrEqual(budget.drawCallsMax)
  expect(info.triangles).toBeLessThanOrEqual(budget.trianglesMax)
})

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('nobody dances: the Sim holds its pose', async ({ page }) => {
    test.slow()
    await goIn(page)
    await expect
      .poll(async () => (await venue(page)).avatar?.clip ?? null, { timeout: 90_000 })
      .toBe('wave')
    expect((await venue(page)).avatar?.move).toBeNull()
  })
})
