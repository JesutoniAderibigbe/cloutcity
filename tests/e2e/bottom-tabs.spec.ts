import { expect, test } from './fixtures/test'

const TAB_NAMES = ['Map', 'Phone', 'Shop', 'Me']
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
        const box = await nav.getByRole('button', { name }).boundingBox()
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
    await expect(nav.getByRole('button', { name: 'Map' })).toHaveAttribute('aria-current', 'page')

    const shop = nav.getByRole('button', { name: 'Shop' })
    if (test.info().project.use.hasTouch) await shop.tap()
    else await shop.click()
    await expect(shop).toHaveAttribute('aria-current', 'page')
    await expect(nav.getByRole('button', { name: 'Map' })).not.toHaveAttribute('aria-current')

    const me = nav.getByRole('button', { name: 'Me' })
    await me.focus()
    await page.keyboard.press('Enter')
    await expect(me).toHaveAttribute('aria-current', 'page')

    await checkA11y()
  })
})
