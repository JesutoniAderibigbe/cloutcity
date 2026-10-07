import { expect, type Locator, type Page } from '@playwright/test'

/**
 * The HUD's layouts (S05, data/config/layout.json): on wide screens Inventory, Rent and the
 * sound settings gear sit in the HUD; on phones and landscape phones they live in the More
 * panel. Specs about those panels reach them through these helpers on every project.
 */
const HUD_WIDE_MIN_WIDTH_PX = 640
const HUD_COMPACT_MAX_HEIGHT_PX = 479

export type HudPanelName = 'Inventory' | 'Rent' | 'Settings'

/** True when the HUD shows Inventory, Rent and the gear itself (no More button). */
export function hudIsWide(page: Page): boolean {
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('viewport size is not set')
  return viewport.width >= HUD_WIDE_MIN_WIDTH_PX && viewport.height > HUD_COMPACT_MAX_HEIGHT_PX
}

const hud = (page: Page) => page.locator('[data-overlay-zone="hud"]')

/** The More button (phones and landscape phones only). */
export const moreButton = (page: Page): Locator =>
  hud(page).getByRole('button', { name: 'More', exact: true })

/** The More panel. */
export const morePanel = (page: Page): Locator => page.getByRole('dialog', { name: 'More' })

/**
 * The HUD control that opens `name` and takes focus back when it closes: the button itself on
 * wide screens, the More button elsewhere.
 */
export function hudOpener(page: Page, name: HudPanelName): Locator {
  return hudIsWide(page) ? hud(page).getByRole('button', { name, exact: true }) : moreButton(page)
}

/** Opens Inventory, Rent or the sound settings the way a player on this screen would. */
export async function openFromHud(page: Page, name: HudPanelName): Promise<void> {
  if (hudIsWide(page)) {
    await hud(page).getByRole('button', { name, exact: true }).click()
    return
  }
  await moreButton(page).click()
  await morePanel(page).getByRole('button', { name, exact: true }).click()
}

/**
 * Holds the personal game clock still for screenshots: the page reports itself hidden, and
 * passive time never runs in a hidden tab, so the HUD keeps showing the same time. Call before
 * `page.goto`.
 */
export async function holdGameTime(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'visibilityState', { get: () => 'hidden' })
  })
}

/**
 * Waits until every HUD island has loaded (the live cells, the sound control and the panel
 * buttons), so a screenshot never catches the skeleton or a loading state.
 */
export async function waitForHudLoaded(page: Page): Promise<void> {
  const zone = hud(page)
  await expect(zone.locator('[data-hud-value="money"]')).toBeVisible()
  await expect(zone.locator('[data-hud-skeleton]')).toHaveCount(0)
  await expect(zone.locator('[data-sound-control]')).toBeVisible()
  await expect(zone.locator('[data-zone-loading]')).toHaveCount(0)
}
