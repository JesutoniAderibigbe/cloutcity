import type { Locator, Page } from '@playwright/test'
import { expect } from '../fixtures/test'
import { copyText, placeName, readJson } from './places'

// S06: the first-run tour's coach marks in the banner zone. Specs that see it run with
// `test.use({ tour: 'fresh' })`.

export const tourConfig = readJson<{
  placeId: string
  actionId: string
  maxSteps: number
  newPlayerNoticeMax: number
  meaningfulNotices: string[]
}>('data/config/tour.json')

export const TOUR_KEY = 'cloutcity:tour'

export const tourCard = (page: Page): Locator =>
  page.locator('[data-overlay-zone="banner"]').getByRole('region', { name: copyText('tour.label') })

export async function expectStep(page: Page, step: string): Promise<void> {
  await expect(tourCard(page)).toHaveAttribute('data-tour-step', step)
}

/** The step's Next (or Done) button. */
export const tourNext = (page: Page): Locator =>
  tourCard(page).getByRole('button', { name: copyText('tour.next'), exact: true })
export const tourDone = (page: Page): Locator =>
  tourCard(page).getByRole('button', { name: copyText('tour.done'), exact: true })
export const tourSkip = (page: Page): Locator =>
  tourCard(page).getByRole('button', { name: copyText('tour.skipLabel'), exact: true })

/** The pink inset ring the step draws on its control (static under reduced motion). */
export async function expectRinged(locator: Locator): Promise<void> {
  await expect(locator).toHaveCSS('box-shadow', /inset/)
}

export async function expectNotRinged(locator: Locator): Promise<void> {
  await expect(locator).not.toHaveCSS('box-shadow', /inset/)
}

export const placesButton = (page: Page): Locator =>
  page.locator('[data-overlay-zone="hud"]').getByRole('button', { name: copyText('nav.places') })

export const targetRow = (page: Page): Locator =>
  page.locator(`[data-place-button="${tourConfig.placeId}"]`)

export const targetSheet = (page: Page): Locator =>
  page.getByRole('dialog', { name: placeName(tourConfig.placeId) })

export const targetAction = (page: Page): Locator =>
  targetSheet(page).locator(`[data-place-action="${tourConfig.actionId}"]`)

export const money = (page: Page): Locator =>
  page.locator('[data-overlay-zone="hud"] [data-hud-value="money"]')

/** The stored tour envelope, or null. */
export async function storedTour(page: Page): Promise<unknown> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw === null ? null : (JSON.parse(raw) as unknown)
  }, TOUR_KEY)
}

/** Walks from the find step to the purchase through the Places panel, the DOM path (A11Y-3). */
export async function buyThroughPlaces(page: Page): Promise<void> {
  await expectStep(page, 'find')
  await placesButton(page).click()
  await expectStep(page, 'pick')
  await targetRow(page).click()
  await expectStep(page, 'buy')
  await targetAction(page).click()
  await expectStep(page, 'cash')
}
