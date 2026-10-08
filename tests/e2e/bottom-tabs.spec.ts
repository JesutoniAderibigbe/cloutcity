import { expect, test, waitForWelcomeGate } from './fixtures/test'

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
    await expect(map).toHaveAttribute('aria-current', 'page')

    const me = nav.getByRole('button', { name: 'Me' })
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
})
