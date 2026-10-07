/** The geo download cache, with an injected fetch and a temp dir: no network in npm test. */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LockSchema, PartialLockSchema, SOURCE_DEFINITIONS, type Lock } from './lock'
import {
  MAX_DOWNLOAD_BYTES,
  USER_AGENT,
  download,
  ensureSources,
  sha256Hex,
  type FetchLike,
} from './sources'

const ROOT = join(import.meta.dirname, '../..')
const bytesFor = (id: string, version = 1) => new TextEncoder().encode(`${id} v${version}`)

function lockFor(version = 1): Lock {
  return {
    version: 1,
    sources: SOURCE_DEFINITIONS.map((definition) => {
      const bytes = bytesFor(definition.id, version)
      return {
        ...definition,
        retrieved: '2026-01-01',
        sha256: sha256Hex(bytes),
        bytes: bytes.byteLength,
      }
    }),
  }
}

/** Serves `bytesFor(id, version)` for each source URL and records the calls. */
function fakeFetch(version = 1) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init })
    const definition = SOURCE_DEFINITIONS.find((d) => d.url === url)
    if (definition === undefined) return new Response('nope', { status: 404 })
    return new Response(bytesFor(definition.id, version), { status: 200 })
  }
  return { fetch, calls }
}

const noSleep = async () => undefined

let cacheDir: string
beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'cc-geo-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(cacheDir, { recursive: true, force: true })
})

async function seedCache(version = 1) {
  const { fetch } = fakeFetch(version)
  await ensureSources({ cacheDir, lock: lockFor(version), mode: 'default', today: 'x', fetch })
}

describe('ensureSources', () => {
  it('downloads missing files into the cache, read-only, with the user agent and a timeout', async () => {
    const { fetch, calls } = fakeFetch()
    const result = await ensureSources({
      cacheDir,
      lock: lockFor(),
      mode: 'default',
      today: 'x',
      fetch,
    })
    expect(calls.map((c) => c.url)).toEqual(SOURCE_DEFINITIONS.map((d) => d.url))
    for (const call of calls) {
      expect(new Headers(call.init.headers).get('user-agent')).toBe(USER_AGENT)
      expect(call.init.signal).toBeInstanceOf(AbortSignal)
    }
    for (const definition of SOURCE_DEFINITIONS) {
      const path = join(cacheDir, definition.file)
      expect(new Uint8Array(await readFile(path))).toEqual(bytesFor(definition.id))
      expect((await stat(path)).mode & 0o777).toBe(0o444)
      expect(result.files.get(definition.id)).toEqual(bytesFor(definition.id))
    }
    expect((await readdir(cacheDir)).filter((f) => f.endsWith('.part'))).toEqual([])
    expect(result.lock).toEqual(lockFor())
  })

  it('uses a cache that matches the lock without fetching', async () => {
    await seedCache()
    const { fetch, calls } = fakeFetch()
    const result = await ensureSources({
      cacheDir,
      lock: lockFor(),
      mode: 'default',
      today: 'x',
      fetch,
    })
    expect(calls).toEqual([])
    expect(result.files.size).toBe(SOURCE_DEFINITIONS.length)
  })

  it('fails when upstream changed and leaves the old cache untouched', async () => {
    await seedCache()
    const stale = join(cacheDir, SOURCE_DEFINITIONS[0]?.file ?? '')
    // Simulate a corrupt cache entry so the build has to download.
    await chmod(stale, 0o644)
    await writeFile(stale, 'corrupt')
    const { fetch } = fakeFetch(2)
    await expect(
      ensureSources({ cacheDir, lock: lockFor(), mode: 'default', today: 'x', fetch }),
    ).rejects.toThrow(/upstream changed .*rerun with --update/)
    expect(await readFile(stale, 'utf8')).toBe('corrupt')
    expect((await readdir(cacheDir)).filter((f) => f.endsWith('.part'))).toEqual([])
  })

  it('--update downloads everything, accepts new hashes and dates only what changed', async () => {
    await seedCache()
    const { fetch, calls } = fakeFetch(2)
    const result = await ensureSources({
      cacheDir,
      lock: lockFor(),
      mode: 'update',
      today: '2026-10-06',
      fetch,
    })
    expect(calls).toHaveLength(SOURCE_DEFINITIONS.length)
    expect(result.lock).toEqual({
      version: 1,
      sources: lockFor(2).sources.map((s) => ({ ...s, retrieved: '2026-10-06' })),
    })
    expect(LockSchema.safeParse(result.lock).success).toBe(true)
    const definition = SOURCE_DEFINITIONS[2]
    expect(new Uint8Array(await readFile(join(cacheDir, definition?.file ?? '')))).toEqual(
      bytesFor(definition?.id ?? '', 2),
    )

    const same = await ensureSources({
      cacheDir,
      lock: result.lock,
      mode: 'update',
      today: '2026-12-31',
      fetch,
    })
    expect(same.lock.sources.map((s) => s.retrieved)).toEqual(
      SOURCE_DEFINITIONS.map(() => '2026-10-06'),
    )
  })

  it('--update from a lock missing a new source keeps the old dates and adds the new one', async () => {
    await seedCache()
    const { fetch } = fakeFetch()
    const partial = { ...lockFor(), sources: lockFor().sources.slice(0, 3) }
    expect(LockSchema.safeParse(partial).success).toBe(false)
    expect(PartialLockSchema.safeParse(partial).success).toBe(true)
    const result = await ensureSources({
      cacheDir,
      lock: partial,
      mode: 'update',
      today: '2026-10-07',
      fetch,
    })
    expect(result.lock.sources.map((s) => s.retrieved)).toEqual(
      SOURCE_DEFINITIONS.map((_, i) => (i < 3 ? '2026-01-01' : '2026-10-07')),
    )
    expect(LockSchema.safeParse(result.lock).success).toBe(true)
  })

  it('--update works without a lock; other modes need one', async () => {
    const { fetch } = fakeFetch()
    const created = await ensureSources({
      cacheDir,
      lock: undefined,
      mode: 'update',
      today: '2026-10-06',
      fetch,
    })
    expect(created.lock.sources).toHaveLength(SOURCE_DEFINITIONS.length)
    await expect(
      ensureSources({ cacheDir, lock: undefined, mode: 'default', today: 'x', fetch }),
    ).rejects.toThrow(/missing or out of date .*--update/)
  })

  it('a lock whose URL no longer matches the definitions must be updated', async () => {
    const lock = lockFor()
    const moved = { ...lock, sources: lock.sources.map((s) => ({ ...s, url: `${s.url}&x=1` })) }
    const { fetch } = fakeFetch()
    await expect(
      ensureSources({ cacheDir, lock: moved, mode: 'default', today: 'x', fetch }),
    ).rejects.toThrow(/out of date/)
  })

  it('--offline never fetches and fails without a valid cache', async () => {
    const { fetch, calls } = fakeFetch()
    await expect(
      ensureSources({ cacheDir, lock: lockFor(), mode: 'offline', today: 'x', fetch }),
    ).rejects.toThrow(/offline/)
    expect(calls).toEqual([])
    await seedCache()
    const result = await ensureSources({
      cacheDir,
      lock: lockFor(),
      mode: 'offline',
      today: 'x',
      fetch,
    })
    expect(result.files.size).toBe(SOURCE_DEFINITIONS.length)
    expect(calls).toEqual([])
  })
})

describe('download', () => {
  const url = 'https://example.org/file.zip'
  const log = () => undefined

  it('refuses plain http', async () => {
    const { fetch } = fakeFetch()
    await expect(download('http://example.org/x', fetch, noSleep, log)).rejects.toThrow(/https/)
  })

  it('retries network errors and 5xx, then succeeds', async () => {
    let attempt = 0
    const fetch: FetchLike = async () => {
      attempt++
      if (attempt === 1) throw new TypeError('fetch failed')
      if (attempt === 2) return new Response('busy', { status: 503 })
      return new Response('ok', { status: 200 })
    }
    const sleeps: number[] = []
    const bytes = await download(url, fetch, async (ms) => void sleeps.push(ms), log)
    expect(new TextDecoder().decode(bytes)).toBe('ok')
    expect(sleeps).toEqual([1000, 2000])
  })

  it('gives up after three retries', async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response('down', { status: 500 }))
    await expect(download(url, fetch, noSleep, log)).rejects.toThrow(/HTTP 500/)
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('does not retry a 4xx', async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response('gone', { status: 403 }))
    await expect(download(url, fetch, noSleep, log)).rejects.toThrow(/HTTP 403/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects a body over the size cap', async () => {
    const big = new Response(new Uint8Array(8), {
      status: 200,
      headers: { 'content-length': String(MAX_DOWNLOAD_BYTES + 1) },
    })
    await expect(download(url, async () => big, noSleep, log)).rejects.toThrow(/too large/)
  })
})

describe('cache writes and download edge cases', () => {
  const url = 'https://example.org/file.zip'
  const log = () => undefined
  const parts = async () => (await readdir(cacheDir)).filter((f) => f.endsWith('.part'))

  /** A body stream of `chunks` copies of `chunk`, optionally failing after `failAfter` chunks. */
  function streamOf(chunk: Uint8Array, chunks: number, failAfter?: number) {
    let sent = 0
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (failAfter !== undefined && sent === failAfter) {
          controller.error(new TypeError('terminated'))
          return
        }
        if (sent === chunks) {
          controller.close()
          return
        }
        sent++
        controller.enqueue(chunk)
      },
    })
  }

  it('a stale read-only .part left by a crashed run is replaced, and none is left behind', async () => {
    const definition = SOURCE_DEFINITIONS[0]
    if (definition === undefined) throw new Error('no sources')
    const part = join(cacheDir, `${definition.file}.part`)
    await writeFile(part, 'half a download')
    await chmod(part, 0o444)
    const { fetch } = fakeFetch()
    await ensureSources({ cacheDir, lock: lockFor(), mode: 'default', today: 'x', fetch })
    expect(await parts()).toEqual([])
    expect(new Uint8Array(await readFile(join(cacheDir, definition.file)))).toEqual(
      bytesFor(definition.id),
    )
  })

  it('a failed download writes nothing: no .part and the old cache file is untouched', async () => {
    await seedCache()
    const stale = join(cacheDir, SOURCE_DEFINITIONS[0]?.file ?? '')
    await chmod(stale, 0o644)
    await writeFile(stale, 'corrupt')
    const fetch: FetchLike = async () => new Response('forbidden', { status: 403 })
    await expect(
      ensureSources({ cacheDir, lock: lockFor(), mode: 'default', today: 'x', fetch }),
    ).rejects.toThrow(/HTTP 403/)
    expect(await readFile(stale, 'utf8')).toBe('corrupt')
    expect(await parts()).toEqual([])
  })

  it('--update replaces read-only (0444) cache files and leaves them read-only', async () => {
    await seedCache()
    for (const definition of SOURCE_DEFINITIONS) {
      expect((await stat(join(cacheDir, definition.file))).mode & 0o777).toBe(0o444)
    }
    const { fetch } = fakeFetch(2)
    await ensureSources({ cacheDir, lock: lockFor(), mode: 'update', today: '2026-10-06', fetch })
    for (const definition of SOURCE_DEFINITIONS) {
      const path = join(cacheDir, definition.file)
      expect(new Uint8Array(await readFile(path))).toEqual(bytesFor(definition.id, 2))
      expect((await stat(path)).mode & 0o777).toBe(0o444)
    }
    expect(await parts()).toEqual([])
  })

  it('a content-length that understates the body does not truncate it (the hash decides)', async () => {
    const body = new Uint8Array(100).fill(7)
    const fetch: FetchLike = async () =>
      new Response(body, { status: 200, headers: { 'content-length': '5' } })
    expect(await download(url, fetch, noSleep, log)).toEqual(body)
  })

  it('a content-length that overstates a small body is not trusted either', async () => {
    const body = new Uint8Array(3).fill(1)
    const fetch: FetchLike = async () =>
      new Response(body, { status: 200, headers: { 'content-length': '1000' } })
    expect(await download(url, fetch, noSleep, log)).toEqual(body)
  })

  it('stops reading a body that grows past the cap without a content-length, and does not retry', async () => {
    const chunk = new Uint8Array(1024 * 1024)
    const fetch = vi.fn<FetchLike>(
      async () => new Response(streamOf(chunk, MAX_DOWNLOAD_BYTES / chunk.byteLength + 1)),
    )
    await expect(download(url, fetch, noSleep, log)).rejects.toThrow(/more than 52428800 bytes/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('accepts a body of exactly the cap', async () => {
    const chunk = new Uint8Array(1024 * 1024)
    const fetch: FetchLike = async () =>
      new Response(streamOf(chunk, MAX_DOWNLOAD_BYTES / chunk.byteLength))
    expect((await download(url, fetch, noSleep, log)).byteLength).toBe(MAX_DOWNLOAD_BYTES)
  })

  it('retries a timeout (fresh signal each attempt) and gives up after three retries', async () => {
    const signals: (AbortSignal | null | undefined)[] = []
    const fetch = vi.fn<FetchLike>(async (_url, init) => {
      signals.push(init.signal)
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    })
    const sleeps: number[] = []
    await expect(download(url, fetch, async (ms) => void sleeps.push(ms), log)).rejects.toThrow(
      /timeout/,
    )
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(sleeps).toEqual([1000, 2000, 4000])
    expect(new Set(signals).size).toBe(4)
  })

  it('retries a body that breaks off mid-stream, then succeeds', async () => {
    let attempt = 0
    const fetch: FetchLike = async () => {
      attempt++
      if (attempt === 1) return new Response(streamOf(new Uint8Array(10), 5, 2))
      return new Response('whole', { status: 200 })
    }
    expect(new TextDecoder().decode(await download(url, fetch, noSleep, log))).toBe('whole')
    expect(attempt).toBe(2)
  })

  it('a 5xx followed by success returns the successful body', async () => {
    const statuses = [502, 504, 200]
    const fetch: FetchLike = async () => {
      const status = statuses.shift() ?? 200
      return new Response(status === 200 ? 'fine' : 'bad gateway', { status })
    }
    expect(new TextDecoder().decode(await download(url, fetch, noSleep, log))).toBe('fine')
    expect(statuses).toEqual([])
  })

  it.each(['http://example.org/x', 'ftp://example.org/x', 'file:///etc/passwd'])(
    'refuses %s without fetching',
    async (bad) => {
      const fetch = vi.fn<FetchLike>()
      await expect(download(bad, fetch, noSleep, log)).rejects.toThrow(/non-https/)
      expect(fetch).not.toHaveBeenCalled()
    },
  )
})

describe('lock schema', () => {
  const entry = lockFor().sources[0]
  if (entry === undefined) throw new Error('no sources')
  const withEntry = (patch: Record<string, unknown>) => ({
    ...lockFor(),
    sources: [{ ...entry, ...patch }, ...lockFor().sources.slice(1)],
  })

  it.each([
    '../escape.zip',
    '../../etc/passwd.geojson',
    'sub/dir.zip',
    '/abs.zip',
    'UPPER.zip',
    'file.zip.part',
    'file.exe',
    '.zip',
  ])('rejects the cache file name %s', (file) => {
    expect(LockSchema.safeParse(withEntry({ file })).success).toBe(false)
  })

  it.each(['http://example.org/a.zip', 'ftp://example.org/a.zip', 'not a url'])(
    'rejects the download url %s',
    (url) => {
      expect(LockSchema.safeParse(withEntry({ url })).success).toBe(false)
    },
  )

  it('rejects a bad hash, date or size, sources out of order, and unknown keys', () => {
    expect(LockSchema.safeParse(withEntry({ sha256: 'ABC' })).success).toBe(false)
    expect(LockSchema.safeParse(withEntry({ retrieved: '6 Oct 2026' })).success).toBe(false)
    expect(LockSchema.safeParse(withEntry({ bytes: 0 })).success).toBe(false)
    expect(LockSchema.safeParse(withEntry({ extra: true })).success).toBe(false)
    const lock = lockFor()
    expect(LockSchema.safeParse({ ...lock, sources: [...lock.sources].reverse() }).success).toBe(
      false,
    )
    expect(LockSchema.safeParse(lock).success).toBe(true)
  })
})

describe('committed lock and cache location', () => {
  it('scripts/geo/sources.lock.json is valid and matches the source definitions', () => {
    const lock = LockSchema.parse(
      JSON.parse(readFileSync(join(ROOT, 'scripts/geo/sources.lock.json'), 'utf8')),
    )
    expect(
      lock.sources.map(({ id, title, publisher, catalogUrl, url, file, terms }) => ({
        id,
        title,
        publisher,
        catalogUrl,
        url,
        file,
        terms,
      })),
    ).toEqual(SOURCE_DEFINITIONS)
  })

  it('the download cache is gitignored', () => {
    expect(readFileSync(join(ROOT, '.gitignore'), 'utf8')).toMatch(/^\/\.cache\/$/m)
    if (!existsSync(join(ROOT, '.git'))) return
    const ignored = execFileSync('git', ['check-ignore', '.cache/geo/mta-gtfs-subway.zip'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    expect(ignored.trim()).toBe('.cache/geo/mta-gtfs-subway.zip')
  })
})
