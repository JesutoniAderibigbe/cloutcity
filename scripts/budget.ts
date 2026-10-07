/**
 * `npm run budget`: checks the built bundle in `.next` against data/config/perf.json.
 *
 * - Shell JS of route `/`: every script the prerendered `/` HTML makes a modern browser run
 *   (external chunks plus inline scripts; `nomodule` polyfills excluded), gzipped, against
 *   `shellJsGzKB`.
 * - 3D chunk JS: the files of the lazy `next/dynamic` scene import, read from the route's
 *   react-loadable-manifest.json (minus any file the shell already loads), gzipped, against
 *   `sceneChunkJsGzKB`.
 * - Service worker (S04e): the prerendered /serwist/sw.js, gzipped, against `serviceWorkerGzKB`,
 *   and every file it precaches on install, gzipped and summed, against `precacheGzKB`.
 *
 * scripts/shell-guard.ts runs next and checks the boot path and that no test hook ships.
 * Run after `npm run build`. Sizes use KB = 1000 bytes, the stricter reading of the budget.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { z } from 'zod'
import { PerfConfigSchema } from '../src/lib/data/schemas/config.ts'

export interface ScriptRefs {
  /** `src` values of external scripts, in document order, deduplicated. */
  readonly external: readonly string[]
  /** Bodies of inline scripts. */
  readonly inline: readonly string[]
}

const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
const SRC_ATTR = /\bsrc\s*=\s*["']([^"']+)["']/i
const TYPE_ATTR = /\btype\s*=\s*["']([^"']+)["']/i
const NOMODULE_ATTR = /\bnomodule\b/i
const JS_TYPES = new Set(['', 'text/javascript', 'module', 'application/javascript'])

export function extractScripts(html: string): ScriptRefs {
  const external: string[] = []
  const inline: string[] = []
  for (const match of html.matchAll(SCRIPT_TAG)) {
    const attrs = match[1] ?? ''
    const body = match[2] ?? ''
    const type = (TYPE_ATTR.exec(attrs)?.[1] ?? '').toLowerCase()
    // JSON-LD and other data blocks are not executed JS.
    if (!JS_TYPES.has(type)) continue
    // Legacy polyfills: browsers that support ES modules (every target device) never fetch them.
    if (NOMODULE_ATTR.test(attrs)) continue
    const src = SRC_ATTR.exec(attrs)?.[1]
    if (src !== undefined) {
      if (!external.includes(src)) external.push(src)
    } else if (body.trim() !== '') {
      inline.push(body)
    }
  }
  return { external, inline }
}

/** Maps a `/_next/static/...` URL to its file under the build dir; other URLs are rejected. */
export function staticFilePath(src: string, distDir: string): string {
  const path = src.split(/[?#]/)[0] ?? ''
  const prefix = '/_next/static/'
  if (!path.startsWith(prefix)) {
    throw new Error(`Unexpected script source outside ${prefix}: ${src}`)
  }
  const relative = decodeURIComponent(path.slice(prefix.length))
  if (relative.split('/').includes('..')) throw new Error(`Refusing path traversal: ${src}`)
  return join(distDir, 'static', relative)
}

export function gzipBytes(content: string | Uint8Array): number {
  return gzipSync(content, { level: 9 }).byteLength
}

export interface BudgetResult {
  readonly name: string
  readonly actualKB: number
  readonly limitKB: number
  readonly ok: boolean
}

export function checkBudget(name: string, actualBytes: number, limitKB: number): BudgetResult {
  const actualKB = Math.round((actualBytes / 1000) * 10) / 10
  return { name, actualKB, limitKB, ok: actualBytes <= limitKB * 1000 }
}

// Only the field this script enforces is read, through the shared perf.json schema; the whole
// file is validated by src/lib/data/data.test.ts.
const ShellLimitSchema = z.object({ shellJsGzKB: PerfConfigSchema.shape.shellJsGzKB })

export function readShellLimit(perf: unknown): number {
  const result = ShellLimitSchema.safeParse(perf)
  if (!result.success) {
    throw new Error('data/config/perf.json: shellJsGzKB must be a positive number')
  }
  return result.data.shellJsGzKB
}

const SceneLimitSchema = z.object({
  sceneChunkJsGzKB: PerfConfigSchema.shape.sceneChunkJsGzKB,
})

export function readSceneChunkLimit(perf: unknown): number {
  const result = SceneLimitSchema.safeParse(perf)
  if (!result.success) {
    throw new Error('data/config/perf.json: sceneChunkJsGzKB must be a positive number')
  }
  return result.data.sceneChunkJsGzKB
}

/** `server/app/page/react-loadable-manifest.json` as Turbopack writes it (Next 16). */
const LoadableManifestSchema = z.record(z.string(), z.object({ files: z.array(z.string().min(1)) }))

/**
 * The lazily loaded JS of route `/`: every `.js` file of every dynamic import in the manifest,
 * deduplicated, minus files the shell already loads (they count once, in the shell). Paths are
 * relative to the build directory (`static/chunks/...`). Fails fast on an unexpected format or
 * an empty result, so a build change cannot turn the check into a silent pass.
 */
export function sceneChunkFiles(manifest: unknown, shellScripts: readonly string[]): string[] {
  const result = LoadableManifestSchema.safeParse(manifest)
  if (!result.success) throw new Error('react-loadable-manifest.json: unexpected format')
  const shell = new Set(shellScripts.map((src) => src.split(/[?#]/)[0]?.replace(/^\/_next\//, '')))
  const files = new Set<string>()
  for (const entry of Object.values(result.data)) {
    for (const file of entry.files) {
      if (file.split('/').includes('..')) throw new Error(`Refusing path traversal: ${file}`)
      if (file.endsWith('.js') && !shell.has(file)) files.add(file)
    }
  }
  if (files.size === 0) {
    throw new Error('react-loadable-manifest.json lists no lazy JS for /: is the 3D scene mounted?')
  }
  return [...files].sort()
}

const ServiceWorkerLimitsSchema = z.object({
  serviceWorkerGzKB: PerfConfigSchema.shape.serviceWorkerGzKB,
  precacheGzKB: PerfConfigSchema.shape.precacheGzKB,
})

export function readServiceWorkerLimits(perf: unknown): {
  serviceWorkerGzKB: number
  precacheGzKB: number
} {
  const result = ServiceWorkerLimitsSchema.safeParse(perf)
  if (!result.success) {
    throw new Error(
      'data/config/perf.json: serviceWorkerGzKB and precacheGzKB must be positive numbers',
    )
  }
  return result.data
}

/** Where the build keeps the prerendered service worker (src/app/serwist/[path]/route.ts). */
export const SERVICE_WORKER_BODY = 'server/app/serwist/sw.js.body'

const PRECACHE_URL = /\burl:\s*"([^"]+)"/g

/**
 * The URLs the service worker precaches, read from its injected manifest, deduplicated. Fails
 * fast when there are none, so a changed bundle format cannot pass as an empty precache.
 */
export function precacheUrls(swSource: string): string[] {
  const urls = [...new Set([...swSource.matchAll(PRECACHE_URL)].map((match) => match[1] ?? ''))]
  if (urls.length === 0) throw new Error('sw.js lists no precache entries: unexpected format')
  return urls
}

/**
 * Candidate files for a precached URL: build assets under `static/`, prerendered pages and
 * route bodies under `server/app/`, then `public/`. The first that exists is the one served.
 */
export function precacheFileCandidates(url: string, root: string, distDir: string): string[] {
  if (url.startsWith('/_next/static/')) return [staticFilePath(url, distDir)]
  const path = decodeURIComponent(url.split(/[?#]/)[0] ?? '')
  if (!path.startsWith('/') || path.split('/').includes('..')) {
    throw new Error(`Refusing precache URL: ${url}`)
  }
  const page = path === '/' ? 'index' : path.slice(1)
  return [
    join(distDir, 'server/app', `${page}.html`),
    join(distDir, 'server/app', `${page}.body`),
    join(root, 'public', path.slice(1)),
  ]
}

async function precacheFileBytes(url: string, root: string, distDir: string): Promise<number> {
  for (const file of precacheFileCandidates(url, root, distDir)) {
    const content = await readFile(file).catch(() => null)
    if (content !== null) return gzipBytes(content)
  }
  throw new Error(`No built file for precached URL ${url}`)
}

function report(result: BudgetResult, detail: string): string {
  const status = result.ok ? 'PASS' : 'FAIL'
  return `${status} ${result.name}: ${result.actualKB} KB gz (limit ${result.limitKB} KB)\n  ${detail}`
}

async function main(): Promise<void> {
  const root = process.cwd()
  const distDir = join(root, '.next')
  const perf: unknown = JSON.parse(await readFile(join(root, 'data/config/perf.json'), 'utf8'))
  const limitKB = readShellLimit(perf)
  const sceneLimitKB = readSceneChunkLimit(perf)

  let html: string
  try {
    html = await readFile(join(distDir, 'server/app/index.html'), 'utf8')
  } catch {
    throw new Error('No prerendered / found in .next/server/app/index.html. Run `npm run build`.')
  }

  const { external, inline } = extractScripts(html)
  if (external.length === 0) throw new Error('No external scripts found for /: unexpected build')

  let externalBytes = 0
  for (const src of external) {
    externalBytes += gzipBytes(await readFile(staticFilePath(src, distDir)))
  }
  const inlineBytes = gzipBytes(inline.join('\n'))
  const shell = checkBudget('Shell JS (/)', externalBytes + inlineBytes, limitKB)

  let manifest: unknown
  try {
    manifest = JSON.parse(
      await readFile(join(distDir, 'server/app/page/react-loadable-manifest.json'), 'utf8'),
    )
  } catch {
    throw new Error('No .next/server/app/page/react-loadable-manifest.json. Run `npm run build`.')
  }
  const sceneFiles = sceneChunkFiles(manifest, external)
  let sceneBytes = 0
  for (const file of sceneFiles) sceneBytes += gzipBytes(await readFile(join(distDir, file)))
  const scene = checkBudget('3D chunk JS (lazy)', sceneBytes, sceneLimitKB)

  const swLimits = readServiceWorkerLimits(perf)
  let swSource: string
  try {
    swSource = await readFile(join(distDir, SERVICE_WORKER_BODY), 'utf8')
  } catch {
    throw new Error(`No ${SERVICE_WORKER_BODY} in .next. Run \`npm run build\`.`)
  }
  const worker = checkBudget(
    'Service worker (/serwist/sw.js)',
    gzipBytes(swSource),
    swLimits.serviceWorkerGzKB,
  )
  const urls = precacheUrls(swSource)
  let precacheBytes = 0
  for (const url of urls) precacheBytes += await precacheFileBytes(url, root, distDir)
  const precache = checkBudget('Precache (install)', precacheBytes, swLimits.precacheGzKB)

  const lines = [
    report(
      shell,
      `${external.length} chunks: ${(externalBytes / 1000).toFixed(1)} KB gz; inline: ${(inlineBytes / 1000).toFixed(1)} KB gz`,
    ),
    report(scene, `${sceneFiles.length} chunks: ${sceneFiles.join(', ')}`),
    report(worker, `${SERVICE_WORKER_BODY}`),
    report(precache, `${urls.length} entries`),
  ]
  process.stdout.write(`${lines.join('\n')}\n`)
  if (![shell, scene, worker, precache].every((result) => result.ok)) process.exitCode = 1
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`budget: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
