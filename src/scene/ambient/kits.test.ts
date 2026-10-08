/**
 * Ambient vehicle and pedestrian kits (S04l part B) baked from the committed GLBs (three r182
 * GLTFLoader + MeshoptDecoder in Node, as in src/scene/models/models.test.ts).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BufferGeometry, SkinnedMesh, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { modelManifest, modelRef } from '@/lib/data/models'
import { scene } from '@/lib/data/config'
import { PEDESTRIAN_BUCKETS, VEHICLE_BUCKETS } from '@/lib/world/ambient/types'
import { gltfLoader, prepareGltf, type SkinnedPartModel } from '../models/prepare'
import { partsBounds } from './buckets'
import {
  KENNEY_TEMP_PEDESTRIANS,
  PEDESTRIAN_KIT_SOURCES,
  kenneyTempModelIds,
  kenneyTempPedestrians,
  pedestrianBucket,
} from './pedestrianKits'
import {
  catalogVehicleKits,
  vehicleClassifier,
  vehicleKind,
  type AmbientLoadedModel,
  type AmbientModelLoader,
} from './vehicleKits'

const ROOT = join(import.meta.dirname, '../../..')
const AMBIENT_CARS = ['taxi-ambient', 'sedan-ambient', 'hatchback-ambient'] as const

/** The loader the runtime builds on acquireModels, here straight from public/models. */
function fileLoader(tier: 'low' | 'mid' | 'high'): AmbientModelLoader & { calls: string[][] } {
  const calls: string[][] = []
  const load = async (ids: readonly string[]): Promise<AmbientLoadedModel[]> => {
    calls.push([...ids])
    return Promise.all(
      ids.map(async (id) => {
        const ref = modelRef(id)
        const bytes = readFileSync(join(ROOT, 'public', ref.files[tier]))
        const gltf = await gltfLoader().parseAsync(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          '',
        )
        return { ref, model: prepareGltf(gltf, ref) }
      }),
    )
  }
  return Object.assign(load, { calls })
}

const manifestEntry = (id: string) => {
  const entry = modelManifest.models.find((model) => model.id === id)
  if (entry === undefined) throw new Error(`${id} missing`)
  return entry
}

describe('ambient vehicle LODs in the catalog', () => {
  it.each(AMBIENT_CARS)('%s is a far-away LOD of its car, never on the playable path', (id) => {
    const entry = manifestEntry(id)
    const full = manifestEntry(id.replace('-ambient', ''))
    expect(entry.category).toBe('vehicle')
    expect(entry.loadPhase).toBe('after-playable')
    expect(entry.instanced).toBe(true)
    expect(entry.emissive).toBe(false)
    expect(entry.slots).toEqual(['body'])
    for (const tier of ['low', 'mid', 'high'] as const) {
      expect(entry.tiers[tier].triangles, tier).toBeLessThanOrEqual(300)
      expect(entry.tiers[tier].triangles).toBeLessThan(full.tiers.low.triangles / 3)
    }
    // Same real-world size as the full model.
    expect(entry.bounds?.max[2]).toBeCloseTo(full.bounds?.max[2] ?? NaN, 1)
  })
})

describe('vehicle kits', () => {
  it('classifies body, warm and red lamps, and everything else', () => {
    const classify = vehicleClassifier(1)
    expect(classify({ r: 0.1, g: 0.1, b: 0.1, slot: 1 })).toBe('paint')
    expect(classify({ r: 1, g: 0.54, b: 0.13, slot: 0 })).toBe('light')
    expect(classify({ r: 0.6, g: 0.04, b: 0.03, slot: 0 })).toBe('light')
    expect(classify({ r: 0.88, g: 0.87, b: 0.82, slot: 0 })).toBe('glass')
    expect(classify({ r: 0.02, g: 0.02, b: 0.02, slot: 0 })).toBe('glass')
  })

  it('names kinds from catalog ids', () => {
    expect(['taxi-ambient', 'sedan-ambient', 'bus-ambient'].map(vehicleKind)).toEqual([
      'taxi',
      'car',
      'bus',
    ])
  })

  it('bakes every ambient car into paint, glass and light parts, real size, on the ground', async () => {
    const loader = fileLoader('mid')
    const kits = await catalogVehicleKits('mid', AMBIENT_CARS, loader)
    expect(loader.calls).toEqual([[...AMBIENT_CARS]])
    expect(kits.map((kit) => kit.id)).toEqual([...AMBIENT_CARS])
    for (const kit of kits) {
      const entry = manifestEntry(kit.id)
      // Buckets in VEHICLE_BUCKETS order; a LOD may have simplified its lamps away.
      const buckets = kit.parts.map((part) => part.bucket)
      expect(VEHICLE_BUCKETS.filter((bucket) => buckets.includes(bucket))).toEqual(buckets)
      expect(buckets.slice(0, 2)).toEqual(['paint', 'glass'])
      // Every triangle lands in exactly one bucket.
      expect(kit.triangles).toBe(entry.tiers.mid.triangles)
      for (const part of kit.parts) {
        expect(Object.keys(part.geometry.attributes).sort(), kit.id).toEqual(['normal', 'position'])
        expect(part.color).toMatch(/^#[0-9a-f]{6}$/)
      }
      const { min, max } = partsBounds(kit.parts)
      expect(min.y).toBeCloseTo(0, 5)
      expect(min.x + max.x).toBeCloseTo(0, 5)
      expect(kit.lengthM).toBeGreaterThan(kit.widthM)
      expect(kit.lengthM).toBeCloseTo((entry.bounds?.max[2] ?? 0) * 2, 1)
      kit.dispose()
    }
    for (const id of ['taxi-ambient', 'sedan-ambient']) {
      const kit = kits.find((entry) => entry.id === id)
      expect(
        kit?.parts.some((part) => part.bucket === 'light'),
        id,
      ).toBe(true)
    }
    const taxi = kits.find((kit) => kit.kind === 'taxi')
    const paint = taxi?.parts.find((part) => part.bucket === 'paint')?.color ?? '#000000'
    // The taxi keeps its own yellow: red and green high, blue low.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(paint.slice(i, i + 2), 16))
    expect(r).toBeGreaterThan(180)
    expect(g).toBeGreaterThan(120)
    expect(b).toBeLessThan(80)
  })

  it('rejects a model without a body slot and disposes kits already baked', async () => {
    const loader = fileLoader('low')
    const dispose = vi.spyOn(BufferGeometry.prototype, 'dispose')
    const wrapped: AmbientModelLoader = async (ids) => {
      const loaded = await loader(ids)
      return loaded.map((entry, i) =>
        i === 1 ? { ...entry, ref: { ...entry.ref, slots: [] } } : entry,
      )
    }
    await expect(
      catalogVehicleKits('low', ['taxi-ambient', 'sedan-ambient'], wrapped),
    ).rejects.toThrow(/no "body" slot/)
    // The taxi baked first: its three parts are freed.
    expect(dispose).toHaveBeenCalledTimes(VEHICLE_BUCKETS.length)
    dispose.mockRestore()
  })
})

describe('kenney-temp pedestrian kits', () => {
  it('buckets slot names into skin, top, bottom and accent', () => {
    expect(['skin', 'top', 'bottom', 'shoes', 'hair', undefined].map(pedestrianBucket)).toEqual([
      'skin',
      'top',
      'bottom',
      'accent',
      'accent',
      'accent',
    ])
  })

  it('uses manifest parts that are not the default player look (UX-3)', () => {
    const player = scene.models.player
    for (const tier of ['low', 'mid', 'high'] as const) {
      for (const id of kenneyTempModelIds(tier)) expect(() => modelRef(id)).not.toThrow()
      for (const parts of KENNEY_TEMP_PEDESTRIANS[tier]) {
        expect(parts.body).not.toBe(player.body)
        expect(parts.head).not.toBe(player.head)
        expect(manifestEntry(parts.body).category).toBe('avatar-body')
        expect(manifestEntry(parts.head).category).toBe('avatar-head')
      }
    }
    expect(PEDESTRIAN_KIT_SOURCES['kenney-temp']).toBe(kenneyTempPedestrians)
  })

  it('bakes a rigid mid-stride figure in four buckets, feet on the ground, facing +z', async () => {
    const loader = fileLoader('low')
    const kits = await kenneyTempPedestrians('low', loader)
    expect(kits).toHaveLength(KENNEY_TEMP_PEDESTRIANS.low.length)
    const [kit] = kits
    const parts = KENNEY_TEMP_PEDESTRIANS.low[0]
    if (kit === undefined || parts === undefined) throw new Error('no kit')
    expect(kit.parts.map((part) => part.bucket)).toEqual([...PEDESTRIAN_BUCKETS])
    expect(kit.triangles).toBe(
      manifestEntry(parts.body).tiers.low.triangles + manifestEntry(parts.head).tiers.low.triangles,
    )
    const { min, max } = partsBounds(kit.parts)
    expect(min.y).toBeCloseTo(0, 5)
    expect(kit.heightM).toBeGreaterThan(1)
    expect(kit.heightM).toBeLessThan(2.2)
    // Arms come down from the bind-pose T: the figure is narrower than the source body.
    const body = manifestEntry(parts.body).bounds
    expect(max.x - min.x).toBeLessThan((body?.max[0] ?? 0) * 2)
    // Normals were recomputed: unit length.
    const normal = kit.parts[0]?.geometry.getAttribute('normal')
    expect(new Vector3(normal?.getX(0), normal?.getY(0), normal?.getZ(0)).length()).toBeCloseTo(
      1,
      4,
    )
    kit.dispose()
  })

  it('is deterministic and never moves the cached parts', async () => {
    const loader = fileLoader('high')
    const loaded = await loader(kenneyTempModelIds('high'))
    const restOf = (model: SkinnedPartModel) => {
      const out: number[] = []
      model.scene.traverse((object) => {
        if (object instanceof SkinnedMesh) {
          for (const bone of object.skeleton.bones) out.push(...bone.quaternion.toArray())
        }
      })
      return out
    }
    const skinned = loaded.flatMap((entry) => (entry.model.kind === 'skinned' ? [entry.model] : []))
    const before = skinned.map(restOf)
    const cached: AmbientModelLoader = () => Promise.resolve(loaded)
    const a = await kenneyTempPedestrians('high', cached)
    const b = await kenneyTempPedestrians('high', cached)
    expect(a).toHaveLength(2)
    expect(a.map((kit) => kit.id)).toEqual(b.map((kit) => kit.id))
    for (const [i, kit] of a.entries()) {
      expect(
        kit.parts.map((part) => Array.from(part.geometry.getAttribute('position').array)),
      ).toEqual(b[i]?.parts.map((part) => Array.from(part.geometry.getAttribute('position').array)))
    }
    expect(skinned.map(restOf)).toEqual(before)
    for (const kit of [...a, ...b]) kit.dispose()
  })

  it('rejects when the rig is missing', async () => {
    const loader = fileLoader('low')
    const noRig: AmbientModelLoader = async (ids) => {
      const loaded = await loader(ids)
      return loaded.slice(1)
    }
    await expect(kenneyTempPedestrians('low', noRig)).rejects.toThrow(/is not a rig/)
  })
})
