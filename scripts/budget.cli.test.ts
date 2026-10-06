/**
 * `npm run budget` end to end: runs the real script against a throwaway build directory and
 * checks the exit code, so a budget that cannot fail is caught.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = join(import.meta.dirname, 'budget.ts')
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A fake project with one 20 KB-ish chunk referenced from the prerendered `/`. */
function fakeProject(perf: unknown, withBuild = true): string {
  const root = mkdtempSync(join(tmpdir(), 'budget-'))
  dirs.push(root)
  mkdirSync(join(root, 'data/config'), { recursive: true })
  writeFileSync(join(root, 'data/config/perf.json'), JSON.stringify(perf))
  if (withBuild) {
    mkdirSync(join(root, '.next/server/app'), { recursive: true })
    mkdirSync(join(root, '.next/static/chunks'), { recursive: true })
    // Incompressible-ish content so the gzipped size is predictable (well over 1 KB).
    let body = ''
    for (let i = 0; i < 4000; i += 1) body += ((i * 2654435761) >>> 0).toString(36)
    writeFileSync(join(root, '.next/static/chunks/main.js'), `var x="${body}";`)
    writeFileSync(
      join(root, '.next/server/app/index.html'),
      '<html><body><script src="/_next/static/chunks/main.js" async=""></script><script>self.__next_f=[]</script></body></html>',
    )
  }
  return root
}

function runBudget(cwd: string) {
  return spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' })
}

describe('budget CLI', () => {
  it('exits 0 and prints PASS when the build is under the limit', () => {
    const result = runBudget(fakeProject({ shellJsGzKB: 180 }))
    expect(result.stdout).toMatch(/^PASS Shell JS/m)
    expect(result.status).toBe(0)
  })

  it('exits non-zero and prints FAIL when the limit is below the measured size', () => {
    const result = runBudget(fakeProject({ shellJsGzKB: 1 }))
    expect(result.stdout).toMatch(/^FAIL Shell JS/m)
    expect(result.status).toBe(1)
  })

  it('exits non-zero when there is no build', () => {
    const result = runBudget(fakeProject({ shellJsGzKB: 180 }, false))
    expect(result.stderr).toMatch(/npm run build/)
    expect(result.status).toBe(1)
  })

  it('exits non-zero when perf.json has no valid limit', () => {
    const result = runBudget(fakeProject({ shellJsGzKB: 0 }))
    expect(result.stderr).toMatch(/shellJsGzKB/)
    expect(result.status).toBe(1)
  })

  it('exits non-zero when a referenced chunk is missing', () => {
    const root = fakeProject({ shellJsGzKB: 180 })
    rmSync(join(root, '.next/static/chunks/main.js'))
    expect(runBudget(root).status).toBe(1)
  })
})
