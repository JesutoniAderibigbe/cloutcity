/**
 * Pinned downloads (S04h): --update records the full closure of each glTF (buffers, textures) at
 * the pinned commit, later builds re-verify every file against the lock, and a changed upstream
 * file, a missing cache offline, an unpinned entry or a licence file without the expected phrases
 * all fail.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sha256Hex } from '../geo/sources.ts'
import { ensurePacks, externalUris, readGltfContainer, remoteUrl, resolveUri } from './fetch.ts'
import { CatalogSchema, SourcesLockSchema, type Catalog } from './schema.ts'

const LICENCE = 'License: (Creative Commons Zero, CC0)'
const COMMIT = 'a'.repeat(40)
const encode = (text: string) => new TextEncoder().encode(text)

const catalog = (licencePhrase = LICENCE): Catalog =>
  CatalogSchema.parse({
    version: 1,
    maxDeltaE: 10,
    sources: [
      {
        id: 'repo-pack',
        kind: 'cc0-pack',
        title: 'Repo pack',
        version: '1.0',
        author: 'Someone',
        homepage: 'https://example.org/repo-pack',
        licence: 'CC0-1.0',
        licenceEvidence: { entry: 'LICENSE.txt', mustContain: [licencePhrase] },
        download: { kind: 'github-raw', repo: 'owner/pack', commit: COMMIT, root: 'gltf' },
        factorEncoding: 'linear',
        grade: { lightness: 1, chroma: 1 },
      },
      {
        id: 'zip-pack',
        kind: 'cc0-pack',
        title: 'Zip pack',
        version: '2.0',
        author: 'Someone',
        homepage: 'https://example.org/zip-pack',
        licence: 'CC0-1.0',
        licenceEvidence: { entry: 'License.txt', mustContain: [licencePhrase] },
        download: {
          kind: 'zip',
          url: 'https://example.org/zip-pack.zip',
          file: 'zip-pack.zip',
          root: 'Models',
        },
        factorEncoding: 'srgb',
        grade: { lightness: 1, chroma: 1 },
      },
    ],
    models: ['repo-pack', 'zip-pack'].map((source) => ({
      id: `${source}-model`,
      source,
      kind: 'static',
      entries: [{ path: source === 'repo-pack' ? 'car.gltf' : 'tree.glb' }],
      category: 'street-prop',
      fit: { scale: 1 },
      pivot: 'bottom-center',
      tiers: Object.fromEntries(['low', 'mid', 'high'].map((t) => [t, { ratio: 1, error: 0 }])),
      swatches: [],
      emissive: [],
      slots: [],
      clips: [],
      loadPhase: 'after-playable',
      instanced: false,
      nameKey: 'models.name.test',
    })),
    excluded: [],
  })

const gltf = JSON.stringify({
  asset: { version: '2.0' },
  buffers: [{ uri: 'car.bin', byteLength: 4 }],
  images: [{ uri: 'textures/atlas%20map.png' }, { uri: 'data:image/png;base64,AAAA' }],
})

function upstream(): Map<string, Uint8Array> {
  const base = `https://raw.githubusercontent.com/owner/pack/${COMMIT}`
  return new Map([
    [`${base}/LICENSE.txt`, encode(`Pack\n${LICENCE}\n`)],
    [`${base}/gltf/car.gltf`, encode(gltf)],
    [`${base}/gltf/car.bin`, new Uint8Array([1, 2, 3, 4])],
    [`${base}/gltf/textures/atlas%20map.png`, new Uint8Array([9, 9])],
    [
      'https://example.org/zip-pack.zip',
      zipSync({ 'License.txt': encode(LICENCE), 'Models/tree.glb': new Uint8Array([7]) }),
    ],
  ])
}

let cacheDir: string
let files: Map<string, Uint8Array>
let fetched: string[]
const fakeFetch = async (url: string) => {
  fetched.push(url)
  const body = files.get(url)
  return body === undefined
    ? new Response('missing', { status: 404 })
    : new Response(new Uint8Array(body))
}

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'cc-assets-lock-'))
  files = upstream()
  fetched = []
})
afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true })
})

const run = (mode: 'default' | 'update' | 'offline', lock?: unknown, cat = catalog()) =>
  ensurePacks({
    root: cacheDir,
    cacheDir,
    catalog: cat,
    lock: lock === undefined ? undefined : SourcesLockSchema.parse(lock),
    mode,
    today: '2026-10-07',
    fetch: fakeFetch,
    sleep: async () => undefined,
  })

describe('glTF resources', () => {
  it('lists external buffer and image URIs (not data: URIs) and resolves them inside the pack', () => {
    const { json } = readGltfContainer(encode(gltf))
    expect(externalUris(json)).toEqual(['car.bin', 'textures/atlas%20map.png'])
    expect(resolveUri('gltf/car.gltf', 'textures/atlas%20map.png')).toBe(
      'gltf/textures/atlas map.png',
    )
    expect(() => resolveUri('gltf/car.gltf', '../../secret')).toThrow(/outside the pack/)
  })
})

describe('ensurePacks', () => {
  it('--update pins the licence, every entry and everything each glTF names, at the commit', async () => {
    const { lock, packs } = await run('update')
    const repo = lock.sources.find((s) => s.id === 'repo-pack')
    expect(repo?.retrieved).toBe('2026-10-07')
    expect(repo?.files.map((f) => f.path)).toEqual([
      'LICENSE.txt',
      'gltf/car.bin',
      'gltf/car.gltf',
      'gltf/textures/atlas map.png',
    ])
    for (const file of repo?.files ?? []) {
      expect(file.url.startsWith(`https://raw.githubusercontent.com/owner/pack/${COMMIT}/`)).toBe(
        true,
      )
      expect(file.sha256).toBe(sha256Hex(files.get(file.url) ?? new Uint8Array()))
    }
    expect(lock.sources.find((s) => s.id === 'zip-pack')?.files).toHaveLength(1)
    expect(packs.get('zip-pack')?.files.get('Models/tree.glb')).toEqual(new Uint8Array([7]))
  })

  it('reuses a cache that matches the lock without touching the network', async () => {
    const { lock } = await run('update')
    fetched = []
    const again = await run('offline', lock)
    expect(fetched).toEqual([])
    expect(again.lock).toEqual(lock)
    expect((await run('default', lock)).lock).toEqual(lock)
    expect(fetched).toEqual([])
  })

  it('keeps the retrieval date when an update finds nothing new', async () => {
    const { lock } = await run('update')
    const dated = { ...lock, sources: lock.sources.map((s) => ({ ...s, retrieved: '2026-01-01' })) }
    const { lock: updated } = await run('update', dated)
    expect(updated.sources.every((s) => s.retrieved === '2026-01-01')).toBe(true)
  })

  it('fails when upstream changed, re-downloading a damaged cache file', async () => {
    const { lock } = await run('update')
    const zipPath = join(cacheDir, 'zip-pack.zip')
    await rm(zipPath, { force: true })
    files.set('https://example.org/zip-pack.zip', zipSync({ 'License.txt': encode(LICENCE) }))
    await expect(run('default', lock)).rejects.toThrow(/zip-pack\.zip changed upstream/)
  })

  it('fails offline when the cache is missing or does not match', async () => {
    const { lock } = await run('update')
    await rm(join(cacheDir, 'repo-pack'), { recursive: true, force: true })
    await expect(run('offline', lock)).rejects.toThrow(/no cached copy matching the lock/)
    await run('update')
    const tampered = join(cacheDir, 'zip-pack.zip')
    await rm(tampered, { force: true })
    await writeFile(tampered, encode('tampered'))
    await expect(run('offline', lock)).rejects.toThrow(/zip-pack/)
  })

  it('fails without a lock entry, or when an entry or the commit is not pinned', async () => {
    await expect(run('default')).rejects.toThrow(/not in scripts\/assets\/sources\.lock\.json/)
    const { lock } = await run('update')
    const withoutCar = {
      ...lock,
      sources: lock.sources.map((s) =>
        s.id === 'repo-pack'
          ? { ...s, files: s.files.filter((f) => f.path !== 'gltf/car.gltf') }
          : s,
      ),
    }
    await expect(run('default', withoutCar)).rejects.toThrow(/gltf\/car\.gltf is not pinned/)
    const otherCommit = {
      ...lock,
      sources: lock.sources.map((s) => ({
        ...s,
        files: s.files.map((f) => ({ ...f, url: f.url.replace(COMMIT, 'b'.repeat(40)) })),
      })),
    }
    await expect(run('default', otherCommit)).rejects.toThrow(/another commit|catalog URL differs/)
  })

  it('fails when the licence file lacks the phrases the catalog expects', async () => {
    await expect(run('update', undefined, catalog('All rights reserved'))).rejects.toThrow(
      /LICENSE\.txt does not contain "All rights reserved"/,
    )
  })

  it('caches repo files under the source id and builds raw URLs at the commit', async () => {
    await run('update')
    const cached = await readFile(join(cacheDir, 'repo-pack', 'gltf', 'car.bin'))
    expect([...cached]).toEqual([1, 2, 3, 4])
    const source = catalog().sources[0]
    if (source === undefined) throw new Error('fixture')
    expect(remoteUrl(source, 'gltf/a b.gltf')).toBe(
      `https://raw.githubusercontent.com/owner/pack/${COMMIT}/gltf/a%20b.gltf`,
    )
  })
})

describe('Drive files and itch uploads (S16b)', () => {
  const DRIVE_LICENCE = 'CC0 1.0 Universal (CC0 1.0)'
  const ids = { licence: 'L'.repeat(24), casual: 'C'.repeat(24) }
  const itchPage = 'https://someone.itch.io/anims'
  const signed = 'https://mirror.example.org/signed/anims.zip?token=1'

  const s16bCatalog = (): Catalog =>
    CatalogSchema.parse({
      version: 1,
      maxDeltaE: 10,
      sources: [
        {
          id: 'drive-pack',
          kind: 'cc0-pack',
          title: 'Drive pack',
          version: '2022-02',
          author: 'Someone',
          homepage: 'https://example.org/drive-pack',
          licence: 'CC0-1.0',
          licenceEvidence: { entry: 'License.txt', mustContain: [DRIVE_LICENCE] },
          download: {
            kind: 'gdrive-files',
            files: [
              { path: 'License.txt', id: ids.licence },
              { path: 'glTF/Casual.gltf', id: ids.casual },
            ],
          },
          factorEncoding: 'linear',
          grade: { lightness: 1, chroma: 1 },
        },
        {
          id: 'itch-pack',
          kind: 'cc0-pack',
          title: 'Itch pack',
          version: '1.0',
          author: 'Someone',
          homepage: itchPage,
          licence: 'CC0-1.0',
          licenceEvidence: { entry: 'Anims/License.txt', mustContain: [DRIVE_LICENCE] },
          download: {
            kind: 'itch',
            page: itchPage,
            uploadId: 42,
            file: 'anims.zip',
            root: 'Anims/glb',
          },
          factorEncoding: 'linear',
          grade: { lightness: 1, chroma: 1 },
        },
      ],
      models: [],
      excluded: [],
    })

  const driveUrl = (id: string) =>
    `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`
  let posts: { url: string; cookie: string | null; body: string }[]

  beforeEach(() => {
    posts = []
    files.set(driveUrl(ids.licence), encode(`Pack\n${DRIVE_LICENCE}\n`))
    files.set(driveUrl(ids.casual), encode('{"asset":{"version":"2.0"}}'))
    files.set(
      signed,
      zipSync({
        'Anims/License.txt': encode(DRIVE_LICENCE),
        'Anims/glb/a.glb': new Uint8Array([5]),
      }),
    )
  })

  const itchFetch = async (url: string, init: RequestInit) => {
    if (url === itchPage) {
      return new Response('<head><meta name="csrf_token" value="tok=="/></head>', {
        headers: { 'set-cookie': 'itchio_token=abc; Path=/; HttpOnly' },
      })
    }
    if (url === `${itchPage}/file/42?source=game_download`) {
      posts.push({
        url,
        cookie: new Headers(init.headers).get('cookie'),
        body: String(init.body),
      })
      return Response.json({ url: signed, external: false })
    }
    return fakeFetch(url)
  }

  const runS16b = (mode: 'default' | 'update' | 'offline', lock?: unknown) =>
    ensurePacks({
      root: cacheDir,
      cacheDir,
      catalog: s16bCatalog(),
      lock: lock === undefined ? undefined : SourcesLockSchema.parse(lock),
      mode,
      today: '2026-10-08',
      fetch: itchFetch,
      sleep: async () => undefined,
    })

  it('--update pins every listed Drive file by id and the itch upload by its endpoint', async () => {
    const { lock, packs } = await runS16b('update')
    const drive = lock.sources.find((s) => s.id === 'drive-pack')
    expect(drive?.files.map((f) => [f.path, f.url])).toEqual([
      ['License.txt', driveUrl(ids.licence)],
      ['glTF/Casual.gltf', driveUrl(ids.casual)],
    ])
    const itch = lock.sources.find((s) => s.id === 'itch-pack')
    expect(itch?.files).toEqual([
      expect.objectContaining({ path: 'anims.zip', url: `${itchPage}/file/42` }),
    ])
    expect(posts).toEqual([
      {
        url: `${itchPage}/file/42?source=game_download`,
        cookie: 'itchio_token=abc',
        body: 'csrf_token=tok%3D%3D',
      },
    ])
    expect(packs.get('itch-pack')?.files.get('Anims/glb/a.glb')).toEqual(new Uint8Array([5]))
    fetched = []
    await runS16b('offline', lock)
    await runS16b('default', lock)
    expect(fetched).toEqual([])
  })

  it('refuses an HTML page from Drive in place of the file', async () => {
    files.set(driveUrl(ids.casual), encode('  <!DOCTYPE html><html>Quota exceeded</html>'))
    await expect(runS16b('update')).rejects.toThrow(/answered with an HTML page/)
  })

  it('fails on a changed upstream file, a re-pointed Drive id and a stale cache offline', async () => {
    const { lock } = await runS16b('update')
    await rm(join(cacheDir, 'drive-pack'), { recursive: true, force: true })
    files.set(driveUrl(ids.casual), encode('{"asset":{"version":"2.0"},"changed":true}'))
    await expect(runS16b('default', lock)).rejects.toThrow(/Casual\.gltf changed upstream/)
    await expect(runS16b('offline', lock)).rejects.toThrow(/no cached copy matching the lock/)
    const repointed = {
      ...lock,
      sources: lock.sources.map((s) => ({
        ...s,
        files: s.files.map((f) => ({ ...f, url: f.url.replace(ids.licence, 'X'.repeat(24)) })),
      })),
    }
    await expect(runS16b('default', repointed)).rejects.toThrow(/another Drive id/)
    files.set(driveUrl(ids.casual), encode('{"asset":{"version":"2.0"}}'))
    await runS16b('default', lock)
    await rm(join(cacheDir, 'anims.zip'), { force: true })
    await writeFile(join(cacheDir, 'anims.zip'), encode('stale'))
    await expect(runS16b('offline', lock)).rejects.toThrow(/anims\.zip has no cached copy/)
  })

  it('needs a Drive id for every entry and an itch.io page', () => {
    const cat = s16bCatalog()
    const [drive, itch] = cat.sources
    expect(() => remoteUrl(drive as Catalog['sources'][number], 'glTF/Suit.gltf')).toThrow(
      /has no Drive id/,
    )
    const offsite = {
      ...cat,
      sources: [{ ...itch, download: { ...itch?.download, page: 'https://example.org/anims' } }],
    }
    expect(CatalogSchema.safeParse(offsite).success).toBe(false)
  })
})
