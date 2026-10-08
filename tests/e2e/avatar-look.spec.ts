import type { Locator, Page } from '@playwright/test'
import { expect, test, waitForWelcomeGate } from './fixtures/test'
import { seedTier, waitForCityModels } from './helpers/cityModels'
import { moreButton, morePanel, openFromHud } from './helpers/hud'
import { copyText } from './helpers/places'
import { SCENE_READY_TIMEOUT_MS, waitForMapSettled } from './helpers/scene'

// S16a A3: the look the player makes in the creator is the one the game draws, on the map and in
// the apartment: the creator saves it through the store, the playerLook bridge hands it to the
// map's avatar, and the room's avatar reads the same save (one look runtime, resolveLook).

test.setTimeout(150_000)

const creator = (page: Page): Locator =>
  page.getByRole('dialog', { name: copyText('creator.title') })
const look = (page: Page): Locator => page.locator('[data-creator-step="look"]')

async function openCreator(page: Page) {
  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    await page.locator('[data-hud-creator]').click()
  } else {
    await moreButton(page).click()
    await morePanel(page)
      .getByRole('button', { name: copyText('hud.yourLook'), exact: true })
      .click()
  }
  await expect(look(page)).toBeVisible()
}

const mapLook = (page: Page) =>
  page.evaluate(() => window.__cloutcityTest?.scene?.player()?.look ?? null)

test('a look made in the creator is drawn on the map and in the apartment', async ({ page }) => {
  await seedTier(page, 'mid')
  await page.goto('/')
  await waitForWelcomeGate(page)
  await waitForMapSettled(page)
  await waitForCityModels(page)
  await expect.poll(async () => (await mapLook(page))?.body, { timeout: 30_000 }).toBeTruthy()

  await openCreator(page)
  // The preview draws the draft (its own canvas while the city pauses behind the modal).
  await look(page)
    .getByRole('radio', { name: copyText('avatar.hairStyle.locs'), exact: true })
    .check()
  await look(page)
    .getByRole('radio', { name: copyText('avatar.eyewear.glasses'), exact: true })
    .check()
  await look(page)
    .getByRole('radio', { name: copyText('avatar.facialHair.goatee'), exact: true })
    .check()
  await look(page)
    .getByRole('radio', { name: copyText('avatar.outfit.outfit09'), exact: true })
    .check()
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const preview = window.__cloutcityTest?.avatarPreview?.look()
          return preview === null || preview === undefined
            ? null
            : { head: preview.head, attachments: preview.attachments }
        }),
      { timeout: 60_000 },
    )
    .toEqual({ head: 'head-base', attachments: ['hair-locs', 'facial-goatee', 'glasses'] })

  await creator(page).locator('[data-creator-next]').click()
  await expect(creator(page).locator('[data-creator-status]')).toHaveText(
    copyText('creator.look.saved'),
  )
  await creator(page)
    .getByRole('button', { name: copyText('creator.closeLabel') })
    .click()
  await expect(creator(page)).toHaveCount(0)

  // The map: the same parts.
  await expect
    .poll(
      async () => {
        const drawn = await mapLook(page)
        return drawn === null
          ? null
          : { head: drawn.head, body: drawn.body, attachments: drawn.attachments }
      },
      { timeout: 30_000 },
    )
    .toEqual({
      head: 'head-base',
      body: 'body-male-c',
      attachments: ['hair-locs', 'facial-goatee', 'glasses'],
    })

  // The apartment: the room's avatar wears them too.
  await openFromHud(page, 'Home')
  await page.waitForFunction(
    () => {
      const hook = window.__cloutcityTest?.apartment
      return hook?.ready === true && hook.pendingFrames() === 0 && hook.avatar()?.drawn === true
    },
    null,
    { polling: 'raf', timeout: SCENE_READY_TIMEOUT_MS },
  )
  const meshes = await page.evaluate(() => window.__cloutcityTest?.apartment?.avatar()?.meshes)
  expect(meshes).toEqual(
    expect.arrayContaining([
      'hair-locs-attachment',
      'facial-goatee-attachment',
      'glasses-attachment',
    ]),
  )
})
