/**
 * Guard for the shell JS budget: classic `zod` (and the loaders that run it at import time)
 * must never be reachable from browser code. Client code validates with `zod/mini` instead.
 *
 * Browser entry points are every `'use client'` module plus everything under src/state/. The
 * test follows their runtime imports (type-only imports are erased, so they are skipped) and
 * fails if any reachable module imports `zod` or a classic-zod module under src/lib/data/.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const SRC = join(ROOT, 'src')
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs']

const isTest = (file: string) => /\.(test|spec)\.[jt]sx?$/.test(file)

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && EXTENSIONS.some((ext) => entry.name.endsWith(ext)))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => !isTest(file))
}

/** Runtime module specifiers in a file: static imports/re-exports (not `import type`) and dynamic imports. */
function runtimeSpecifiers(code: string): string[] {
  const specs: string[] = []
  const staticImport =
    /^[ \t]*(?:import|export)\s+(type\s+)?(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/gm
  for (const match of code.matchAll(staticImport)) {
    if (match[1] === undefined && match[2] !== undefined) specs.push(match[2])
  }
  for (const match of code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (match[1] !== undefined) specs.push(match[1])
  }
  return specs
}

function resolveLocal(spec: string, from: string): string | undefined {
  let base: string
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2))
  else if (spec.startsWith('@data/')) base = join(ROOT, 'data', spec.slice(6))
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec)
  else return undefined
  const candidates = [base, ...EXTENSIONS.map((ext) => base + ext)]
  candidates.push(...EXTENSIONS.map((ext) => join(base, `index${ext}`)))
  return candidates.find((file) => statSync(file, { throwIfNoEntry: false })?.isFile())
}

/** Modules that pull classic zod into whatever imports them. */
const FORBIDDEN_LOCAL = /^src\/lib\/data\/(config|content|parse|schemas\/.*)\.ts$/

function violations(entries: readonly string[]): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const queue = [...entries]
  while (queue.length > 0) {
    const file = queue.shift()
    if (file === undefined || seen.has(file) || !/\.[cm]?[jt]sx?$/.test(file)) continue
    seen.add(file)
    const rel = relative(ROOT, file)
    for (const spec of runtimeSpecifiers(readFileSync(file, 'utf8'))) {
      if (spec === 'zod' || spec.startsWith('zod/v4') || spec === 'zod/v3') {
        found.push(`${rel} imports '${spec}'`)
        continue
      }
      const target = resolveLocal(spec, file)
      if (target === undefined) continue
      const targetRel = relative(ROOT, target)
      if (FORBIDDEN_LOCAL.test(targetRel)) found.push(`${rel} imports ${targetRel}`)
      queue.push(target)
    }
  }
  return found
}

const USE_CLIENT = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/

describe('browser code stays off classic zod (shell JS budget)', () => {
  const clientEntries = sourceFiles(SRC).filter(
    (file) =>
      USE_CLIENT.test(readFileSync(file, 'utf8')) || relative(SRC, file).startsWith('state/'),
  )

  it('finds the client entry points', () => {
    expect(clientEntries.map((file) => relative(ROOT, file))).toEqual(
      expect.arrayContaining(['src/components/nav/BottomTabs.tsx', 'src/state/store.ts']),
    )
  })

  it('no client-reachable module imports zod classic or a classic-zod data loader', () => {
    expect(violations(clientEntries)).toEqual([])
  })

  it('the import scanner sees what it must (self-check)', () => {
    const code = [
      "import { z } from 'zod'",
      "import type { X } from '@/lib/data/config'",
      'import {',
      '  a,',
      "} from './multi'",
      "export { b } from './reexport'",
      "import './side-effect'",
      "const lazy = () => import('./lazy')",
    ].join('\n')
    expect(runtimeSpecifiers(code)).toEqual([
      'zod',
      './multi',
      './reexport',
      './side-effect',
      './lazy',
    ])
  })
})
