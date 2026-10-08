/**
 * The Blender landmark pipeline (S07c) without Blender: which landmarks are built, whether
 * their locks are fresh, the structure of every shipped GLB, and a static lint of the Python
 * build scripts (no clock, no network, no unseeded randomness, only the standard library plus
 * bpy and bmesh). The in-Blender checks (double build identical, wrong PIN exits 3) are
 * `npm run landmarks:blender -- --selftest`.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { Box3, type BufferAttribute } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { describe, expect, it } from 'vitest'
import framesJson from '../../data/landmarks/frames.derived.json'
import modelsJson from '../../data/landmarks/models.json'
import placesJson from '../../data/landmarks/landmarks.json'
import perfJson from '../../data/config/perf.json'
import sceneJson from '../../data/config/scene.json'
import { LandmarkMeasurementsSchema } from '../../src/lib/data/schemas/landmarkBlender.ts'
import {
  ARCHETYPE_CATEGORY,
  CAP_CATEGORIES,
  type Archetype,
} from '../../src/lib/data/schemas/landmarkModels.ts'
import { BLENDER_DIR, MEASUREMENTS_DIR, ROOT, measuredIds } from './inputs.ts'
import { prepareGltf } from '../../src/scene/models/prepare.ts'
import { checkLandmark, readLock, sourcesProblems } from './run.ts'

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)

/** Landmarks still waiting for their Blender model (S07c): every other landmark is built. */
const PENDING = new Set([
  'flushing-meadows',
  'astoria-park',
  'queens-ballpark',
  'brooklyn-arena',
  'midtown-terminal',
  'penn-station',
  'jamaica-station',
  'dumbo',
  'coney-island-boardwalk',
  'flushing-main-street',
  'september-11-memorial',
  'bronx-ballpark',
  'staten-island-ferry',
])

const TIER_FINEST = { high: 0, mid: 1, low: 2 } as const
const landTop = sceneJson.land.heightM - sceneJson.land.baseM
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

const placeIds = placesJson.landmarks.map((place) => place.id)
const built = measuredIds()

describe('Blender landmark coverage', () => {
  it('builds every landmark or lists it as pending', () => {
    for (const id of placeIds) {
      expect(built.includes(id) || PENDING.has(id), `${id} is neither built nor pending`).toBe(true)
    }
  })

  it('keeps the pending list honest: nothing built is pending, nothing unknown is listed', () => {
    for (const id of PENDING) {
      expect(placeIds).toContain(id)
      expect(built).not.toContain(id)
    }
    for (const id of built) expect(placeIds).toContain(id)
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
  // The perf.json cap category: the S07a model's, or for a landmark without one the place's
  // own when perf.json has caps for it, else building (the memorial).
  const place = placesJson.landmarks.find((entry) => entry.id === id)
  const placeCategory = CAP_CATEGORIES.find((c) => c === place?.category) ?? 'building'
  const category =
    model === undefined ? placeCategory : ARCHETYPE_CATEGORY[model.archetype as Archetype]

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

  it('ships one mesh named <id>-lod<n> with the placeholder material (shared model program)', () => {
    gltfs.forEach((gltf, level) => {
      const meshNodes = (gltf.nodes ?? []).filter((node) => node.mesh !== undefined)
      expect(meshNodes.map((node) => node.name)).toEqual([`${id}-lod${level}`])
      expect(gltf.meshes?.length).toBe(1)
      expect(gltf.meshes?.[0]?.primitives.length).toBe(1)
      expect((gltf.materials ?? []).map((material) => material.name)).toEqual(['model'])
      const attributes = Object.keys(gltf.meshes?.[0]?.primitives[0]?.attributes ?? {}).sort()
      for (const name of attributes) {
        expect(['COLOR_0', 'NORMAL', 'POSITION', '_EMISSIVE']).toContain(name)
      }
    })
  })

  it.each(lock.levels.map((level) => [level.level, level.file] as const))(
    'L%i decodes with three r182 + its bundled MeshoptDecoder into one static model at real size',
    async (level, file) => {
      const bytes = readFileSync(join(ROOT, file))
      const parsed = await loader.parseAsync(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        '',
      )
      const model = prepareGltf(parsed, { id: `${id}-lod${level}`, kind: 'static' })
      if (model.kind !== 'static') throw new Error('not static')
      expect(model.triangles).toBe(lock.levels[level]?.triangles)
      const box = new Box3().setFromBufferAttribute(
        model.geometry.getAttribute('position') as BufferAttribute,
      )
      box.applyMatrix4(model.matrix)
      const height = expectedHeight()
      const base = (frame?.base ?? measurements.base ?? 'land') === 'land' ? landTop : 0
      expect(Math.abs(box.max.y - base - height)).toBeLessThanOrEqual(BBOX_TOLERANCE * height)
      expect(box.min.y).toBeGreaterThanOrEqual(-0.05)
      if (frame?.spanM !== undefined) {
        const length = box.max.z - box.min.z
        expect(Math.abs(length - frame.spanM)).toBeLessThanOrEqual(BBOX_TOLERANCE * frame.spanM)
      }
      // The lamps glow through the S04f night-glow contract on the levels that draw them.
      if (level < 3) expect(model.geometry.getAttribute('_emissive')).toBeDefined()
    },
  )

  /** The tower top above the water, at the measurements' game scale. */
  function expectedHeight(): number {
    const height = measurements.dimensions.towerHeightM ?? measurements.dimensions.heightM
    if (height === undefined || !('valueM' in height)) throw new Error('no towerHeightM or heightM')
    return height.valueM * (measurements.gameScale?.height ?? 1)
  }
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
