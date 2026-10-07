import { expect, test, waitForWelcomeGate } from './fixtures/test'
import { copyText, placeName } from './helpers/places'
import { waitForMapSettled } from './helpers/scene'
import { reloadControlled, waitForActiveWorker } from './helpers/serviceWorker'

// S08 (DEC-22): these flows are about a place's own rules, so picking a place puts the
// player there (travel itself is tests/e2e/travel.spec.ts).
test.use({ location: 'follow' })

// S04e: a returning player loads the map once, loses the network, reloads and still plays: the
// shell, the 3D chunk and the base geo come from the service worker's precache, and a solo
// action (a deli breakfast through the Places panel) runs entirely on the device.

test.use({ serviceWorkers: 'allow' })

const DELI = 'late-lantern-deli'
const BREAKFAST = 'bodega-breakfast'

test('loads, goes offline, reloads and buys a deli breakfast', async ({ page, context }) => {
  await page.goto('/')
  await waitForWelcomeGate(page)
  await waitForActiveWorker(page)
  // The worker never claims an open page: it serves from the next load on.
  await reloadControlled(page)

  await context.setOffline(true)
  await page.reload()
  await waitForWelcomeGate(page)
  await waitForMapSettled(page)
  await expect(page.locator('[data-scene-root]')).toHaveAttribute('data-scene-status', 'ready')

  const money = page.locator('[data-hud-value="money"]').first()
  await expect(money).toBeVisible()
  const cashBefore = await money.textContent()

  await page.locator('[data-places-button]').click()
  const panel = page.getByRole('dialog', { name: copyText('places.panel.title'), exact: true })
  await panel.locator(`[data-place-button="${DELI}"]`).click()
  const sheet = page.locator(`[data-place-sheet="${DELI}"]`)
  await expect(sheet.getByRole('heading', { name: placeName(DELI) })).toBeVisible()
  await sheet.locator(`button[data-place-action="${BREAKFAST}"]`).click()

  await expect(sheet.getByRole('status')).not.toBeEmpty()
  await expect(money).not.toHaveText(cashBefore ?? '')

  // A page the precache does not hold shows the offline page instead of the browser's error.
  await page.goto('/not-a-page')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(copyText('offline.title'))
  await page.getByRole('link', { name: copyText('offline.back') }).click()
  await waitForWelcomeGate(page)
  await expect(page.locator('[data-places-button]')).toBeVisible()
})
