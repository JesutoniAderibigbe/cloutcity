import type { Page } from '@playwright/test'

// S04e helpers for specs that opt in with `test.use({ serviceWorkers: 'allow' })`.

export const SERVICE_WORKER_PATH = '/serwist/sw.js'

/**
 * Waits until the app has registered its worker and the worker is active (installed, so the
 * precache is complete). The app registers once the map is playable and the browser is idle.
 */
export async function waitForActiveWorker(
  page: Page,
): Promise<{ scope: string; scriptURL: string }> {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    return { scope: registration.scope, scriptURL: registration.active?.scriptURL ?? '' }
  })
}

/** Reloads and waits until the worker controls the page (it never claims open pages). */
export async function reloadControlled(page: Page): Promise<void> {
  await page.reload()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
}

/** Every cache the page's origin holds, with the URLs stored in each. */
export async function cacheContents(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(async () => {
    const result: Record<string, string[]> = {}
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      result[name] = (await cache.keys()).map((request) => request.url)
    }
    return result
  })
}
