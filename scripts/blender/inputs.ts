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
export const SHIPPED_DIR = join(ROOT, 'public/landmarks')

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

/** The archetypes a module imports (`from archetypes import a, b`), followed transitively. */
function archetypesOf(file: string, seen: Set<string> = new Set()): Set<string> {
  const source = readFileSync(join(BLENDER_DIR, file), 'utf8')
  for (const match of source.matchAll(/^from archetypes import ([\w, ]+)$/gm)) {
    for (const name of (match[1] ?? '').split(',').map((part) => part.trim())) {
      const path = `archetypes/${name}.py`
      if (name === '' || seen.has(path)) continue
      seen.add(path)
      archetypesOf(path, seen)
    }
  }
  return seen
}

/**
 * The build scripts a landmark's output depends on (relative to scripts/blender), sorted: the
 * runner, the PIN, the shared library, the landmark's module and the archetypes it uses (so a
 * new archetype for another landmark leaves this one's lock fresh).
 */
export function scriptFiles(id: string): string[] {
  const entry = landmarkModule(id)
  return ['build.py', 'PIN', entry, ...pythonFiles('cclib'), ...archetypesOf(entry)]
    .map((file) => file.split('\\').join('/'))
    .sort()
}

interface Entry {
  readonly id: string
}

/** The entry for `id`, or null when the file has none (no S07a model or frame yet). */
function entryOf<T extends Entry>(list: readonly T[], id: string): T | null {
  return list.find((item) => item.id === id) ?? null
}

/** Every input of a landmark's build, as one plain object. */
export function buildInputs(id: string): Record<string, unknown> {
  const models = readJson('data/landmarks/models.json') as { models: Entry[] }
  const frames = readJson('data/landmarks/frames.derived.json') as { landmarks: Entry[] }
  const scene = readJson('data/config/scene.json') as Record<string, unknown>
  const theme = readJson('data/config/theme.json') as {
    colors?: Record<string, string>
    world?: Record<string, string>
    models?: Record<string, string>
    scene: { landmarks: Record<string, string> }
  }
  // A scene role names a models or world token (DEC-26); same lookup order as cclib/inputs.py.
  const colours = { ...theme.colors, ...theme.world, ...theme.models }
  const perf = readJson('data/config/perf.json') as Record<string, unknown>
  const measurements = JSON.parse(readFileSync(join(MEASUREMENTS_DIR, `${id}.json`), 'utf8')) as {
    park?: string
    dimensions: Record<string, object>
  }
  const mapped =
    measurements.park !== undefined ||
    Object.values(measurements.dimensions).some((dimension) => 'lat' in dimension)
  const scripts = Object.fromEntries(
    scriptFiles(id).map((file) => [file, sha256(readFileSync(join(BLENDER_DIR, file)))]),
  )
  return {
    scripts,
    measurements: sha256(readFileSync(join(MEASUREMENTS_DIR, `${id}.json`))),
    model: entryOf(models.models, id),
    frame: entryOf(frames.landmarks, id),
    scene: { land: scene.land, camera: scene.camera, landmarks: scene.landmarks },
    palette: Object.fromEntries(
      Object.entries(theme.scene.landmarks).map(([role, token]) => [role, colours[token]]),
    ),
    perf: {
      landmarkTrianglesMax: perf.landmarkTrianglesMax,
      landmarkLodRatioMax: perf.landmarkLodRatioMax,
    },
    // Only map-placed models (a park area or lat/lng points) read the projection and the
    // landmark's location, and only park models the map's park area (archetypes/park.py).
    ...(mapped ? { map: mapInputs(id, measurements.park) } : {}),
  }
}

function mapInputs(id: string, parkId: string | undefined): Record<string, unknown> {
  const parks = readJson('data/geo/parks.derived.json') as { projection: unknown; parks: Entry[] }
  const places = readJson('data/landmarks/landmarks.json') as {
    landmarks: (Entry & { location: unknown })[]
  }
  return {
    projection: parks.projection,
    area: parkId === undefined ? null : entryOf(parks.parks, parkId),
    location: entryOf(places.landmarks, id)?.location ?? null,
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
