import { expect, test } from './fixtures/test'

// S16a (A2.3): the creator's avatar preview in its own canvas (exercised on /dev/look until the
// creator UI lands in A3): it draws the look, plays the idle clip only while it may, pauses the
// city, and loses its WebGL context when it closes.

const preview = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const hook = window.__cloutcityTest?.avatarPreview
    return hook === undefined
      ? null
      : {
          status: hook.status(),
          look: hook.look(),
          animating: hook.animating(),
          pending: hook.pendingFrames(),
        }
  })

test('draws the look with its accessories, animates while shown, and loses its context on close', async ({
  page,
}) => {
  await page.goto('/dev/look?eyewear=glasses&ears=hearing-aid&hairStyle=afro')
  await expect.poll(async () => (await preview(page))?.status, { timeout: 60_000 }).toBe('ready')
  const state = await preview(page)
  expect(state?.look?.attachments).toEqual(['glasses', 'hearing-aid'])
  expect(state?.look?.missing).toEqual(['head-base', 'hair-afro'])
  expect(state?.animating).toBe(true)

  await page.getByRole('button', { name: 'Close preview' }).click()
  await expect
    .poll(() => page.evaluate(() => window.__cloutcityTest?.avatarPreviewClosed?.contextLost))
    .toBe(true)
  expect(await preview(page)).toBeNull()
})

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('the preview is posed once and draws nothing more', async ({ page }) => {
    await page.goto('/dev/look?seed=7')
    await expect.poll(async () => (await preview(page))?.status, { timeout: 60_000 }).toBe('ready')
    await expect.poll(async () => (await preview(page))?.pending).toBe(0)
    expect((await preview(page))?.animating).toBe(false)
  })
})
