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
import ambientJson from '@data/config/ambient.json'
import type { AmbientConfig } from '@/lib/world/ambient/types'
import { VehicleKitConfigSchema, type VehicleKitConfig } from '@/lib/data/schemas/ambientKit'
import { PEDESTRIAN_BUCKETS, VEHICLE_BUCKETS } from '@/lib/world/ambient/types'
import { gltfLoader, prepareGltf, type SkinnedPartModel } from '../models/prepare'
import { partsBounds } from './buckets'
import {
  PEDESTRIANS,
  PEDESTRIAN_KIT_SOURCES,
  bakeTownsfolkKits,
  pedestrianModelIds,
  s16bPedestrians,
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

/** The `vehicleKit` block proposed for data/config/ambient.json (lane C merges it there). */
const VEHICLE_KIT: VehicleKitConfig = {
  light: { warmMinRed: 0.5, warmMaxBlueShare: 0.6, tailMinRed: 0.3, tailMaxGreenShare: 0.25 },
}
const vehicleKits = catalogVehicleKits(VEHICLE_KIT)

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
    expect(VehicleKitConfigSchema.parse(VEHICLE_KIT)).toEqual(VEHICLE_KIT)
    const classify = vehicleClassifier(1, VEHICLE_KIT)
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
    const kits = await vehicleKits('mid', AMBIENT_CARS, loader)
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

  it('bakes the Blender bus: generic, real size, paint, glass and lights', async () => {
    const entry = manifestEntry('bus-ambient')
    expect(entry.category).toBe('vehicle')
    expect(entry.loadPhase).toBe('after-playable')
    expect(entry.slots).toEqual(['body'])
    const [bus] = await vehicleKits('high', ['bus-ambient'], fileLoader('high'))
    if (bus === undefined) throw new Error('no bus')
    expect(bus.kind).toBe('bus')
    expect(bus.parts.map((part) => part.bucket)).toEqual([...VEHICLE_BUCKETS])
    expect(bus.triangles).toBe(entry.tiers.high.triangles)
    expect(bus.triangles).toBeLessThanOrEqual(400)
    expect(bus.lengthM).toBeGreaterThan(11)
    expect(bus.lengthM).toBeLessThan(13)
    expect(bus.widthM).toBeLessThan(2.7)
    expect(bus.heightM).toBeGreaterThan(2.8)
    bus.dispose()
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
    await expect(vehicleKits('low', ['taxi-ambient', 'sedan-ambient'], wrapped)).rejects.toThrow(
      /no "body" slot/,
    )
    // The taxi baked first: its three parts are freed.
    expect(dispose).toHaveBeenCalledTimes(VEHICLE_BUCKETS.length)
    dispose.mockRestore()
  })
})

describe('s16b pedestrian kits', () => {
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

  it('uses the merged npc models, never the default player look (UX-3)', () => {
    const player = scene.models.player
    for (const tier of ['low', 'mid', 'high'] as const) {
      for (const id of pedestrianModelIds(tier)) expect(() => modelRef(id)).not.toThrow()
      for (const variant of PEDESTRIANS[tier]) {
        expect(variant.model).not.toBe(player.body)
        expect(manifestEntry(variant.model).category).toBe('avatar-body')
        expect(manifestEntry(variant.rig).category).toBe('avatar-rig')
      }
    }
    expect(PEDESTRIANS.low.map((variant) => variant.model)).toEqual(['npc-man'])
    expect(PEDESTRIAN_KIT_SOURCES.s16b).toBe(s16bPedestrians)
  })

  it('bakes a rigid mid-stride figure in four buckets, feet on the ground, facing +z', async () => {
    const loader = fileLoader('low')
    const kits = await s16bPedestrians('low', loader)
    expect(kits).toHaveLength(PEDESTRIANS.low.length)
    const [kit] = kits
    const variant = PEDESTRIANS.low[0]
    if (kit === undefined || variant === undefined) throw new Error('no kit')
    expect(kit.parts.map((part) => part.bucket)).toEqual([...PEDESTRIAN_BUCKETS])
    expect(kit.triangles).toBe(manifestEntry(variant.model).tiers.low.triangles)
    const { min, max } = partsBounds(kit.parts)
    expect(min.y).toBeCloseTo(0, 5)
    expect(kit.heightM).toBeGreaterThan(1.5)
    expect(kit.heightM).toBeLessThan(2.1)
    // Arms come down from the bind-pose T: the figure is narrower than the source body.
    const body = manifestEntry(variant.model).bounds
    expect(max.x - min.x).toBeLessThan((body?.max[0] ?? 0) * 2)
    const normal = kit.parts[0]?.geometry.getAttribute('normal')
    expect(new Vector3(normal?.getX(0), normal?.getY(0), normal?.getZ(0)).length()).toBeCloseTo(
      1,
      4,
    )
    kit.dispose()
  })

  it('is deterministic and never moves the cached parts', async () => {
    const loader = fileLoader('high')
    const loaded = await loader(pedestrianModelIds('high'))
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
    const a = await s16bPedestrians('high', cached)
    const b = await s16bPedestrians('high', cached)
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
    const noRig: AmbientModelLoader = async (ids) =>
      (await loader(ids)).filter((entry) => entry.model.kind !== 'rig')
    await expect(s16bPedestrians('low', noRig)).rejects.toThrow(/is not a rig/)
  })
})

describe('townsfolk kits (S04q: real motion, no GPU skinning)', () => {
  const tf = (ambientJson as unknown as AmbientConfig).townsfolk

  it('bakes every body and pose of a tier as a loop of grounded frames', async () => {
    const kits = await bakeTownsfolkKits('mid', tf, fileLoader('high'))
    expect(kits.map((kit) => kit.pose)).toEqual([...tf.poses.mid, ...tf.poses.mid])
    for (const kit of kits) {
      const count = kit.pose === 'walk' ? tf.frames.walk.mid : tf.frames.stand.mid
      expect(kit.frames).toHaveLength(count)
      expect(kit.durationS).toBeGreaterThan(0)
      let lowest = Infinity
      for (const frame of kit.frames) {
        expect(frame.map((array) => array.length)).toEqual(
          kit.parts.map((part) => part.geometry.getAttribute('position').array.length),
        )
        for (const array of frame) {
          for (let i = 1; i < array.length; i += 3) lowest = Math.min(lowest, array[i] ?? 0)
        }
      }
      // One shared ground: the loop's lowest point on y = 0, so nobody hops.
      expect(lowest).toBeCloseTo(0, 4)
      // It moves: the frames are not all the same.
      const first = kit.frames[0]?.[0]
      const later = kit.frames[Math.floor(kit.frames.length / 2)]?.[0]
      expect(Array.from(later ?? [])).not.toEqual(Array.from(first ?? []))
      if (kit.pose === 'walk') {
        // A real stride: a loop covers about one to two body heights.
        expect(kit.cycleHeights).toBeGreaterThan(0.4)
        expect(kit.cycleHeights).toBeLessThan(2.5)
        // In place: the body's centre stays over its spot through the loop.
        const centreZ = (frame: readonly Float32Array[]) => {
          let sum = 0
          let n = 0
          for (const array of frame) {
            for (let i = 2; i < array.length; i += 3) {
              sum += array[i] ?? 0
              n++
            }
          }
          return sum / Math.max(1, n)
        }
        const zs = kit.frames.map(centreZ)
        expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(kit.heightM * 0.15)
      } else {
        expect(kit.cycleHeights).toBe(0)
      }
    }
    for (const kit of kits) kit.dispose()
  }, 60_000)
})
