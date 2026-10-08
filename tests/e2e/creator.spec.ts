import type { Locator, Page } from '@playwright/test'
import { expect, test, waitForWelcomeGate } from './fixtures/test'
import { at, seedClockSave } from './helpers/dayNight'
import { holdGameTime, moreButton, morePanel } from './helpers/hud'
import { copyText, readJson } from './helpers/places'
import { waitForMapSettled } from './helpers/scene'

// S16a A3: the "Make it you" creator. A guest plays at once with a random look and never meets
// the creator first; after the first action (and only once the tour is over) it is offered, can
// be put off with "Not now", and is always reachable from the HUD (Your look from 1024 px, More
// on phones). The flow is Look, Traits, Dream, the neighborhood roll and Home, on native radios
// and checkboxes; every name and number on screen comes from the data (GR-10).

test.use({ creatorOffer: 'on' })
test.setTimeout(120_000)

const STORE_KEY = 'cloutcity:game'
/** Names that start with `text` (a copy string, escaped). */
const startsWith = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
const neighborhoods = readJson<{ neighborhoods: { id: string; nameKey: string }[] }>(
  'data/homes/neighborhoods.json',
).neighborhoods
const traits = readJson<{ traits: { id: string; nameKey: string }[] }>(
  'data/avatar/traits.json',
).traits
const creatorJson = readJson<{ steps: { id: string; pick?: number }[] }>('data/config/creator.json')
const pick = creatorJson.steps.find((step) => step.id === 'traits')?.pick ?? 0

async function boot(page: Page) {
  // The HUD and places test hooks install only on an e2e page.
  await page.addInitScript(() => {
    window.__CLOUTCITY_E2E__ = true
  })
  await page.goto('/')
  await waitForWelcomeGate(page)
  await page.waitForFunction(() => window.__cloutcityTest?.hud !== undefined)
  await waitForMapSettled(page)
}

/** The player's first action: a cheap gift, bought through the store and engine. */
async function firstAction(page: Page) {
  await page.evaluate(() => {
    window.__cloutcityPlaces?.setCash(500)
    if (window.__cloutcityTest?.hud?.buy('bodega-flowers') !== true) throw new Error('no buy')
  })
}

const offer = (page: Page): Locator => page.locator('[data-creator-offer]')
const creator = (page: Page): Locator =>
  page.getByRole('dialog', { name: copyText('creator.title') })
const step = (page: Page, id: string): Locator => page.locator(`[data-creator-step="${id}"]`)
const nextButton = (page: Page): Locator => creator(page).locator('[data-creator-next]')
const status = (page: Page): Locator => creator(page).locator('[data-creator-status]')

/** The step buttons are guarded (useActionGuard): wait out the cooldown like a person would. */
const settled = (page: Page) =>
  expect(creator(page).locator('nav[aria-busy="true"]')).toHaveCount(0)

const saved = (page: Page) =>
  page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    const state =
      raw === null ? null : (JSON.parse(raw) as { state?: Record<string, unknown> }).state
    return (state ?? null) as {
      player: {
        look: Record<string, string>
        traits: string[]
        careerPath: string | null
        neighborhood: string | null
      }
      creator: { dismissedAt: number | null; completedAt: number | null; skippedSteps: string[] }
      rolls: { neighborhood?: { result: string } }
    } | null
  }, STORE_KEY)

/** Opens the creator the way a player on this screen would: Your look, else More. */
async function openFromHud(page: Page) {
  const wide = (page.viewportSize()?.width ?? 0) >= 1024
  if (wide) {
    await page.locator('[data-hud-creator]').click()
  } else {
    await moreButton(page).click()
    await morePanel(page)
      .getByRole('button', { name: copyText('hud.yourLook'), exact: true })
      .click()
  }
  await expect(creator(page)).toBeVisible()
  await expect(
    creator(page).getByRole('heading', { name: copyText('creator.title') }),
  ).toBeFocused()
}

/** Next by keyboard: focus it and press Enter (the guard lets keyboard activations through). */
async function next(page: Page) {
  await settled(page)
  await nextButton(page).focus()
  await page.keyboard.press('Enter')
}

test('no offer before the first action; after it, Not now; the HUD always opens it', async ({
  page,
}) => {
  await boot(page)
  await expect(offer(page)).toHaveCount(0)
  await firstAction(page)
  await expect(offer(page)).toBeVisible()
  await expect(offer(page)).toHaveAttribute('data-cc-notice', 'creator-offer')

  await offer(page)
    .getByRole('button', { name: copyText('creatorOffer.skip') })
    .click()
  await expect(offer(page)).toHaveCount(0)
  await expect.poll(async () => (await saved(page))?.creator.dismissedAt).not.toBeNull()
  // Put off for good: a reload does not bring it back.
  await page.reload()
  await waitForWelcomeGate(page)
  await expect(offer(page)).toHaveCount(0)

  await openFromHud(page)
  await expect(step(page, 'look')).toBeVisible()
  await creator(page)
    .getByRole('button', { name: copyText('creator.closeLabel') })
    .click()
  await expect(creator(page)).toHaveCount(0)
  // Escape leaves too.
  await openFromHud(page)
  await page.keyboard.press('Escape')
  await expect(creator(page)).toHaveCount(0)
})

test('Look, Traits, Dream, the roll and Home on native controls, saved as it goes', async ({
  page,
}) => {
  await boot(page)
  await firstAction(page)
  await offer(page)
    .getByRole('button', { name: copyText('creatorOffer.label') })
    .click()
  await expect(creator(page)).toBeVisible()
  await expect(creator(page).locator('[data-creator-progress]')).toHaveText(
    copyText('creator.progress', { step: '1', count: '5', name: copyText('creator.step.look') }),
  )

  // Look: a hairstyle and a named swatch (A11Y-1), each the native radio itself.
  const look = step(page, 'look')
  await look.getByRole('radio', { name: copyText('avatar.hairStyle.afro'), exact: true }).check()
  const hairColor = look.getByRole('group', {
    name: startsWith(copyText('creator.look.hairColor')),
  })
  await hairColor.getByRole('radio', { name: copyText('colors.hair.pink'), exact: true }).check()
  await look.getByRole('radio', { name: copyText('avatar.height.tall'), exact: true }).check()
  await next(page)
  await expect(status(page)).toHaveText(copyText('creator.look.saved'))
  await expect
    .poll(async () => (await saved(page))?.player.look)
    .toMatchObject({
      hairStyle: 'afro',
      hairColor: 'pink',
      height: 'tall',
    })

  // Traits: exactly `pick`; one more is refused and said why.
  await expect(step(page, 'traits')).toBeVisible()
  const boxes = traits.map((trait) =>
    step(page, 'traits').getByRole('checkbox', { name: startsWith(copyText(trait.nameKey)) }),
  )
  for (const box of boxes.slice(0, pick)) await box.check()
  const extra = boxes[pick]
  if (extra === undefined) throw new Error('fewer traits than the pick')
  await extra.click()
  await expect(extra).not.toBeChecked()
  await expect(step(page, 'traits')).toContainText(
    copyText('creator.traits.full', { count: String(pick) }),
  )
  await next(page)
  await expect(status(page)).toHaveText(copyText('creator.traits.saved'))
  await expect
    .poll(async () => (await saved(page))?.player.traits)
    .toEqual(traits.slice(0, pick).map((trait) => trait.id))

  // Dream: the goal line follows it.
  await expect(step(page, 'dream')).toBeVisible()
  await step(page, 'dream')
    .getByRole('radio', { name: startsWith(copyText('career.streamer.name')) })
    .check()
  await next(page)
  const goal = copyText('career.streamer.goal')
  await expect(status(page)).toHaveText(copyText('creator.dream.saved', { goal }))
  await expect(page.locator('[data-hud-panel="goals"]')).toHaveAttribute(
    'aria-label',
    new RegExp(goal),
  )

  // The roll: Next waits for it; the dice land on a saved Queens neighborhood.
  await expect(step(page, 'neighborhood')).toBeVisible()
  await expect(nextButton(page)).toBeDisabled()
  await creator(page).locator('[data-creator-roll-button]').click()
  await expect(creator(page).locator('[data-dice-reveal="landed"]')).toBeVisible()
  const rolled = (await saved(page))?.rolls.neighborhood?.result ?? ''
  const where = neighborhoods.find((n) => n.id === rolled)
  expect(where, rolled).toBeDefined()
  const name = copyText(where?.nameKey ?? '')
  await expect(creator(page).locator('[data-dice-reveal] [role="status"]')).toHaveText(
    copyText('creator.roll.reveal', { neighborhood: name }),
  )
  await next(page)

  // Home: move in, then Done.
  await expect(step(page, 'home')).toBeVisible()
  await creator(page).locator('[data-creator-move-in="queens-room"]').click()
  await expect(step(page, 'home')).toContainText(
    copyText('creator.home.moved', { neighborhood: name }),
  )
  await expect.poll(async () => (await saved(page))?.player.neighborhood).toBe(rolled)
  await expect(nextButton(page)).toBeFocused()
  await next(page)
  await expect(creator(page)).toHaveCount(0)
  await expect.poll(async () => (await saved(page))?.creator.completedAt).not.toBeNull()
  await expect(offer(page)).toHaveCount(0)

  // One roll per save: back on the roll step, the same neighborhood and no dice to roll.
  await openFromHud(page)
  for (const id of ['look', 'traits', 'dream']) {
    await expect(step(page, id)).toBeVisible()
    await next(page)
  }
  await expect(creator(page).locator('[data-creator-roll-button]')).toHaveCount(0)
  await expect(creator(page).locator('[data-dice-reveal] [role="status"]')).toHaveText(
    copyText('creator.roll.reveal', { neighborhood: name }),
  )
})

test('Skip moves on and is recorded; the origin seam is not a step', async ({ page }) => {
  await boot(page)
  await openFromHud(page)
  for (const id of ['look', 'traits', 'dream', 'neighborhood']) {
    await expect(step(page, id)).toBeVisible()
    await settled(page)
    await creator(page).locator('[data-creator-skip]').click()
  }
  await expect(step(page, 'home')).toBeVisible()
  await expect(step(page, 'home')).toContainText(copyText('creator.home.notRolled'))
  await expect
    .poll(async () => (await saved(page))?.creator.skippedSteps)
    .toEqual(['look', 'traits', 'dream', 'neighborhood'])
  await expect(page.locator('[data-creator-step="origin"]')).toHaveCount(0)
})

for (const [label, minute] of [
  ['day', at(12)],
  ['night', at(22)],
] as const) {
  test(`every step passes axe in the ${label} theme`, async ({ page, checkA11y }) => {
    await seedClockSave(page, minute)
    await holdGameTime(page)
    await page.addInitScript(() => {
      // Reduced motion: the dice cut straight to the result and the preview poses once.
      window.matchMedia = ((query: string) => ({
        matches: query.includes('reduce'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia
    })
    await boot(page)
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
      .toBe(label)
    await openFromHud(page)
    for (const id of ['look', 'traits', 'dream', 'neighborhood']) {
      await expect(step(page, id)).toBeVisible()
      if (id === 'dream') {
        await step(page, id)
          .getByRole('radio', { name: startsWith(copyText('career.artistDj.name')) })
          .check()
      }
      if (id === 'neighborhood') {
        await creator(page).locator('[data-creator-roll-button]').click()
        // Reduced motion: no tumble, the result at once.
        await expect(creator(page).locator('[data-dice-reveal="landed"]')).toBeVisible()
      }
      await checkA11y()
      await next(page)
    }
    await expect(step(page, 'home')).toBeVisible()
    await checkA11y()
  })
}
