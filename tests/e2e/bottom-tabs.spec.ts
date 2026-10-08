import type { Page } from '@playwright/test'
import { expect, test, waitForWelcomeGate } from './fixtures/test'
import { waitForMapSettled } from './helpers/scene'

const camera = async (page: Page) => {
  const state = await page.evaluate(() => window.__cloutcityTest?.scene?.camera() ?? null)
  if (state === null) throw new Error('no camera state')
  return state
}

const TAB_NAMES = ['Home', 'Map', 'Phone', 'Shop', 'Me']
const HOME_PANEL = '[data-hud-panel-dialog="home"]'
const MIN_TARGET_PX = 44

test.describe('bottom tab bar', () => {
  test('sits at the bottom edge, spans the width and has 44 px targets', async ({ page }) => {
    await page.goto('/')
    const viewport = page.viewportSize()
    if (!viewport) throw new Error('viewport size is not set')

    const nav = page.getByRole('navigation', { name: 'Main' })
    const navBox = await nav.boundingBox()
    if (!navBox) throw new Error('tab bar is not rendered')
    expect(navBox.x).toBe(0)
    expect(navBox.width).toBe(viewport.width)
    expect(navBox.y + navBox.height).toBe(viewport.height)

    const buttons = nav.getByRole('button')
    await expect(buttons).toHaveCount(TAB_NAMES.length)
    for (const [i, name] of TAB_NAMES.entries()) {
      await expect(buttons.nth(i)).toHaveAccessibleName(name)
    }

    const boxes = await Promise.all(
      TAB_NAMES.map(async (name) => {
        const box = await nav.getByRole('button', { name, exact: true }).boundingBox()
        if (!box) throw new Error(`${name} tab is not rendered`)
        return box
      }),
    )
    for (const [i, box] of boxes.entries()) {
      expect(box.width, TAB_NAMES[i]).toBeGreaterThanOrEqual(MIN_TARGET_PX)
      expect(box.height, TAB_NAMES[i]).toBeGreaterThanOrEqual(MIN_TARGET_PX)
      expect(box.width).toBeCloseTo(viewport.width / TAB_NAMES.length, 0)
      // Left to right, edge to edge, no gaps or overlaps.
      const previous = boxes[i - 1]
      expect(box.x).toBeCloseTo(previous ? previous.x + previous.width : 0, 0)
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
    }
  })

  test('selecting a tab marks it current, by touch or keyboard', async ({ page, checkA11y }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Main' })
    const map = nav.getByRole('button', { name: 'Map', exact: true })
    // The game starts on Home (DEC-59): let its panel open before choosing another tab.
    await expect(page.locator(HOME_PANEL)).toBeVisible({ timeout: 20_000 })
    await expect(nav.getByRole('button', { name: 'Home', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(map).not.toHaveAttribute('aria-current')

    const me = nav.getByRole('button', { name: 'Me', exact: true })
    if (test.info().project.use.hasTouch) await me.tap()
    else await me.click()
    await expect(me).toHaveAttribute('aria-current', 'page')
    await expect(map).not.toHaveAttribute('aria-current')
    // The Me panel loads lazily and takes focus when it opens: let it, before the keyboard part.
    await expect(
      page.getByRole('dialog', { name: 'Me' }).getByRole('heading', { name: 'Me' }),
    ).toBeFocused()

    await map.focus()
    await page.keyboard.press('Enter')
    await expect(map).toHaveAttribute('aria-current', 'page')
    await expect(me).not.toHaveAttribute('aria-current')

    await checkA11y()
  })

  test('Phone opens the app grid and Shop the store directory (S58)', async ({ page }) => {
    await page.goto('/')
    await waitForWelcomeGate(page)
    const nav = page.getByRole('navigation', { name: 'Main' })
    const phone = nav.getByRole('button', { name: 'Phone', exact: true })
    await phone.click()
    await expect(phone).toHaveAttribute('aria-current', 'page')
    const dialog = page.getByRole('dialog', { name: 'Phone' })
    await expect(dialog.getByRole('list', { name: 'Apps' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Bank', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Bank' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog.getByRole('button', { name: 'Bank', exact: true })).toBeFocused()

    const shop = nav.getByRole('button', { name: 'Shop', exact: true })
    await shop.click()
    await expect(shop).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('dialog', { name: 'Shop' })).toBeVisible()
    await nav.getByRole('button', { name: 'Map', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Shop' })).toBeHidden()
  })

  test('Map always brings the map to the front, and on the map glides back to the player', async ({
    page,
  }, testInfo) => {
    // The 3D map settles several times on the CPU (SwiftShader).
    test.setTimeout(60_000)
    await page.goto('/')
    await waitForWelcomeGate(page)
    await waitForMapSettled(page)
    const nav = page.getByRole('navigation', { name: 'Main' })
    const map = nav.getByRole('button', { name: 'Map', exact: true })

    // The game starts on Home (DEC-59): Map closes it and its room.
    await expect(page.locator(HOME_PANEL)).toBeVisible({ timeout: 20_000 })
    await map.click()
    await expect(page.locator(HOME_PANEL)).toHaveCount(0)
    await expect(page.locator('[data-scene-hidden]')).toHaveCount(0)
    await expect(map).toHaveAttribute('aria-current', 'page')
    await waitForMapSettled(page)
    const home = await camera(page)

    // The Places list, then a place sheet, close too: Map is already current over both.
    await page.locator('[data-places-button]').click()
    await expect(page.locator('[data-places-panel]')).toBeVisible()
    await map.click()
    await expect(page.locator('[data-places-panel]')).toHaveCount(0)
    await page.locator('[data-places-button]').click()
    await page.locator('[data-place-button]:not([data-place-button="home"])').first().click()
    await expect(page.locator('[data-place-sheet]')).toBeVisible()
    await map.click()
    await expect(page.locator('[data-place-sheet]')).toHaveCount(0)

    // Panned away (the place pick flew the camera too), Map glides back to the default view.
    if (!testInfo.project.use.hasTouch) {
      const box = await page.locator('[data-scene-root] canvas').boundingBox()
      if (!box) throw new Error('no map canvas')
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      await page.mouse.move(x + 150, y)
      await page.mouse.down()
      await page.mouse.move(x - 150, y - 100, { steps: 4 })
      await page.mouse.up()
    }
    await waitForMapSettled(page)
    const away = await camera(page)
    expect(
      Math.hypot(away.target.x - home.target.x, away.target.z - home.target.z),
    ).toBeGreaterThan(10)
    await map.click()
    await expect
      .poll(async () => {
        const back = await camera(page)
        return (
          Math.hypot(back.target.x - home.target.x, back.target.z - home.target.z) < 1 &&
          Math.abs(back.distance - home.distance) < 1
        )
      })
      .toBe(true)
  })
})
