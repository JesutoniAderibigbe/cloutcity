/**
 * `npm run budget`: checks built bundle sizes against data/config/perf.json.
 *
 * S01 scope: shell JS of route `/`, i.e. every script the prerendered `/` HTML makes a modern
 * browser run (external chunks plus inline scripts; `nomodule` polyfills excluded), gzipped,
 * against `shellJsGzKB`. Run after `npm run build`.
 * Sizes use KB = 1000 bytes, the stricter reading of the budget.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

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

export function readShellLimit(perf: unknown): number {
  if (typeof perf === 'object' && perf !== null && 'shellJsGzKB' in perf) {
    const value = perf.shellJsGzKB
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  }
  throw new Error('data/config/perf.json: shellJsGzKB must be a positive number')
}

async function main(): Promise<void> {
  const root = process.cwd()
  const distDir = join(root, '.next')
  const perf: unknown = JSON.parse(await readFile(join(root, 'data/config/perf.json'), 'utf8'))
  const limitKB = readShellLimit(perf)

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
  const result = checkBudget('Shell JS (/)', externalBytes + inlineBytes, limitKB)

  const lines = [
    `${result.ok ? 'PASS' : 'FAIL'} ${result.name}: ${result.actualKB} KB gz (limit ${result.limitKB} KB)`,
    `  ${external.length} chunks: ${(externalBytes / 1000).toFixed(1)} KB gz; inline: ${(inlineBytes / 1000).toFixed(1)} KB gz`,
  ]
  process.stdout.write(`${lines.join('\n')}\n`)
  if (!result.ok) process.exitCode = 1
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`budget: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
