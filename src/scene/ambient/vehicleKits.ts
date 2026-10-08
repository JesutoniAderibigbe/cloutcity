/**
 * Ambient vehicle kits (S04l part B): the catalog's far-away vehicles (`*-ambient`, about 250
 * triangles per KayKit car LOD, about 280 for our Blender bus; data/assets/catalog.json) split
 * into the `paint`, `glass` and `light` colour buckets, so each bucket draws as one
 * InstancedMesh on the blocks' instanced material.
 *
 * - `paint`: the body (`_SLOT` "body"); recoloured per instance, a taxi keeps its own paint.
 * - `light`: warm head lamps and red tail lamps (bright warm or strongly red, outside the body).
 * - `glass`: everything else (windows, tyres, trim, bumpers), drawn in its own dark colour.
 *
 * A kit copies what it needs into its own geometry, so the models it was baked from may be
 * released as soon as the source resolves.
 */
import type { BufferGeometry } from 'three'
import {
  VEHICLE_BUCKETS,
  type VehicleBucket,
  type VehicleKind,
  type VehicleKit,
  type VehicleKitSource,
} from '@/lib/world/ambient/types'
import type { VehicleKitConfig } from '@/lib/data/schemas/ambientKit'
import type { LoadedModel } from '../models/prepare'
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

/** Bakes one ambient vehicle kit from a loaded static model. */
export function vehicleKitFromModel(
  loaded: AmbientLoadedModel,
  config: VehicleKitConfig,
): SceneVehicleKit {
  const { ref, model } = loaded
  if (model.kind !== 'static') throw new Error(`Ambient vehicle "${ref.id}" is not a static model`)
  const paintSlot = ref.slots.indexOf('body') + 1
  if (paintSlot === 0) throw new Error(`Ambient vehicle "${ref.id}" has no "body" slot`)
  const parts = splitIntoBuckets(model.geometry, vehicleClassifier(paintSlot, config), {
    order: VEHICLE_BUCKETS,
    matrix: model.matrix,
  })
  if (!parts.some((part) => part.bucket === 'paint')) {
    throw new Error(`Ambient vehicle "${ref.id}" has no body triangles`)
  }
  groundParts(parts)
  const { min, max } = partsBounds(parts)
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
