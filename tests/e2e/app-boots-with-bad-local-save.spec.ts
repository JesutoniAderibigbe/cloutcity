import type { Page } from '@playwright/test'
// src/state/store.ts STORE_KEY. Not imported: Playwright's loader cannot load the store's JSON imports.
const STORE_KEY = 'cloutcity:game'
import { expect, test } from './fixtures/test'

/**
 * Solo play must never be blocked by what is (or is not) in localStorage: an old-format save,
 * a corrupt save, or storage that throws on access (Safari private mode, blocked site data).
 * The console guard fails each test on any uncaught error or console warning.
 */

async function expectShell(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Clout City: NYC' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
}

test('the app boots over a save from an older format', async ({ page }) => {
  await page.addInitScript(
    (key) => localStorage.setItem(key, JSON.stringify({ state: { money: 5 }, version: 0 })),
    STORE_KEY,
  )
  await expectShell(page)
})

test('the app boots over a corrupt save', async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, '{not json'), STORE_KEY)
  await expectShell(page)
})

test('the app boots when localStorage throws on access', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })
  })
  await expectShell(page)
})
