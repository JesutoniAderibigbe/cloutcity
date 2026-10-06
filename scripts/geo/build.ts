/**
 * `npm run geo:build`: downloads the pinned geo sources into `.cache/geo/` and writes the
 * derived layers to data/geo and data/zones.
 *
 *   npm run geo:build                 use the cache, download what is missing (must match lock)
 *   npm run geo:build -- --update     download everything, accept new upstream files, rewrite lock
 *   npm run geo:build -- --offline    never touch the network
 *   npm run geo:build -- --check      rebuild in memory and fail if committed files differ
 */
import { readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { z } from 'zod'
import { GeoConfigSchema } from '../../src/lib/data/schemas/config.ts'
import { LockSchema, type Lock } from './lock.ts'
import { ensureSources, type SourceMode } from './sources.ts'
import { buildGeoOutputs, type GeoBoundsInput, type GeoBuildResult } from './transform.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const DATA = join(ROOT, 'data')
export const CACHE_DIR = join(ROOT, '.cache/geo')
export const LOCK_PATH = join(ROOT, 'scripts/geo/sources.lock.json')

/** Upstream sanity counts: 5 boroughs; 262 NTAs (the ArcGIS layer's maxRecordCount too). */
export const EXPECTED_COUNTS = { boroughs: 5, ntas: 262 } as const

/** Superseded by zones/zones.derived.json; removed on write so it cannot linger. */
const RETIRED_FILES = ['zones/zones.json']

// Only the fields used; data/geo/bounds.json is fully validated by src/lib/data/data.test.ts.
const BoundsSchema = z.object({
  west: z.number(),
  south: z.number(),
  east: z.number(),
  north: z.number(),
})

const write = (line: string) => process.stdout.write(`${line}\n`)

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

export async function readLock(path = LOCK_PATH): Promise<Lock | undefined> {
  let json: unknown
  try {
    json = await readJson(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const result = LockSchema.safeParse(json)
  if (!result.success) throw new Error(`Invalid ${path}:\n${z.prettifyError(result.error)}`)
  return result.data
}

export const lockText = (lock: Lock) => `${JSON.stringify(lock, null, 2)}\n`

export async function readBuildParams(): Promise<{
  config: z.infer<typeof GeoConfigSchema>
  bounds: GeoBoundsInput
}> {
  return {
    config: GeoConfigSchema.parse(await readJson(join(DATA, 'config/geo.json'))),
    bounds: BoundsSchema.parse(await readJson(join(DATA, 'geo/bounds.json'))),
  }
}

/** Builds from cached raw bytes (shared by the CLI and the rebuild test). */
export async function buildFromSources(
  lock: Lock,
  files: ReadonlyMap<string, Uint8Array>,
): Promise<GeoBuildResult> {
  const raw = (id: string) => {
    const bytes = files.get(id)
    if (bytes === undefined) throw new Error(`geo build: source ${id} missing`)
    return bytes
  }
  const decode = (id: string): unknown => JSON.parse(new TextDecoder().decode(raw(id)))
  return buildGeoOutputs(
    {
      boroughs: decode('dcp-borough-boundaries'),
      ntas: decode('dcp-nta-2020'),
      gtfsZip: raw('mta-gtfs-subway'),
    },
    { ...(await readBuildParams()), lock, expected: EXPECTED_COUNTS },
  )
}

function parseArgs(argv: readonly string[]): { mode: SourceMode; check: boolean } {
  const known = new Set(['--update', '--offline', '--check'])
  const unknown = argv.filter((arg) => !known.has(arg))
  if (unknown.length > 0) throw new Error(`Unknown option ${unknown.join(' ')}`)
  const update = argv.includes('--update')
  const offline = argv.includes('--offline')
  const check = argv.includes('--check')
  if (update && (offline || check))
    throw new Error('--update cannot be combined with --offline or --check')
  return { mode: update ? 'update' : offline ? 'offline' : 'default', check }
}

const kb = (bytes: number) => `${(bytes / 1000).toFixed(1)} KB`

async function main(): Promise<void> {
  const { mode, check } = parseArgs(process.argv.slice(2))
  const today = new Date().toISOString().slice(0, 10)
  const { lock, files } = await ensureSources({
    cacheDir: CACHE_DIR,
    lock: await readLock(),
    mode,
    today,
    log: write,
  })
  const result = await buildFromSources(lock, files)

  for (const ext of result.terminalExtensions) {
    write(`terminal extension: line ${ext.lineId} +${ext.gapM} m to station ${ext.stationId}`)
  }
  for (const fallback of result.stationFallbacks) write(`area fallback: ${fallback}`)
  for (const park of result.droppedParks) write(`park dropped (too small): ${park}`)

  let baseGz = 0
  for (const [path, text] of result.files) {
    const gz = gzipSync(text, { level: 9 }).byteLength
    if (path.endsWith('.derived.json') && !path.endsWith('manifest.derived.json')) baseGz += gz
    write(`${path}: ${kb(Buffer.byteLength(text))} raw, ${kb(gz)} gz`)
  }
  write(`base geo total: ${kb(baseGz)} gz`)

  if (check) {
    const differing: string[] = []
    for (const [path, text] of result.files) {
      const committed = await readFile(join(DATA, path), 'utf8').catch(() => undefined)
      if (committed !== text) differing.push(path)
    }
    if (differing.length > 0) {
      throw new Error(`Committed geo files differ from a rebuild: ${differing.join(', ')}`)
    }
    write('check: committed geo files match a rebuild')
    return
  }

  for (const [path, text] of result.files) {
    const target = join(DATA, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, text)
  }
  for (const path of RETIRED_FILES) await rm(join(DATA, path), { force: true })
  if (mode === 'update') await writeFile(LOCK_PATH, lockText(lock))
  write(`wrote ${result.files.size} files`)
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`geo:build: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
