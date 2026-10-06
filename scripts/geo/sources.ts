/**
 * Download cache for the geo build. Raw upstream files live in the gitignored `.cache/geo/`,
 * byte for byte as downloaded (read-only, re-verified against the lock on every build), so the
 * build is reproducible offline and the MTA files stay unmodified.
 *
 * Modes:
 * - default: use the cache when it matches the lock, else download; a download whose sha256
 *   differs from the lock fails ("upstream changed") and leaves the old cache in place.
 * - update: download every source and accept what arrives, rewriting the lock.
 * - offline: never fetch; a missing or stale cache fails.
 */
import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SOURCE_DEFINITIONS, type Lock, type LockEntry, type SourceDefinition } from './lock.ts'

export type SourceMode = 'default' | 'update' | 'offline'

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface EnsureSourcesOptions {
  readonly cacheDir: string
  /** The committed lock, or undefined when there is none yet (only --update can proceed). */
  readonly lock: Lock | undefined
  readonly mode: SourceMode
  /** YYYY-MM-DD, recorded as the retrieval date of sources that changed (update mode). */
  readonly today: string
  readonly fetch?: FetchLike
  readonly log?: (line: string) => void
  /** Injected so tests do not wait for retry backoff. */
  readonly sleep?: (ms: number) => Promise<void>
}

export interface EnsuredSources {
  readonly lock: Lock
  /** Source id → raw bytes, as cached. */
  readonly files: ReadonlyMap<string, Uint8Array>
}

export const USER_AGENT = 'cloutcity-geo-build'
export const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024
const TIMEOUT_MS = 120_000
const RETRIES = 3

export const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

class HttpError extends Error {
  readonly retryable: boolean
  constructor(message: string, retryable: boolean) {
    super(message)
    this.retryable = retryable
  }
}

async function readCapped(response: Response, url: string): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > MAX_DOWNLOAD_BYTES)
    throw new HttpError(`${url}: ${declared} bytes is too large`, false)
  if (response.body === null) throw new HttpError(`${url}: empty response`, true)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_DOWNLOAD_BYTES) {
      await reader.cancel()
      throw new HttpError(`${url}: more than ${MAX_DOWNLOAD_BYTES} bytes`, false)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** HTTPS download with a timeout, a size cap and retries on network errors and 5xx. */
export async function download(
  url: string,
  fetchImpl: FetchLike,
  sleep: (ms: number) => Promise<void>,
  log: (line: string) => void,
): Promise<Uint8Array> {
  if (new URL(url).protocol !== 'https:') throw new Error(`Refusing non-https source ${url}`)
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetchImpl(url, {
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'follow',
      })
      if (!response.ok) {
        throw new HttpError(`${url}: HTTP ${response.status}`, response.status >= 500)
      }
      return await readCapped(response, url)
    } catch (error) {
      const retryable = error instanceof HttpError ? error.retryable : true
      if (!retryable || attempt >= RETRIES) throw error
      const waitMs = 1000 * 2 ** attempt
      log(
        `  retrying ${url} in ${waitMs} ms (${error instanceof Error ? error.message : String(error)})`,
      )
      await sleep(waitMs)
    }
  }
}

async function readIfExists(path: string): Promise<Uint8Array | undefined> {
  try {
    return new Uint8Array(await readFile(path))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Writes through a .part file and renames, so a crash never leaves a truncated cache file. */
async function writeCache(path: string, bytes: Uint8Array): Promise<void> {
  const part = `${path}.part`
  await rm(part, { force: true })
  await writeFile(part, bytes)
  await chmod(part, 0o444)
  await rename(part, path)
}

function lockEntryFor(lock: Lock | undefined, definition: SourceDefinition): LockEntry {
  const entry = lock?.sources.find((source) => source.id === definition.id)
  const stale =
    entry === undefined ||
    entry.url !== definition.url ||
    entry.file !== definition.file ||
    entry.title !== definition.title ||
    entry.publisher !== definition.publisher ||
    entry.catalogUrl !== definition.catalogUrl ||
    entry.terms.name !== definition.terms.name ||
    entry.terms.url !== definition.terms.url
  if (stale) {
    throw new Error(
      `scripts/geo/sources.lock.json is missing or out of date for ${definition.id}; rerun with --update`,
    )
  }
  return entry
}

export async function ensureSources(options: EnsureSourcesOptions): Promise<EnsuredSources> {
  const { cacheDir, lock, mode, today } = options
  const fetchImpl = options.fetch ?? ((url, init) => fetch(url, init))
  const log = options.log ?? (() => undefined)
  const sleep = options.sleep ?? defaultSleep
  await mkdir(cacheDir, { recursive: true })

  const entries: LockEntry[] = []
  const files = new Map<string, Uint8Array>()
  for (const definition of SOURCE_DEFINITIONS) {
    const path = join(cacheDir, definition.file)

    if (mode === 'update') {
      log(`download ${definition.id}`)
      const bytes = await download(definition.url, fetchImpl, sleep, log)
      const sha256 = sha256Hex(bytes)
      const previous = lock?.sources.find((source) => source.id === definition.id)
      const unchanged = previous?.sha256 === sha256
      await writeCache(path, bytes)
      entries.push({
        ...definition,
        retrieved: unchanged ? previous.retrieved : today,
        sha256,
        bytes: bytes.byteLength,
      })
      log(`  ${unchanged ? 'unchanged' : 'new'}: ${bytes.byteLength} bytes, sha256 ${sha256}`)
      files.set(definition.id, bytes)
      continue
    }

    const entry = lockEntryFor(lock, definition)
    const cached = await readIfExists(path)
    if (cached !== undefined && sha256Hex(cached) === entry.sha256) {
      log(`cache ${definition.id}: ok`)
      entries.push(entry)
      files.set(definition.id, cached)
      continue
    }
    if (mode === 'offline') {
      throw new Error(
        `${definition.id}: no cached copy matching the lock in ${cacheDir} (offline); run npm run geo:build once with network`,
      )
    }
    log(`download ${definition.id}${cached === undefined ? '' : ' (cache did not match the lock)'}`)
    const bytes = await download(definition.url, fetchImpl, sleep, log)
    const sha256 = sha256Hex(bytes)
    if (sha256 !== entry.sha256) {
      throw new Error(
        `${definition.id}: upstream changed (expected sha256 ${entry.sha256}, got ${sha256}); rerun with --update`,
      )
    }
    await writeCache(path, bytes)
    entries.push(entry)
    files.set(definition.id, bytes)
  }
  return { lock: { version: 1, sources: entries }, files }
}
