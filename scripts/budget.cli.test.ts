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

/** Incompressible-ish JS, so the gzipped size is predictable (well over 1 KB). */
function noisyChunk(seed: number): string {
  let body = ''
  for (let i = 0; i < 4000; i += 1) body += (((i + seed) * 2654435761) >>> 0).toString(36)
  return `var x="${body}";`
}

/** Limits every fake project gets unless a test overrides them. */
const DEFAULT_PERF = { shellJsGzKB: 180, sceneChunkJsGzKB: 350, apartmentChunkJsGzKB: 40 }

/**
 * A fake project: one shell chunk referenced from the prerendered `/`, and the city's lazy 3D
 * chunk and the apartment's (S16, which renders its feature marker) listed in the route's
 * react-loadable-manifest.json (the format Next 16 / Turbopack writes).
 */
function fakeProject(perf: Record<string, unknown>, withBuild = true): string {
  const root = mkdtempSync(join(tmpdir(), 'budget-'))
  dirs.push(root)
  mkdirSync(join(root, 'data/config'), { recursive: true })
  writeFileSync(join(root, 'data/config/perf.json'), JSON.stringify({ ...DEFAULT_PERF, ...perf }))
  if (withBuild) {
    mkdirSync(join(root, '.next/server/app/page'), { recursive: true })
    mkdirSync(join(root, '.next/static/chunks'), { recursive: true })
    writeFileSync(join(root, '.next/static/chunks/main.js'), noisyChunk(0))
    writeFileSync(join(root, '.next/static/chunks/scene.js'), noisyChunk(7))
    writeFileSync(
      join(root, '.next/static/chunks/room.js'),
      `${noisyChunk(11)}var f="cc-feature:apartment-scene";`,
    )
    writeFileSync(
      join(root, '.next/server/app/index.html'),
      '<html><body><script src="/_next/static/chunks/main.js" async=""></script><script>self.__next_f=[]</script></body></html>',
    )
    writeFileSync(
      join(root, '.next/server/app/page/react-loadable-manifest.json'),
      JSON.stringify({
        '2135': { id: 2135, files: ['static/chunks/scene.js'] },
        '4242': { id: 4242, files: ['static/chunks/scene.js', 'static/chunks/room.js'] },
      }),
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

  it('prints PASS for the 3D chunk and fails when it is over its limit', () => {
    expect(runBudget(fakeProject({})).stdout).toMatch(/^PASS 3D chunk JS/m)
    const over = runBudget(fakeProject({ sceneChunkJsGzKB: 1 }))
    expect(over.stdout).toMatch(/^FAIL 3D chunk JS/m)
    expect(over.status).toBe(1)
  })

  it('reports the apartment chunk on its own and fails when it is over its limit', () => {
    const result = runBudget(fakeProject({}))
    expect(result.stdout).toMatch(
      /^PASS Apartment chunk JS[^\n]*\n {2}1 chunks: static\/chunks\/room\.js$/m,
    )
    expect(result.stdout).toMatch(
      /^PASS 3D chunk JS[^\n]*\n {2}1 chunks: static\/chunks\/scene\.js$/m,
    )
    const over = runBudget(fakeProject({ apartmentChunkJsGzKB: 1 }))
    expect(over.stdout).toMatch(/^FAIL Apartment chunk JS/m)
    expect(over.status).toBe(1)
  })

  it('exits non-zero when no lazy chunk renders the apartment marker', () => {
    const root = fakeProject({})
    writeFileSync(join(root, '.next/static/chunks/room.js'), noisyChunk(11))
    const result = runBudget(root)
    expect(result.stderr).toMatch(/cc-feature:apartment-scene/)
    expect(result.status).toBe(1)
  })

  it('exits non-zero when the loadable manifest is missing or lists no lazy JS', () => {
    const missing = fakeProject({})
    rmSync(join(missing, '.next/server/app/page/react-loadable-manifest.json'))
    expect(runBudget(missing).stderr).toMatch(/react-loadable-manifest/)
    expect(runBudget(missing).status).toBe(1)

    const empty = fakeProject({})
    writeFileSync(join(empty, '.next/server/app/page/react-loadable-manifest.json'), '{}')
    expect(runBudget(empty).status).toBe(1)
  })
})
