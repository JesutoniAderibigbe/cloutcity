/**
 * `npm run budget`: checks the built bundle in `.next` against data/config/perf.json.
 *
 * - Shell JS of route `/`: every script the prerendered `/` HTML makes a modern browser run
 *   (external chunks plus inline scripts; `nomodule` polyfills excluded), gzipped, against
 *   `shellJsGzKB`.
 * - 3D chunk JS: the files of the lazy `next/dynamic` scene import, read from the route's
 *   react-loadable-manifest.json (minus any file the shell already loads), gzipped, against
 *   `sceneChunkJsGzKB`.
 *
 * - Hand-made models (S04h): bytes per tier and load phase from data/assets/manifest.json, and
 *   the model loader kept out of the shell JS (scripts/budget-models.ts).
 *
 * scripts/shell-guard.ts runs next and checks the boot path and that no test hook ships.
 * Run after `npm run build`. Sizes use KB = 1000 bytes, the stricter reading of the budget.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { z } from 'zod'
import { PerfConfigSchema } from '../src/lib/data/schemas/config.ts'
import { loaderLeaks, modelBudgetLines } from './budget-models.ts'

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
  const shellCode = new Map<string, string>()
  for (const src of external) {
    const code = await readFile(staticFilePath(src, distDir))
    externalBytes += gzipBytes(code)
    shellCode.set(src, code.toString('utf8'))
  }
  shellCode.set('(inline)', inline.join('\n'))
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

  const lines = [
    report(
      shell,
      `${external.length} chunks: ${(externalBytes / 1000).toFixed(1)} KB gz; inline: ${(inlineBytes / 1000).toFixed(1)} KB gz`,
    ),
    report(scene, `${sceneFiles.length} chunks: ${sceneFiles.join(', ')}`),
  ]
  const readJson = async (file: string): Promise<unknown> =>
    JSON.parse(await readFile(join(root, file), 'utf8'))
  const models = modelBudgetLines(
    await readJson('data/assets/manifest.json'),
    perf,
    await readJson('data/config/scene.json'),
    shellCode,
  )
  lines.push(...models.map((line) => line.text))
  // The model runtime's own lazy chunk(s): loaded once the map has drawn, so outside both the
  // shell and the 3D chunk budgets; reported so its growth stays visible.
  const chunkDir = join(distDir, 'static/chunks')
  const chunks = new Map<string, string>()
  for (const name of await readdir(chunkDir)) {
    if (name.endsWith('.js')) chunks.set(name, await readFile(join(chunkDir, name), 'utf8'))
  }
  const runtime = loaderLeaks(chunks)
  const runtimeBytes = runtime.reduce((sum, name) => sum + gzipBytes(chunks.get(name) ?? ''), 0)
  lines.push(
    `INFO Model runtime JS (lazy, after the map draws): ${(runtimeBytes / 1000).toFixed(1)} KB gz in ${runtime.length} chunks`,
  )
  process.stdout.write(`${lines.join('\n')}\n`)
  if (!shell.ok || !scene.ok || models.some((line) => !line.ok)) process.exitCode = 1
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`budget: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
