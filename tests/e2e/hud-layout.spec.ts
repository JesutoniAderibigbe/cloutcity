import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures/test'
import { holdGameTime, hudIsWide, moreButton, morePanel, waitForHudLoaded } from './helpers/hud'
import { hideSceneForScreenshot, waitForMapSettled } from './helpers/scene'

// S05: the HUD in the overlay's HUD zone (UX-1) at a phone, a desktop, a short phone and a
// landscape phone. Nothing overlaps, every target is at least 44 px, Inventory, Rent and the
// sound gear move into More on phones and landscape phones, and More closes back to its button.

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1280, height: 720 },
  { width: 390, height: 600 },
  { width: 844, height: 390 },
] as const

const CELLS = ['money', 'clock', 'speed', 'clout', 'stats', 'actions'] as const

interface Box {
  x: number
  y: number
  width: number
  height: number
}

const apart = (a: Box, b: Box) =>
  a.x + a.width <= b.x + 0.5 ||
  b.x + b.width <= a.x + 0.5 ||
  a.y + a.height <= b.y + 0.5 ||
  b.y + b.height <= a.y + 0.5

const inside = (inner: Box, outer: Box) =>
  inner.x >= outer.x - 0.5 &&
  inner.y >= outer.y - 0.5 &&
  inner.x + inner.width <= outer.x + outer.width + 0.5 &&
  inner.y + inner.height <= outer.y + outer.height + 0.5

const zone = (page: Page) => page.locator('[data-overlay-zone="hud"]')

async function boxOf(locator: Locator, name: string): Promise<Box> {
  const box = await locator.boundingBox()
  if (box === null) throw new Error(`${name} is not rendered`)
  return box
}

/** Boots with the game clock held still (a hidden page never passes time), the map settled and the HUD loaded. */
async function boot(page: Page) {
  await holdGameTime(page)
  await page.goto('/')
  // The 3D map's start-up holds the main thread on SwiftShader; measure the HUD after it.
  await waitForMapSettled(page)
  await waitForHudLoaded(page)
  await expect(zone(page).locator('[data-hud-value="money"]')).toHaveText('$150')
  await expect(zone(page).getByRole('button', { name: 'Turn on sound' })).toBeVisible()
  await expect(
    zone(page).locator('[data-cc-feature="cc-feature:hud-panel-buttons"]'),
  ).toBeAttached()
}

for (const viewport of VIEWPORTS) {
  const label = `${viewport.width}x${viewport.height}`

  test.describe(`HUD at ${label}`, () => {
    test.use({ viewport })

    test('cells and actions stay apart, inside the HUD, with 44 px targets', async ({
      page,
      checkA11y,
    }) => {
      await boot(page)
      const hudBox = await boxOf(zone(page), 'HUD zone')
      const cells: { name: string; box: Box }[] = []
      for (const cell of CELLS) {
        const box = await boxOf(zone(page).locator(`[data-hud-cell="${cell}"]`), cell)
        expect(inside(box, hudBox), `${cell} inside the HUD`).toBe(true)
        expect(box.width, `${cell} width`).toBeGreaterThan(0)
        cells.push({ name: cell, box })
      }
      for (const [i, a] of cells.entries()) {
        for (const b of cells.slice(i + 1)) {
          expect(apart(a.box, b.box), `${a.name} overlaps ${b.name}`).toBe(true)
        }
      }

      const buttons = await zone(page).getByRole('button').filter({ visible: true }).all()
      expect(buttons.length).toBeGreaterThanOrEqual(4)
      const boxes: { name: string; box: Box }[] = []
      for (const button of buttons) {
        const name = (await button.getAttribute('aria-label')) ?? (await button.innerText())
        const box = await boxOf(button, name)
        expect(box.width, `${name} width`).toBeGreaterThanOrEqual(44)
        expect(box.height, `${name} height`).toBeGreaterThanOrEqual(44)
        expect(inside(box, hudBox), `${name} inside the HUD`).toBe(true)
        boxes.push({ name, box })
      }
      for (const [i, a] of boxes.entries()) {
        for (const b of boxes.slice(i + 1)) {
          expect(apart(a.box, b.box), `${a.name} overlaps ${b.name}`).toBe(true)
        }
      }

      // The sound control's two lines are visible text at every width (UX-7).
      await expect(zone(page).getByText('Tap for sound', { exact: true })).toBeVisible()
      // The heading is for screen readers; the HUD has no visible title to squash (UX-8).
      await expect(zone(page).getByRole('heading', { level: 1 })).toHaveClass(/\bsr-only\b/)
      await checkA11y()
    })

    test('More holds Inventory, Rent and sound settings only where the HUD is narrow or short', async ({
      page,
    }) => {
      await boot(page)
      const wide = hudIsWide(page)
      const visible = (name: string) =>
        zone(page).getByRole('button', { name, exact: true }).filter({ visible: true })
      await expect(moreButton(page)).toHaveCount(wide ? 0 : 1)
      for (const name of ['Inventory', 'Rent', 'Sound settings']) {
        await expect(visible(name), name).toHaveCount(wide ? 1 : 0)
      }
      if (wide) return

      await moreButton(page).click()
      const panel = morePanel(page)
      await expect(panel).toBeVisible()
      await expect(moreButton(page)).toHaveAttribute('aria-expanded', 'true')
      await expect(panel.getByRole('heading', { name: 'More' })).toBeFocused()
      for (const name of ['Inventory', 'Rent', 'Sound settings']) {
        const item = panel.getByRole('button', { name, exact: true })
        await expect(item).toBeVisible()
        expect((await boxOf(item, name)).height).toBeGreaterThanOrEqual(44)
      }
      await page.keyboard.press('Escape')
      await expect(panel).toHaveCount(0)
      await expect(moreButton(page)).toBeFocused()

      // A panel opened from More hands focus back to More when it closes.
      await moreButton(page).click()
      await panel.getByRole('button', { name: 'Rent', exact: true }).click()
      const rent = page.getByRole('dialog', { name: 'Rent' })
      await expect(rent.getByRole('heading', { name: 'Rent', exact: true })).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(rent).toHaveCount(0)
      await expect(moreButton(page)).toBeFocused()

      // So does the sound settings sheet.
      await moreButton(page).click()
      await panel.getByRole('button', { name: 'Sound settings', exact: true }).click()
      const sound = page.getByRole('region', { name: 'Sound' })
      await expect(sound).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(sound).toHaveCount(0)
      await expect(moreButton(page)).toBeFocused()
    })

    test('matches its screenshot', async ({ page }) => {
      await boot(page)
      await hideSceneForScreenshot(page)
      await expect(zone(page)).toHaveScreenshot(`hud-${label}.png`)
    })
  })
}
