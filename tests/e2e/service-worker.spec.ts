import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, waitForWelcomeGate } from './fixtures/test'
import { copyText } from './helpers/places'
import {
  QUALITY_TIERS,
  SERVICE_WORKER_PATH,
  cacheContents,
  geoCacheUrls,
  reloadControlled,
  seedQualityOverride,
  waitForActiveWorker,
  waitForLog,
  warmUrlsFromWorker,
  type Tier,
} from './helpers/serviceWorker'
import { expectStep, tourCard, tourSkip } from './helpers/tour'

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
    // Never precaches audio (it loads only after the player's audio choice) or models (they
    // load on demand, per tier).
    const body = await worker.text()
    expect(body).not.toMatch(/url:"\/audio\//)
    expect(body).not.toMatch(/url:"\/models\//)
    expect(body).not.toMatch(/url:"[^"]*\.(?:glb|map)"/)
    // No source map: the bundle names none and none is served.
    expect(body).not.toContain('sourceMappingURL')
    expect((await request.get(`${SERVICE_WORKER_PATH}.map`)).status()).toBe(404)
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

test.describe('tier warm', () => {
  async function servedWarmLists(
    request: import('@playwright/test').APIRequestContext,
  ): Promise<Record<Tier, string[]>> {
    const lists = warmUrlsFromWorker(await (await request.get(SERVICE_WORKER_PATH)).text())
    for (const tier of QUALITY_TIERS) expect(lists[tier].length, tier).toBeGreaterThan(1)
    return lists
  }

  /** Waits until every URL of `tier` is in the geo cache, then checks no other tier's is. */
  async function expectWarmed(
    page: import('@playwright/test').Page,
    lists: Record<Tier, string[]>,
    tier: Tier,
  ) {
    await expect
      .poll(async () => {
        const cached = await geoCacheUrls(page)
        return lists[tier].filter((url) => !cached.includes(url))
      })
      .toEqual([])
    const cached = await geoCacheUrls(page)
    for (const other of QUALITY_TIERS.filter((t) => t !== tier)) {
      for (const url of lists[other])
        expect(cached, `${tier} must not warm ${url}`).not.toContain(url)
    }
  }

  test("warms the detected tier's district assets once the worker is active", async ({
    page,
    request,
  }) => {
    const lists = await servedWarmLists(request)
    await page.goto('/')
    await waitForWelcomeGate(page)
    await waitForActiveWorker(page)
    // Headless Chromium renders on SwiftShader, which the picker puts on the low tier.
    await expectWarmed(page, lists, 'low')
  })

  test('warms the tier the Graphics setting chooses', async ({ page, request }) => {
    const lists = await servedWarmLists(request)
    await seedQualityOverride(page, 'mid')
    await page.goto('/')
    await waitForWelcomeGate(page)
    await waitForActiveWorker(page)
    await expectWarmed(page, lists, 'mid')
  })

  test('never warms under a data-saver request', async ({ page, request }) => {
    const lists = await servedWarmLists(request)
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'connection', {
        configurable: true,
        get: () => ({
          saveData: true,
          effectiveType: '4g',
          addEventListener() {},
          removeEventListener() {},
        }),
      })
    })
    const skipped = waitForLog(page, 'Tier warm skipped')
    await page.goto('/')
    await waitForWelcomeGate(page)
    await waitForActiveWorker(page)
    await skipped
    const cached = await geoCacheUrls(page)
    for (const tier of QUALITY_TIERS) {
      for (const url of lists[tier]) expect(cached, url).not.toContain(url)
    }
  })

  test('never warms on a low-memory device', async ({ page, request }) => {
    const lists = await servedWarmLists(request)
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'deviceMemory', {
        configurable: true,
        get: () => 1,
      })
    })
    const skipped = waitForLog(page, 'Tier warm skipped')
    await page.goto('/')
    await waitForWelcomeGate(page)
    await waitForActiveWorker(page)
    await skipped
    const cached = await geoCacheUrls(page)
    for (const url of lists.low) expect(cached, url).not.toContain(url)
  })
})

test.describe('3D models', () => {
  const manifest = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../data/assets/manifest.json'), 'utf8'),
  ) as { assetVersion: string; models: { tiers: Record<string, { file: string }> }[] }
  const file = Object.values(manifest.models[0]?.tiers ?? {})[0]?.file ?? ''

  test('are cached on first use in the versioned models cache, never precached', async ({
    page,
  }) => {
    expect(file).toMatch(/^\/models\/[a-z0-9-]+\.(?:low|mid|high)\.[0-9a-f]{8}\.glb$/)
    await page.goto('/')
    await waitForWelcomeGate(page)
    await waitForActiveWorker(page)
    await reloadControlled(page)

    const before = await cacheContents(page)
    const precache = Object.keys(before).find((name) => name.startsWith('serwist-precache-'))
    for (const url of before[precache ?? ''] ?? []) {
      expect(new URL(url).pathname, url).not.toMatch(/^\/models\//)
    }

    const statuses = await page.evaluate(async (path) => {
      const plain = await fetch(path)
      const queried = await fetch(`${path}?probe=1`)
      return [plain.status, queried.status]
    }, file)
    expect(statuses).toEqual([200, 200])

    const contents = await cacheContents(page)
    const models = Object.entries(contents).filter(([name]) => name.startsWith('cc-models-'))
    expect(models.map(([name]) => name)).toEqual([`cc-models-${manifest.assetVersion}`])
    const stored = (models[0]?.[1] ?? []).map((url) => {
      const parsed = new URL(url)
      return `${parsed.pathname}${parsed.search}`
    })
    // The content-named file is kept; the same file with a query is not a versioned model.
    expect(stored).toContain(file)
    expect(stored).not.toContain(`${file}?probe=1`)
    for (const [name, urls] of Object.entries(contents)) {
      if (name.startsWith('cc-models-')) continue
      for (const url of urls) expect(new URL(url).pathname, `${name}: ${url}`).not.toMatch(/\.glb$/)
    }
  })
})

test.describe('update notice during the tour', () => {
  test.use({ tour: 'fresh' })

  test('waits behind the tour and shows once it is skipped', async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await waitForWelcomeGate(page)
    await expectStep(page, 'hud')
    await waitForActiveWorker(page)
    await reloadControlled(page)
    await expectStep(page, 'hud')

    await context.route(`**${SERVICE_WORKER_PATH}`, async (route) => {
      const response = await route.fetch()
      await route.fulfill({ response, body: `${await response.text()}\n// next build\n` })
    })
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())?.update()
    })
    await page.waitForFunction(async () => {
      const registration = await navigator.serviceWorker.getRegistration()
      return (registration?.waiting ?? null) !== null
    })

    // A new build is waiting, but the tour holds the banner zone (GR-9).
    await expect(tourCard(page)).toBeVisible()
    await expect(updateNotice(page)).toHaveCount(0)

    await tourSkip(page).click()
    await expect(tourCard(page)).toHaveCount(0)
    await expect(updateNotice(page)).toBeVisible()
    await expect(updateNotice(page)).toContainText(copyText('offline.update.message'))
  })
})
