/**
 * `npm run budget` end to end: runs the real script against throwaway build directories and
 * checks the exit code, so a budget that cannot fail, or a lookup that silently finds nothing,
 * is caught.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BOOT_ISLAND_FEATURES, SCENE_FEATURE } from './budget'

const SCRIPT = join(import.meta.dirname, 'budget.ts')
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Incompressible-ish JS, so the gzipped size is predictable (well over 1 KB). */
function noisyChunk(seed: number, extra = ''): string {
  let body = ''
  for (let i = 0; i < 4000; i += 1) body += (((i + seed) * 2654435761) >>> 0).toString(36)
  return `var x="${body}";${extra}`
}

/** Limits every fake project gets unless a test overrides them. */
const DEFAULT_PERF = {
  shellJsGzKB: 180,
  sceneChunkJsGzKB: 350,
  totalJsToPlayableGzKB: 550,
  baseGeoGzKB: 400,
  districtBuildingsGzKB: { low: 150, mid: 300, high: 400 },
  apartmentChunkJsGzKB: 40,
  serviceWorkerGzKB: 15,
  precacheGzKB: 1000,
}

const THREE = '"REVISION",0,"182"'
const GEO_BODY = JSON.stringify({
  format: 'cc-geo-base-v1',
  version: 'test',
  land: [],
  water: [],
  parks: [],
  subway: [],
})

/** Turbopack's compiled `import()` (Next 16). */
const loader = (files: readonly string[], id: number) =>
  `,${id},s=>{s.v(t=>Promise.all(${JSON.stringify(files)}.map(t=>s.l(t))).then(()=>t(${id})))}`

const chunk = (name: string) => `static/chunks/${name}.js`

/**
 * A fake build in the format Next 16 / Turbopack writes: a shell chunk referenced from the
 * prerendered `/`, whose loaders fetch the 3D chunk (with three and the scene marker) and every
 * boot island; the route's react-loadable-manifest.json, which also lists the apartment's
 * import (S16, whose room chunk renders its feature marker); the prerendered /geo/base body; and
 * a service worker (S04e) precaching the shell chunk and `/`.
 */
function fakeProject(perf: Record<string, unknown> = {}, files: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'budget-'))
  dirs.push(root)
  const islands = BOOT_ISLAND_FEATURES.map((island, index) => ({
    ...island,
    name: `island${index}`,
  }))
  const shellLoaders = [
    loader([chunk('scene'), chunk('shared')], 2135),
    ...islands.map((island, index) => loader([chunk(island.name), chunk('shared')], 10 + index)),
  ]
  const build: Record<string, string> = {
    'data/config/perf.json': JSON.stringify({ ...DEFAULT_PERF, ...perf }),
    '.next/server/app/index.html':
      '<html><body><script src="/_next/static/chunks/main.js" async=""></script><script>self.__next_f=[]</script></body></html>',
    '.next/server/app/page/react-loadable-manifest.json': JSON.stringify({
      '2135': { id: 2135, files: [chunk('scene'), chunk('shared')] },
      '4242': { id: 4242, files: [chunk('scene'), chunk('room')] },
    }),
    '.next/server/app/serwist/sw.js.body':
      'var m=[{url:"/_next/static/chunks/main.js",revision:null},{url:"/",revision:"r"}];',
    '.next/server/app/geo/base.body': GEO_BODY,
    [`.next/${chunk('main')}`]: noisyChunk(0, `push([0${shellLoaders.join('')}])`),
    [`.next/${chunk('scene')}`]: noisyChunk(7, `${THREE};x="${SCENE_FEATURE}"`),
    [`.next/${chunk('shared')}`]: noisyChunk(3),
    [`.next/${chunk('room')}`]: noisyChunk(13, 'var f="cc-feature:apartment-scene";'),
    [`.next/${chunk('sheet')}`]: 'x="cc-feature:event-sheet"',
  }
  for (const island of islands) {
    build[`.next/${chunk(island.name)}`] =
      island.nested === true
        ? `push([0${loader([chunk('sheet')], 99)}])`
        : noisyChunk(11, `x="${island.marker}"`)
  }
  for (const [path, content] of Object.entries({ ...build, ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return root
}

/** Adds prerendered district and block bodies for every tier. */
function withDistricts(root: string, tiers = ['low', 'mid', 'high'], seed = 21) {
  for (const tier of tiers) {
    mkdirSync(join(root, '.next/server/app/geo/districts', tier), { recursive: true })
    mkdirSync(join(root, '.next/server/app/geo/blocks'), { recursive: true })
    writeFileSync(
      join(root, `.next/server/app/geo/districts/${tier}/queens.body`),
      noisyChunk(seed),
    )
    writeFileSync(join(root, `.next/server/app/geo/blocks/${tier}.body`), noisyChunk(seed + 1))
  }
  return root
}

function runBudget(cwd: string) {
  return spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' })
}

describe('budget CLI', () => {
  it('exits 0 and prints a line per budget when the build is under every limit', () => {
    const result = runBudget(fakeProject())
    expect(result.stderr).toBe('')
    expect(result.stdout).toMatch(/^PASS Shell JS/m)
    expect(result.stdout).toMatch(/^PASS 3D chunk JS \(lazy\).*\n {2}three r182; /m)
    expect(result.stdout).toMatch(/^PASS Total JS to playable.*\n.*6 boot islands/m)
    expect(result.stdout).toMatch(/^PASS Base geo/m)
    expect(result.stdout).toMatch(/^SKIP District buildings/m)
    expect(result.stdout).toMatch(/^INFO PERF-3 duplicate modules \(report only\)/m)
    expect(result.status).toBe(0)
  })

  it.each([
    ['Shell JS', { shellJsGzKB: 1 }],
    ['3D chunk JS', { sceneChunkJsGzKB: 1 }],
    ['Total JS to playable', { totalJsToPlayableGzKB: 10 }],
    ['Base geo', { baseGeoGzKB: 0.01 }],
  ])('exits non-zero and prints FAIL when %s is over its limit', (name, perf) => {
    const result = runBudget(fakeProject(perf))
    expect(result.stdout).toMatch(new RegExp(`^FAIL ${name}`, 'm'))
    expect(result.status).toBe(1)
  })

  it('counts a file shared by the shell, the islands and the 3D chunk once in the total', () => {
    const result = runBudget(fakeProject())
    // main + scene + shared + 5 boot island chunks + the nested host: 9 distinct files.
    expect(result.stdout).toMatch(/; 9 files$/m)
  })

  it('exits non-zero when there is no build', () => {
    const root = fakeProject()
    rmSync(join(root, '.next'), { recursive: true })
    const result = runBudget(root)
    expect(result.stderr).toMatch(/npm run build/)
    expect(result.status).toBe(1)
  })

  it('exits non-zero when perf.json has no valid limit', () => {
    const result = runBudget(fakeProject({ totalJsToPlayableGzKB: 0 }))
    expect(result.stderr).toMatch(/totalJsToPlayableGzKB/)
    expect(result.status).toBe(1)
  })

  /** Removes one file from a fresh fake project. */
  const without = (path: string) => () => {
    const root = fakeProject()
    rmSync(join(root, path))
    return root
  }

  // One spawn per case: each run of the script takes about a second.
  it.each<[string, () => string, RegExp]>([
    [
      'a referenced chunk is missing',
      without(`.next/${chunk('main')}`),
      /main\.js is referenced but missing/,
    ],
    [
      'the loadable manifest is missing',
      without('.next/server/app/page/react-loadable-manifest.json'),
      /react-loadable-manifest/,
    ],
    [
      'the loadable manifest lacks the scene import',
      () => fakeProject({}, { '.next/server/app/page/react-loadable-manifest.json': '{}' }),
      /3D chunk: expected a react-loadable-manifest\.json entry/,
    ],
    [
      'the scene marker is missing (format drift)',
      () => fakeProject({}, { [`.next/${chunk('scene')}`]: noisyChunk(7, THREE) }),
      /cc-feature:city-scene, found 0/,
    ],
    [
      'the shell has no chunk loaders (format drift)',
      () => fakeProject({}, { [`.next/${chunk('main')}`]: noisyChunk(0) }),
      /shell chunk loader fetching/,
    ],
    [
      "three's REVISION is missing (format drift)",
      () => fakeProject({}, { [`.next/${chunk('scene')}`]: `x="${SCENE_FEATURE}"` }),
      /REVISION not found/,
    ],
    [
      'three is bundled twice',
      () => fakeProject({}, { [`.next/${chunk('other')}`]: THREE }),
      /three is bundled more than once/,
    ],
    [
      'a boot island cannot be found',
      () => fakeProject({}, { [`.next/${chunk('island0')}`]: noisyChunk(11) }),
      /boot island src\/components\/welcome\/WelcomeGate\.tsx/,
    ],
    ['the base geo body is missing', without('.next/server/app/geo/base.body'), /geo\/base\.body/],
    [
      'the base geo body is not the base geo',
      () => fakeProject({}, { '.next/server/app/geo/base.body': '{"format":"x"}' }),
      /not the base geo JSON/,
    ],
  ])('exits non-zero when %s', (_label, project, message) => {
    const result = runBudget(project())
    expect(result.stderr).toMatch(message)
    expect(result.status).toBe(1)
  })

  it('reports the apartment chunk on its own and fails when it is over its limit', () => {
    const result = runBudget(fakeProject())
    expect(result.stdout).toMatch(
      /^PASS Apartment chunk JS[^\n]*\n {2}1 chunks: static\/chunks\/room\.js$/m,
    )
    const over = runBudget(fakeProject({ apartmentChunkJsGzKB: 1 }))
    expect(over.stdout).toMatch(/^FAIL Apartment chunk JS/m)
    expect(over.status).toBe(1)
  })

  it('exits non-zero when no lazy chunk renders the apartment marker', () => {
    const result = runBudget(fakeProject({}, { [`.next/${chunk('room')}`]: noisyChunk(13) }))
    expect(result.stderr).toMatch(/cc-feature:apartment-scene/)
    expect(result.status).toBe(1)
  })

  it('reports the service worker and its precache, and fails either over its limit', () => {
    const result = runBudget(fakeProject())
    expect(result.stdout).toMatch(/^PASS Service worker/m)
    expect(result.stdout).toMatch(/^PASS Precache \(install\)[^\n]*\n {2}2 entries$/m)
    const over = runBudget(fakeProject({ serviceWorkerGzKB: 0.001, precacheGzKB: 1 }))
    expect(over.stdout).toMatch(/^FAIL Service worker/m)
    expect(over.stdout).toMatch(/^FAIL Precache/m)
    expect(over.status).toBe(1)
  })

  describe('district buildings', () => {
    it('checks each tier once the build has them', () => {
      const result = runBudget(withDistricts(fakeProject()))
      for (const tier of ['low', 'mid', 'high']) {
        expect(result.stdout).toMatch(new RegExp(`^PASS District buildings \\(${tier}\\)`, 'm'))
      }
      expect(result.stdout).not.toMatch(/^SKIP/m)
      expect(result.status).toBe(0)
    })

    it('fails a tier over its limit', () => {
      const tight = { districtBuildingsGzKB: { low: 1, mid: 300, high: 400 } }
      const result = runBudget(withDistricts(fakeProject(tight)))
      expect(result.stdout).toMatch(/^FAIL District buildings \(low\)/m)
      expect(result.stdout).toMatch(/^PASS District buildings \(mid\)/m)
      expect(result.status).toBe(1)
    })

    it('fails loudly when a tier has no district bodies', () => {
      const result = runBudget(withDistricts(fakeProject(), ['low', 'high']))
      expect(result.stderr).toMatch(/no mid district bodies/)
      expect(result.status).toBe(1)
    })
  })
})
