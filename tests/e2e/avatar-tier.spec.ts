import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures/test'
import { seedTier, waitForCityModels } from './helpers/cityModels'
import { openFromHud } from './helpers/hud'
import { waitForMapSettled } from './helpers/scene'

// 3D-1: the player's hand-made avatar (S04h) is drawn on mid and high and swapped for the capsule
// on low (scene.json models.player.capsuleTiers). A live switch to low unmounts the model; the
// capsule must come back with it, or the player is invisible. Back on mid, the model returns.

test.setTimeout(120_000)

const player = (page: Page) =>
  page.evaluate(() => {
    const scene = window.__cloutcityTest?.scene
    return {
      tier: scene?.quality().active,
      model: scene?.player()?.model,
      avatarMeshes: (scene?.glowingMeshes() ?? []).filter((name) => name.endsWith('-mesh')),
      pending: scene?.pendingFrames(),
    }
  })

async function chooseGraphics(page: Page, name: 'Low' | 'Mid') {
  const settings = page.getByRole('region', { name: 'Settings' })
  if (!(await settings.isVisible())) await openFromHud(page, 'Settings')
  await settings
    .getByRole('group', { name: 'Graphics' })
    .getByRole('radio', { name, exact: true })
    .check()
}

test('a live switch to Low shows the capsule, and Mid brings the avatar back', async ({ page }) => {
  await seedTier(page, 'mid')
  await page.goto('/')
  await waitForMapSettled(page)
  await waitForCityModels(page)
  await expect.poll(async () => (await player(page)).model, { timeout: 30_000 }).toBe(true)

  await chooseGraphics(page, 'Low')
  await expect.poll(async () => (await player(page)).tier).toBe('low')
  // The capsule is visible (model false) and no avatar mesh is left in the scene.
  await expect
    .poll(async () => {
      const state = await player(page)
      return { model: state.model, meshes: state.avatarMeshes, pending: state.pending }
    })
    .toEqual({ model: false, meshes: [], pending: 0 })

  await chooseGraphics(page, 'Mid')
  await expect.poll(async () => (await player(page)).tier).toBe('mid')
  await expect.poll(async () => (await player(page)).model, { timeout: 30_000 }).toBe(true)
})

// S16a: the map avatar is the player's own look (a guest's random start); on low the capsule
// shows it too, in the colour of the top the look wears.
const options = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../data/avatar/options.json'), 'utf8'),
) as {
  outfits: { id: string; body: string }[]
  hairStyles: { id: string; head: string }[]
  garmentColors: { id: string; token: string }[]
}
const palette = (
  JSON.parse(readFileSync(join(import.meta.dirname, '../../data/config/theme.json'), 'utf8')) as {
    models: Record<string, string>
  }
).models

const savedLook = (page: Page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem('cloutcity:game')
    const state =
      raw === null
        ? null
        : (JSON.parse(raw) as { state?: { player?: { look?: Record<string, string> } } }).state
    return state?.player?.look ?? null
  })

test('the map draws the player look, and the low capsule wears its top colour', async ({
  page,
}) => {
  await seedTier(page, 'mid')
  await page.goto('/')
  await waitForMapSettled(page)
  await waitForCityModels(page)
  await expect.poll(async () => (await savedLook(page)) !== null, { timeout: 30_000 }).toBe(true)
  const look = await savedLook(page)
  if (look === null) throw new Error('no saved look')
  const drawn = () => page.evaluate(() => window.__cloutcityTest?.scene?.player()?.look ?? null)
  await expect
    .poll(async () => (await drawn())?.body, { timeout: 30_000 })
    .toBe(options.outfits.find((outfit) => outfit.id === look.outfit)?.body)
  const resolved = await drawn()
  const style = options.hairStyles.find((s) => s.id === look.hairStyle)
  // A hairstyle part A0 has not built yet (a Blender piece on the bald head) stands in with the
  // default head and is listed as missing.
  if (resolved?.missing.includes('head-base') !== true) expect(resolved?.head).toBe(style?.head)
  expect(resolved?.attachments.length ?? 0).toBeLessThanOrEqual(4)

  const top = palette[options.garmentColors.find((color) => color.id === look.top)?.token ?? '']
  await chooseGraphics(page, 'Low')
  await expect.poll(async () => (await player(page)).model).toBe(false)
  await expect
    .poll(() => page.evaluate(() => window.__cloutcityTest?.scene?.player()?.capsuleColor))
    .toBe(top)
})
