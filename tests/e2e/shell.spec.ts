import { expect, test } from './fixtures/test'

test('the shell loads with the app name and tagline and passes axe', async ({
  page,
  checkA11y,
}) => {
  await page.goto('/')

  await expect(page).toHaveTitle('Clout City: NYC | Tap In. Blow Up.')
  await expect(page.getByRole('heading', { level: 1, name: 'Clout City: NYC' })).toBeVisible()
  await expect(page.getByText('Tap In. Blow Up.')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()

  await checkA11y()
})

test('the shell does not scroll', async ({ page }) => {
  await page.goto('/')
  const scroll = await page.evaluate(() => {
    window.scrollTo(0, 500)
    const root = document.scrollingElement
    return { y: window.scrollY, overflow: root ? root.scrollHeight - root.clientHeight : -1 }
  })
  expect(scroll).toEqual({ y: 0, overflow: 0 })
})
