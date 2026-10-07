/**
 * `npm run budget`: checks the built bundle in `.next` against data/config/perf.json.
 *
 * - Shell JS of route `/`: every script the prerendered `/` HTML makes a modern browser run
 *   (external chunks plus inline scripts; `nomodule` polyfills excluded), gzipped, against
 *   `shellJsGzKB`.
 * - 3D chunk JS: the files of the lazy `next/dynamic` scene import, read from the route's
 *   react-loadable-manifest.json (minus any file the shell already loads), gzipped, against
 *   `sceneChunkJsGzKB`. This is the 3D code loaded before the map is playable.
 * - Apartment chunk JS (S16): the files only the apartment's `next/dynamic` import adds (the
 *   manifest entry whose code renders `cc-feature:apartment-scene`, minus the city's 3D chunk
 *   and the shell), gzipped, against `apartmentChunkJsGzKB`. It loads when the Home panel opens,
 *   so it is left out of the 3D chunk above. A build without that marker fails, so the split
 *   can never silently fold the apartment into the city figure or drop it.
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

const ApartmentLimitSchema = z.object({
  apartmentChunkJsGzKB: PerfConfigSchema.shape.apartmentChunkJsGzKB,
})

export function readApartmentChunkLimit(perf: unknown): number {
  const result = ApartmentLimitSchema.safeParse(perf)
  if (!result.success) {
    throw new Error('data/config/perf.json: apartmentChunkJsGzKB must be a positive number')
  }
  return result.data.apartmentChunkJsGzKB
}

/** The feature marker the apartment's 3D chunk renders (src/scene/apartment/ApartmentCanvas.tsx). */
export const APARTMENT_MARKER = 'cc-feature:apartment-scene'

/**
 * True when `marker` appears whole in `text`, not as the start of a longer id (the same rule as
 * scripts/shell-guard.ts).
 */
export function containsMarker(text: string, marker: string): boolean {
  let at = text.indexOf(marker)
  while (at !== -1) {
    if (!/^-?[a-z0-9]/.test(text.slice(at + marker.length, at + marker.length + 2))) return true
    at = text.indexOf(marker, at + 1)
  }
  return false
}

/** `server/app/page/react-loadable-manifest.json` as Turbopack writes it (Next 16). */
const LoadableManifestSchema = z.record(z.string(), z.object({ files: z.array(z.string().min(1)) }))

export interface LazyChunks {
  /** The city's 3D chunk: loaded before the map is playable. */
  readonly scene: readonly string[]
  /** What only the apartment's import adds (S16): loaded when the Home panel opens. */
  readonly apartment: readonly string[]
}

/**
 * The lazily loaded JS of route `/`, split in two: every `.js` file of every dynamic import in
 * the manifest except the apartment's (deduplicated, minus files the shell already loads: they
 * count once, in the shell), and the files only the apartment's import adds. The apartment's
 * entry is the one whose files `isApartment` (the marker check) accepts. Paths are relative to
 * the build directory (`static/chunks/...`). Fails fast on an unexpected format, no apartment
 * entry or more than one, or an empty result, so a build change cannot turn a check into a
 * silent pass.
 */
export function lazyChunkFiles(
  manifest: unknown,
  shellScripts: readonly string[],
  isApartment: (file: string) => boolean,
): LazyChunks {
  const result = LoadableManifestSchema.safeParse(manifest)
  if (!result.success) throw new Error('react-loadable-manifest.json: unexpected format')
  const shell = new Set(shellScripts.map((src) => src.split(/[?#]/)[0]?.replace(/^\/_next\//, '')))
  const entries = Object.values(result.data).map((entry) =>
    entry.files.filter((file) => {
      if (file.split('/').includes('..')) throw new Error(`Refusing path traversal: ${file}`)
      return file.endsWith('.js') && !shell.has(file)
    }),
  )
  if (entries.every((files) => files.length === 0)) {
    throw new Error('react-loadable-manifest.json lists no lazy JS for /: is the 3D scene mounted?')
  }
  const apartmentEntries = entries.filter((files) => files.some(isApartment))
  if (apartmentEntries.length !== 1) {
    throw new Error(
      `expected one lazy import rendering ${APARTMENT_MARKER}, found ${apartmentEntries.length}: is the apartment mounted with next/dynamic?`,
    )
  }
  const scene = new Set(
    entries.filter((files) => !files.some(isApartment)).flatMap((files) => files),
  )
  if (scene.size === 0) {
    throw new Error('react-loadable-manifest.json lists no lazy JS for /: is the 3D scene mounted?')
  }
  const apartment = new Set((apartmentEntries[0] ?? []).filter((file) => !scene.has(file)))
  return { scene: [...scene].sort(), apartment: [...apartment].sort() }
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
  const apartmentLimitKB = readApartmentChunkLimit(perf)

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
  const texts = new Map<string, string>()
  const read = async (file: string) => {
    const text = texts.get(file) ?? (await readFile(join(distDir, file), 'utf8'))
    texts.set(file, text)
    return text
  }
  const parsed = LoadableManifestSchema.safeParse(manifest)
  // Read every lazy file once so the marker check below can stay synchronous.
  if (parsed.success) {
    for (const entry of Object.values(parsed.data)) {
      for (const file of entry.files) {
        if (file.endsWith('.js') && !file.split('/').includes('..')) await read(file)
      }
    }
  }
  const chunks = lazyChunkFiles(manifest, external, (file) =>
    containsMarker(texts.get(file) ?? '', APARTMENT_MARKER),
  )
  const gzipped = async (files: readonly string[]) => {
    let bytes = 0
    for (const file of files) bytes += gzipBytes(await read(file))
    return bytes
  }
  const scene = checkBudget('3D chunk JS (lazy)', await gzipped(chunks.scene), sceneLimitKB)
  const apartment = checkBudget(
    'Apartment chunk JS (lazy, Home panel)',
    await gzipped(chunks.apartment),
    apartmentLimitKB,
  )

  const lines = [
    report(
      shell,
      `${external.length} chunks: ${(externalBytes / 1000).toFixed(1)} KB gz; inline: ${(inlineBytes / 1000).toFixed(1)} KB gz`,
    ),
    report(scene, `${chunks.scene.length} chunks: ${chunks.scene.join(', ')}`),
    report(apartment, `${chunks.apartment.length} chunks: ${chunks.apartment.join(', ')}`),
  ]
  process.stdout.write(`${lines.join('\n')}\n`)
  if (!shell.ok || !scene.ok || !apartment.ok) process.exitCode = 1
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`budget: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
