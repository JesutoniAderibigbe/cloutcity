import { expect, test, waitForWelcomeGate } from './fixtures/test'
import { copyText } from './helpers/places'
import {
  SERVICE_WORKER_PATH,
  cacheContents,
  reloadControlled,
  waitForActiveWorker,
} from './helpers/serviceWorker'

// S04e: the service worker. Served uncached with a strict CSP, registered for the whole origin,
// it stores only what its policy allows (src/sw/policy.ts) and replaces old versioned caches
// when a new build takes over.

test.use({ serviceWorkers: 'allow' })

const updateNotice = (page: import('@playwright/test').Page) =>
  page.locator('[data-cc-notice="update"]')

test.describe('service worker', () => {
  test('is served uncached, with a strict CSP; versioned geo is immutable', async ({ request }) => {
    const worker = await request.get(SERVICE_WORKER_PATH)
    expect(worker.ok()).toBe(true)
    const headers = worker.headers()
    expect(headers['cache-control']).toBe('no-cache, no-store, must-revalidate')
    expect(headers['content-security-policy']).toBe("default-src 'self'; script-src 'self'")
    expect(headers['content-type']).toMatch(/^application\/javascript/)
    // Never precaches audio: it loads only after the player's audio choice.
    const body = await worker.text()
    expect(body).not.toMatch(/url:"\/audio\//)
    const geoVersion = /url:"\/geo\/base\?v=([0-9a-f]{12})"/.exec(body)?.[1]
    expect(geoVersion, 'the worker precaches the versioned base geo').toBeDefined()

    const geo = await request.get(`/geo/base?v=${geoVersion}`)
    expect(geo.headers()['cache-control']).toBe('public, max-age=31536000, immutable')
    // The fallback map also renders palette and copy, which can change without the geo version.
    const fallback = await request.get(`/geo/fallback?v=${geoVersion}`)
    expect(fallback.headers()['cache-control']).not.toContain('immutable')
    // Unversioned geo is not immutable either.
    expect((await request.get('/geo/base')).headers()['cache-control']).not.toContain('immutable')
  })

  test('registers for the whole origin once the map is playable', async ({ page, baseURL }) => {
    await page.goto('/')
    await waitForWelcomeGate(page)
    const registration = await waitForActiveWorker(page)
    expect(registration.scope).toBe(`${baseURL}/`)
    expect(registration.scriptURL).toBe(`${baseURL}${SERVICE_WORKER_PATH}`)
    await reloadControlled(page)
    await expect(updateNotice(page)).toHaveCount(0)
  })

  test.describe('never-cache policy', () => {
    // The probes below request paths that do not exist on purpose; Chromium reports each 404.
    test.use({
      injectedConsoleErrors: [
        /^Failed to load resource: the server responded with a status of 404 \(Not Found\)$/,
      ],
    })

    test('never stores private, credentialed, failed or server responses', async ({
      page,
      context,
      baseURL,
    }) => {
      // Fulfilled by the test for the worker's own fetch: proves context.route sees worker
      // requests, and that a `private` response is refused.
      await context.route('**/geo/base?v=probe-private', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'cache-control': 'private, max-age=60' },
          body: '{}',
        }),
      )
      await context.route('**/geo/base?v=probe-cookie', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { vary: 'Cookie' },
          body: '{}',
        }),
      )
      await page.goto('/')
      await waitForWelcomeGate(page)
      await waitForActiveWorker(page)
      await reloadControlled(page)

      const statuses = await page.evaluate(async () => {
        const get = async (url: string, init?: RequestInit) => (await fetch(url, init)).status
        return {
          allowed: await get('/geo/base?v=probe-ok'),
          credentialed: await get('/geo/base?v=probe-auth', {
            headers: { Authorization: 'Bearer probe' },
          }),
          private: await get('/geo/base?v=probe-private'),
          cookie: await get('/geo/base?v=probe-cookie'),
          missing: await get('/geo/missing?v=probe-404'),
          api: await get('/api/probe'),
          mod: await get('/mod'),
        }
      })
      expect(statuses).toMatchObject({ allowed: 200, credentialed: 200, private: 200, cookie: 200 })

      const contents = await cacheContents(page)
      const all = Object.entries(contents).flatMap(([cache, urls]) =>
        urls.map((url) => ({ cache, url: new URL(url) })),
      )
      // Positive control: an allowed versioned geo response is stored in the geo cache.
      const allowed = all.find(({ url }) => url.searchParams.get('v') === 'probe-ok')
      expect(allowed?.cache).toMatch(/^cc-geo-[0-9a-f]{12}$/)

      for (const { cache, url } of all) {
        const where = `${cache}: ${url.href}`
        expect(url.origin, where).toBe(baseURL)
        expect(url.pathname, where).not.toMatch(/^\/(?:api|mod|serwist|og)(?:\/|$)/)
        expect(url.searchParams.get('v') ?? '', where).not.toMatch(
          /^probe-(?:auth|private|cookie|404)$/,
        )
        if (url.pathname.startsWith('/audio/')) expect(cache, where).toMatch(/^cc-audio-/)
      }
      // The precache holds the app shell and the offline page.
      const precache = Object.keys(contents).find((name) => name.startsWith('serwist-precache-'))
      expect(precache).toBeDefined()
      const precached = (contents[precache ?? ''] ?? []).map((url) => new URL(url).pathname)
      expect(precached).toEqual(expect.arrayContaining(['/', '/offline', '/geo/base']))
    })
  })

  test('a new build waits for the player, then replaces old versioned caches', async ({
    page,
    context,
    checkA11y,
  }) => {
    await page.goto('/')
    await waitForWelcomeGate(page)
    await waitForActiveWorker(page)
    await reloadControlled(page)

    // Caches an older build left behind, and one the current build owns.
    await page.evaluate(async () => {
      await (await caches.open('cc-geo-0123456789ab')).put('/geo/base?v=old', new Response('{}'))
      await (await caches.open('cc-audio-0123456789ab')).put('/audio/old.webm', new Response(''))
      await fetch('/geo/base?v=probe-kept')
    })
    const before = Object.keys(await cacheContents(page))
    const current = before.find((name) => /^cc-geo-/.test(name) && name !== 'cc-geo-0123456789ab')
    expect(current, 'the current geo cache').toBeDefined()

    // A "new build": the same worker with different bytes, served to the browser's update check.
    await context.route(`**${SERVICE_WORKER_PATH}`, async (route) => {
      const response = await route.fetch()
      await route.fulfill({ response, body: `${await response.text()}\n// next build\n` })
    })
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration()
      await registration?.update()
    })

    // The new worker waits: nothing is swapped under the player until they choose.
    const notice = updateNotice(page)
    await expect(notice).toBeVisible()
    await expect(notice).toContainText(copyText('offline.update.message'))
    await checkA11y()
    expect(Object.keys(await cacheContents(page))).toContain('cc-geo-0123456789ab')

    await Promise.all([
      page.waitForEvent('load'),
      notice.getByRole('button', { name: copyText('offline.update.action') }).click(),
    ])
    await waitForWelcomeGate(page)
    await expect
      .poll(async () => Object.keys(await cacheContents(page)))
      .not.toContain('cc-geo-0123456789ab')
    const after = Object.keys(await cacheContents(page))
    expect(after).not.toContain('cc-audio-0123456789ab')
    expect(after).toContain(current)
    await expect(updateNotice(page)).toHaveCount(0)
  })

  test('the update notice can be put off', async ({ page, context }) => {
    await page.goto('/')
    await waitForWelcomeGate(page)
    await waitForActiveWorker(page)
    await reloadControlled(page)
    await context.route(`**${SERVICE_WORKER_PATH}`, async (route) => {
      const response = await route.fetch()
      await route.fulfill({ response, body: `${await response.text()}\n// next build\n` })
    })
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())?.update()
    })
    const notice = updateNotice(page)
    await notice.getByRole('button', { name: copyText('offline.update.dismiss') }).click()
    await expect(notice).toHaveCount(0)
    // Still waiting: it takes over only once every tab of the old build has closed.
    expect(
      await page.evaluate(
        async () => ((await navigator.serviceWorker.getRegistration())?.waiting ?? null) !== null,
      ),
    ).toBe(true)
  })
})
