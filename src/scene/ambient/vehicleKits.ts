/**
 * Ambient vehicle kits (S04l part B): the catalog's far-away vehicles (`*-ambient`, about 250
 * triangles per KayKit car LOD, about 280 for our Blender bus; data/assets/catalog.json) split
 * into the `paint`, `glass` and `light` colour buckets, so each bucket draws as one
 * InstancedMesh on the blocks' instanced material.
 *
 * - `paint`: the body (`_SLOT` "body"); recoloured per instance, a taxi keeps its own paint.
 * - `light`: warm head lamps and red tail lamps (bright warm or strongly red, outside the body).
 * - `glass`: everything else (windows, tyres, trim, bumpers), drawn in its own dark colour, plus
 *   four small lamp boxes (S04p, ambient.json `vehicleKit.lamps`): two head lamps on the nose and
 *   two tail lamps on the tail. Only those carry a non-zero night-glow `_emissive` attribute, so
 *   they glow warm and red after dark; layer.ts draws the part on the map pins' attribute-glow
 *   program, so the lamps add no shader program and no draw call, on every tier.
 *
 * A kit copies what it needs into its own geometry, so the models it was baked from may be
 * released as soon as the source resolves.
 */
import { BoxGeometry, BufferAttribute, BufferGeometry, Color } from 'three'
import {
  VEHICLE_BUCKETS,
  type VehicleBucket,
  type VehicleKind,
  type VehicleKit,
  type VehicleKitSource,
} from '@/lib/world/ambient/types'
import type { VehicleKitConfig } from '@/lib/data/schemas/ambientKit'
import type { LoadedModel } from '../models/prepare'
import { NIGHT_GLOW_ATTRIBUTE } from '../lighting/nightGlow'
import type { ModelRef } from '../models/types'
import { groundParts, partsBounds, splitIntoBuckets, type BucketTriangle } from './buckets'

/** A model the kit sources asked for, with what they need of its manifest entry. */
export interface AmbientLoadedModel {
  readonly ref: Pick<ModelRef, 'id' | 'slots'>
  readonly model: LoadedModel
}

/**
 * Loads models by catalog id at the caller's tier, resolving in the order asked. The runtime
 * builds it on the models runtime (acquireModels: CacheFirst `cc-models`, never precached) and
 * releases the references once the kit source resolves.
 */
export type AmbientModelLoader = (ids: readonly string[]) => Promise<readonly AmbientLoadedModel[]>

export type SceneVehicleKit = VehicleKit<BufferGeometry>
export type SceneVehicleKitSource = VehicleKitSource<BufferGeometry, AmbientModelLoader>

/**
 * The bucket classifier for a car whose body is `_SLOT` value `paintSlot` (0 = none), with the
 * lamp thresholds of ambient.json `vehicleKit.light` (linear RGB).
 */
export function vehicleClassifier(
  paintSlot: number,
  { light }: VehicleKitConfig,
): (t: BucketTriangle) => VehicleBucket {
  return ({ r, g, b, slot }) => {
    if (paintSlot > 0 && slot === paintSlot) return 'paint'
    const warmLamp = r >= light.warmMinRed && b <= r * light.warmMaxBlueShare
    const tailLamp = r >= light.tailMinRed && g <= r * light.tailMaxGreenShare
    return warmLamp || tailLamp ? 'light' : 'glass'
  }
}

/** taxi-ambient → taxi, bus-ambient → bus, anything else → car. */
export function vehicleKind(id: string): VehicleKind {
  if (id.startsWith('taxi')) return 'taxi'
  if (id.startsWith('bus')) return 'bus'
  return 'car'
}

/**
 * `glass` (non-indexed position + normal, grounded, nose towards +z) with the four lamp boxes
 * appended and the `_emissive` attribute: zero on the glass, the lamp colour times `nightGlow`
 * on the lamps. Returns the new geometry; the caller disposes the old one.
 */
export function withNightLamps(
  glass: BufferGeometry,
  bounds: {
    readonly min: { x: number; y: number; z: number }
    readonly max: { x: number; y: number; z: number }
  },
  lamps: VehicleKitConfig['lamps'],
): BufferGeometry {
  const width = bounds.max.x - bounds.min.x
  const height = bounds.max.y - bounds.min.y
  const box = new BoxGeometry(width * lamps.widthShare, height * lamps.heightShare, lamps.depthM)
  const unit = box.toNonIndexed()
  box.dispose()
  const lampPositions = unit.getAttribute('position')
  const lampNormals = unit.getAttribute('normal')
  const glassPositions = glass.getAttribute('position')
  const glassNormals = glass.getAttribute('normal')
  const perLamp = lampPositions.count
  const total = glassPositions.count + perLamp * 4
  const position = new Float32Array(total * 3)
  const normal = new Float32Array(total * 3)
  const emissive = new Float32Array(total * 3)
  position.set(glassPositions.array as Float32Array)
  normal.set(glassNormals.array as Float32Array)
  const y = bounds.min.y + height * lamps.yShare
  const half = lamps.depthM / 2 - lamps.insetM
  const glow = (hex: string) => new Color(hex).multiplyScalar(lamps.nightGlow)
  const ends = [
    { z: bounds.max.z + half, color: glow(lamps.head) },
    { z: bounds.min.z - half, color: glow(lamps.tail) },
  ]
  let at = glassPositions.count
  for (const end of ends) {
    for (const side of [-1, 1]) {
      const x = side * width * lamps.xShare
      for (let i = 0; i < perLamp; i++, at++) {
        position.set(
          [lampPositions.getX(i) + x, lampPositions.getY(i) + y, lampPositions.getZ(i) + end.z],
          at * 3,
        )
        normal.set([lampNormals.getX(i), lampNormals.getY(i), lampNormals.getZ(i)], at * 3)
        end.color.toArray(emissive, at * 3)
      }
    }
  }
  unit.dispose()
  const out = new BufferGeometry()
  out.setAttribute('position', new BufferAttribute(position, 3))
  out.setAttribute('normal', new BufferAttribute(normal, 3))
  out.setAttribute(NIGHT_GLOW_ATTRIBUTE, new BufferAttribute(emissive, 3))
  out.computeBoundingBox()
  out.computeBoundingSphere()
  return out
}

/** Bakes one ambient vehicle kit from a loaded static model. */
export function vehicleKitFromModel(
  loaded: AmbientLoadedModel,
  config: VehicleKitConfig,
): SceneVehicleKit {
  const { ref, model } = loaded
  if (model.kind !== 'static') throw new Error(`Ambient vehicle "${ref.id}" is not a static model`)
  const paintSlot = ref.slots.indexOf('body') + 1
  if (paintSlot === 0) throw new Error(`Ambient vehicle "${ref.id}" has no "body" slot`)
  const split = splitIntoBuckets(model.geometry, vehicleClassifier(paintSlot, config), {
    order: VEHICLE_BUCKETS,
    matrix: model.matrix,
  })
  if (!split.some((part) => part.bucket === 'paint')) {
    throw new Error(`Ambient vehicle "${ref.id}" has no body triangles`)
  }
  groundParts(split)
  const { min, max } = partsBounds(split)
  const parts = split.map((part) => {
    if (part.bucket !== 'glass') return part
    const geometry = withNightLamps(part.geometry, { min, max }, config.lamps)
    part.geometry.dispose()
    return { ...part, geometry, triangles: geometry.getAttribute('position').count / 3 }
  })
  return {
    id: ref.id,
    kind: vehicleKind(ref.id),
    parts: parts.map(({ bucket, geometry, color }) => ({ bucket, geometry, color })),
    lengthM: max.z - min.z,
    widthM: max.x - min.x,
    heightM: max.y - min.y,
    triangles: parts.reduce((sum, part) => sum + part.triangles, 0),
    dispose() {
      for (const part of parts) part.geometry.dispose()
    },
  }
}

/**
 * The vehicle kit source for ambient.json's `vehicleKit` settings: the tier's `vehicles.models`
 * ids, loaded and baked in order. A kit that fails to bake disposes the ones already baked and
 * rejects (the runtime keeps traffic off rather than drawing a partial set).
 */
export function catalogVehicleKits(config: VehicleKitConfig): SceneVehicleKitSource {
  return async (_tier, ids, loadModels) => {
    const loaded = await loadModels(ids)
    const kits: SceneVehicleKit[] = []
    try {
      for (const entry of loaded) kits.push(vehicleKitFromModel(entry, config))
    } catch (error) {
      for (const kit of kits) kit.dispose()
      throw error
    }
    return kits
  }
}
