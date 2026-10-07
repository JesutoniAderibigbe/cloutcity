import { expect, test } from './fixtures/test'

test('the shell loads with the app name and tagline and passes axe', async ({
  page,
  checkA11y,
}) => {
  await page.goto('/')

  // The tagline is in the title and share metadata (title-meta.spec.ts); the page heading names
  // the app for screen readers, leaving the HUD's room to play (S05, Q2).
  await expect(page).toHaveTitle('Clout City: NYC | Tap In. Blow Up.')
  const heading = page.getByRole('heading', { level: 1, name: 'Clout City: NYC' })
  await expect(heading).toHaveCount(1)
  await expect(heading).toHaveClass(/\bsr-only\b/)
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
