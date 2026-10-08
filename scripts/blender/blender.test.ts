/**
 * The Blender landmark pipeline (S07c) without Blender: which landmarks are built, whether
 * their locks are fresh, the structure of every shipped GLB, and a static lint of the Python
 * build scripts (no clock, no network, no unseeded randomness, only the standard library plus
 * bpy and bmesh). The in-Blender checks (double build identical, wrong PIN exits 3) are
 * `npm run landmarks:blender -- --selftest`.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import framesJson from '../../data/landmarks/frames.derived.json'
import modelsJson from '../../data/landmarks/models.json'
import perfJson from '../../data/config/perf.json'
import { LandmarkMeasurementsSchema } from '../../src/lib/data/schemas/landmarkBlender.ts'
import { BLENDER_DIR, MEASUREMENTS_DIR, ROOT, measuredIds } from './inputs.ts'
import { checkLandmark, readLock, sourcesProblems } from './run.ts'

/** Landmarks still on the code-built kit, waiting for their Blender model (S07c chunks A-C). */
const PENDING = new Set([
  'manhattan-bridge',
  'queensboro-bridge',
  'wedge-building',
  'deco-spire',
  'city-hall',
  'brooklyn-borough-hall',
  'queens-borough-hall',
  'midtown-terminal',
  'penn-station',
  'jamaica-station',
  'staten-island-ferry',
])

const TIER_FINEST = { high: 0, mid: 1, low: 2 } as const
const ALLOWED_EXTENSIONS = new Set(['EXT_meshopt_compression', 'KHR_mesh_quantization'])
const BBOX_TOLERANCE = 0.02

interface Accessor {
  count: number
  min?: number[]
  max?: number[]
}
interface Gltf {
  extensionsUsed?: string[]
  extensionsRequired?: string[]
  materials?: { name?: string }[]
  nodes?: {
    name?: string
    mesh?: number
    translation?: number[]
    scale?: number[]
    rotation?: number[]
  }[]
  meshes?: {
    primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[]
  }[]
  accessors: Accessor[]
  [key: string]: unknown
}

/** The JSON chunk of a GLB (glTF 2.0 binary: 12-byte header, then the JSON chunk). */
export function readGlbJson(buffer: Buffer): Gltf {
  expect(buffer.readUInt32LE(0)).toBe(0x46546c67) // "glTF"
  expect(buffer.readUInt32LE(4)).toBe(2)
  const length = buffer.readUInt32LE(12)
  expect(buffer.readUInt32LE(16)).toBe(0x4e4f534a) // "JSON"
  return JSON.parse(buffer.subarray(20, 20 + length).toString('utf8')) as Gltf
}

function triangles(gltf: Gltf): number {
  let total = 0
  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      expect(primitive.mode ?? 4).toBe(4)
      const accessor =
        primitive.indices === undefined
          ? gltf.accessors[primitive.attributes.POSITION ?? -1]
          : gltf.accessors[primitive.indices]
      total += Math.floor((accessor?.count ?? 0) / 3)
    }
  }
  return total
}

/** Bounds of every mesh node, under its scale and translation (rotation is not allowed). */
function bbox(gltf: Gltf): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const node of gltf.nodes ?? []) {
    if (node.mesh === undefined) continue
    expect(node.rotation ?? [0, 0, 0, 1]).toEqual([0, 0, 0, 1])
    const t = node.translation ?? [0, 0, 0]
    const s = node.scale ?? [1, 1, 1]
    for (const primitive of gltf.meshes?.[node.mesh]?.primitives ?? []) {
      const accessor = gltf.accessors[primitive.attributes.POSITION ?? -1]
      for (let axis = 0; axis < 3; axis++) {
        for (const v of [accessor?.min?.[axis], accessor?.max?.[axis]]) {
          if (v === undefined) throw new Error('POSITION accessor without min/max')
          const w = v * (s[axis] ?? 1) + (t[axis] ?? 0)
          min[axis] = Math.min(min[axis] ?? w, w)
          max[axis] = Math.max(max[axis] ?? w, w)
        }
      }
    }
  }
  return { min, max }
}

const modelIds = modelsJson.models.map((model) => model.id)
const built = measuredIds()

describe('Blender landmark coverage', () => {
  it('builds every modelled landmark or lists it as pending', () => {
    for (const id of modelIds) {
      expect(built.includes(id) || PENDING.has(id), `${id} is neither built nor pending`).toBe(true)
    }
  })

  it('keeps the pending list honest: nothing built is pending, nothing unknown is listed', () => {
    for (const id of PENDING) {
      expect(modelIds).toContain(id)
      expect(built).not.toContain(id)
    }
    for (const id of built) expect(modelIds).toContain(id)
  })

  it('has a measurements file, a lock and a build script for each built landmark', () => {
    for (const id of built) {
      LandmarkMeasurementsSchema.parse(
        JSON.parse(readFileSync(join(MEASUREMENTS_DIR, `${id}.json`), 'utf8')),
      )
      expect(readLock(id), `${id} lock`).toBeDefined()
      expect(() =>
        readFileSync(join(BLENDER_DIR, 'landmarks', `${id.replaceAll('-', '_')}.py`)),
      ).not.toThrow()
    }
  })
})

describe('Blender landmark locks', () => {
  it.each(built)('%s: the lock matches its inputs and the shipped files', (id) => {
    expect(checkLandmark(id)).toEqual([])
  })

  it('data/landmarks/SOURCES.md has the current measurements section', () => {
    expect(sourcesProblems()).toEqual([])
  })
})

describe.each(built)('%s shipped GLBs', (id) => {
  const lock = readLock(id)
  if (lock === undefined) throw new Error(`${id}: no lock`)
  const gltfs = lock.levels.map((level) => readGlbJson(readFileSync(join(ROOT, level.file))))
  const counts = gltfs.map(triangles)
  const frame = framesJson.landmarks.find((entry) => entry.id === id)
  const measurements = LandmarkMeasurementsSchema.parse(
    JSON.parse(readFileSync(join(MEASUREMENTS_DIR, `${id}.json`), 'utf8')),
  )
  const model = modelsJson.models.find((entry) => entry.id === id)
  const category = model?.archetype.endsWith('Bridge') ? 'bridge' : 'building'

  it('matches the lock triangle counts', () => {
    expect(counts).toEqual(lock.levels.map((level) => level.triangles))
  })

  it("keeps each tier's finest level within the perf.json caps", () => {
    const overrides: Record<string, typeof perfJson.landmarkTrianglesMax.bridge> =
      perfJson.landmarkTrianglesOverride
    const caps = overrides[id] ?? perfJson.landmarkTrianglesMax[category]
    for (const [tier, level] of Object.entries(TIER_FINEST)) {
      expect(counts[level], `${tier} tier L${level}`).toBeLessThanOrEqual(
        caps[tier as keyof typeof caps],
      )
    }
  })

  it('halves (at least) at every step', () => {
    for (let level = 1; level < counts.length; level++) {
      expect(counts[level]).toBeLessThanOrEqual(
        perfJson.landmarkLodRatioMax * (counts[level - 1] ?? 0),
      )
    }
  })

  it('holds only meshes: allowed extensions, no images, animations, cameras or lights', () => {
    for (const gltf of gltfs) {
      for (const key of ['images', 'textures', 'samplers', 'animations', 'cameras', 'skins']) {
        expect(gltf[key], key).toBeUndefined()
      }
      for (const extension of [
        ...(gltf.extensionsUsed ?? []),
        ...(gltf.extensionsRequired ?? []),
      ]) {
        expect(ALLOWED_EXTENSIONS.has(extension), extension).toBe(true)
      }
      expect(JSON.stringify(gltf)).not.toContain('KHR_lights_punctual')
    }
  })

  it('names its nodes <id>-lod<n>-body|windows and uses only cc-body and cc-windows', () => {
    gltfs.forEach((gltf, level) => {
      for (const node of gltf.nodes ?? []) {
        expect(node.name).toMatch(new RegExp(`^${id}-lod${level}-(body|windows)$`))
      }
      const names = (gltf.materials ?? []).map((material) => material.name)
      expect(names).toContain('cc-body')
      for (const name of names) expect(['cc-body', 'cc-windows']).toContain(name)
    })
  })

  it('measures its real height and its frame length (within 2 %) and stands on y = 0', () => {
    const height = measurements.dimensions.towerHeightM
    if (height === undefined || !('valueM' in height)) throw new Error('no towerHeightM')
    for (const gltf of gltfs) {
      const { min, max } = bbox(gltf)
      expect(Math.abs((max[1] ?? 0) - height.valueM)).toBeLessThanOrEqual(
        BBOX_TOLERANCE * height.valueM,
      )
      expect(min[1]).toBeGreaterThanOrEqual(-0.01)
      if (frame?.spanM !== undefined) {
        const length = (max[2] ?? 0) - (min[2] ?? 0)
        expect(Math.abs(length - frame.spanM)).toBeLessThanOrEqual(BBOX_TOLERANCE * frame.spanM)
      }
    }
  })
})

const S04H_FILES = new Set(['run.py', 'fixtures/smoke-crate.py'])

describe('Blender Python lint', () => {
  const files = readdirSync(BLENDER_DIR, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.py'))
    .map((entry) => join(entry.parentPath, entry.name))
    // S04h's runner and its smoke fixture belong to `npm run blender:build` (scripts/blender/build.ts).
    .filter((file) => !S04H_FILES.has(relative(BLENDER_DIR, file).split('\\').join('/')))
  const ALLOWED = new Set([
    'argparse',
    'hashlib',
    'importlib',
    'json',
    'math',
    'os',
    'random',
    'struct',
    'sys',
    'bpy',
    'bmesh',
    'cclib',
    'archetypes',
    'landmarks',
    'build',
  ])

  it('finds the build scripts', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it.each(files.map((file) => [relative(BLENDER_DIR, file), file]))(
    '%s imports only the standard library allowlist, bpy and bmesh',
    (_name, file) => {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)) {
        const imported = (match[1] ?? match[2] ?? '').split('.')[0] ?? ''
        if (imported === '') continue // `from . import x`: the package itself
        expect(ALLOWED.has(imported), `import ${imported}`).toBe(true)
      }
    },
  )

  it.each(files.map((file) => [relative(BLENDER_DIR, file), file]))(
    '%s reads no clock, no network and no unseeded randomness',
    (_name, file) => {
      const source = readFileSync(file, 'utf8')
      expect(source).not.toMatch(/\b(?:time|datetime|urllib|socket|subprocess|uuid|secrets)\./)
      expect(source).not.toMatch(/\brandom\.(?!Random\b)\w+\(/)
      expect(source).not.toMatch(/\bos\.(?:environ|getenv|urandom)\b/)
    },
  )
})
