/**
 * The inputs of one landmark's Blender build and their digest (the lock's `inputsSha`).
 *
 * The digest covers the build scripts, the PIN and the landmark's measurements byte for byte,
 * and only the parts of the shared config the build reads (its model and frame, the scene's
 * land/camera/landmarks blocks, the resolved landmark palette, the perf caps). An unrelated
 * edit to theme.json or scene.json therefore does not make a shipped model look stale.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

export const ROOT = join(import.meta.dirname, '../..')
export const BLENDER_DIR = join(ROOT, 'scripts/blender')
export const MEASUREMENTS_DIR = join(ROOT, 'data/landmarks/measurements')
export const LOCK_DIR = join(ROOT, 'data/landmarks/blender')
export const SHIPPED_DIR = join(ROOT, 'public/models/landmarks')

/** The Python module that builds a landmark: landmarks/<id with underscores>.py. */
export const landmarkModule = (id: string) => `landmarks/${id.replaceAll('-', '_')}.py`

const readJson = (path: string): unknown => JSON.parse(readFileSync(join(ROOT, path), 'utf8'))

/** JSON with object keys sorted at every depth, so the digest ignores key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')

function pythonFiles(dir: string): string[] {
  return readdirSync(join(BLENDER_DIR, dir), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.py'))
    .map((entry) => relative(BLENDER_DIR, join(entry.parentPath, entry.name)))
}

/** The build scripts a landmark's output depends on (relative to scripts/blender), sorted. */
export function scriptFiles(id: string): string[] {
  return [
    'build.py',
    'PIN',
    landmarkModule(id),
    ...pythonFiles('cclib'),
    ...pythonFiles('archetypes'),
  ]
    .map((file) => file.split('\\').join('/'))
    .sort()
}

interface Entry {
  readonly id: string
}

function entryOf<T extends Entry>(list: readonly T[], id: string, file: string): T {
  const found = list.find((item) => item.id === id)
  if (found === undefined) throw new Error(`${file} has no entry "${id}"`)
  return found
}

/** Every input of a landmark's build, as one plain object. */
export function buildInputs(id: string): Record<string, unknown> {
  const models = readJson('data/landmarks/models.json') as { models: Entry[] }
  const frames = readJson('data/landmarks/frames.derived.json') as { landmarks: Entry[] }
  const scene = readJson('data/config/scene.json') as Record<string, unknown>
  const theme = readJson('data/config/theme.json') as {
    colors: Record<string, string>
    scene: { landmarks: Record<string, string> }
  }
  const perf = readJson('data/config/perf.json') as Record<string, unknown>
  const scripts = Object.fromEntries(
    scriptFiles(id).map((file) => [file, sha256(readFileSync(join(BLENDER_DIR, file)))]),
  )
  return {
    scripts,
    measurements: sha256(readFileSync(join(MEASUREMENTS_DIR, `${id}.json`))),
    model: entryOf(models.models, id, 'models.json'),
    frame: entryOf(frames.landmarks, id, 'frames.derived.json'),
    scene: { land: scene.land, camera: scene.camera, landmarks: scene.landmarks },
    palette: Object.fromEntries(
      Object.entries(theme.scene.landmarks).map(([role, token]) => [role, theme.colors[token]]),
    ),
    perf: {
      landmarkTrianglesMax: perf.landmarkTrianglesMax,
      landmarkLodRatioMax: perf.landmarkLodRatioMax,
    },
  }
}

export function inputsSha(id: string): string {
  return sha256(canonicalJson(buildInputs(id)))
}

export function fileSha(path: string): string {
  return sha256(readFileSync(path))
}

/** Landmark ids with a measurements file: the ones the Blender pipeline builds. */
export function measuredIds(): string[] {
  return readdirSync(MEASUREMENTS_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort()
}
