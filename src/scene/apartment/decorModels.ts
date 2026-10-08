/**
 * Hand-made models for the apartment's decor and built-in fixtures (S16, S04h, S40), behind the
 * visuals seam (visuals.ts). ApartmentCanvas imports this module lazily, once the room is up, so
 * the glTF loader, the meshopt decoder and the model manifest load in their own chunk and never
 * grow the apartment chunk (perf.json `apartmentChunkJsGzKB`).
 *
 * scene.json `models.decor` names which decor items use a model and which model slot their
 * colour variant recolours (none for a model with one look); data/homes/interiors.json names the
 * fixtures' models. Everything else (and everything, until the models arrive or if they fail)
 * keeps the code-built stand-in. The room shell stays code-built: its windows and door sit at
 * each home's own cells, which the fixed 2.1 m wall modules cannot follow.
 */
import interiorsJson from '@data/homes/interiors.json'
import manifestJson from '@data/assets/manifest.json'
import { Group, Mesh, type IUniform, type Material, type Object3D } from 'three'
import type { QualityTier } from '@/lib/data/schemas/config'
import { createModelMaterial } from '../models/materials'
import type { LoadedModel, StaticModel } from '../models/prepare'
import { acquireModels } from '../models/runtime'
import { modelsConfig } from './modelsConfig'
import { disposeRecolored, recolorGeometry } from '../models/slots'
import type { ModelRef } from '../models/types'
import type { ApartmentVisuals, DecorVisual } from './visuals'

function fail(what: string): never {
  throw new Error(`apartment decor models: ${what}`)
}

interface ModelEntry {
  readonly ref: ModelRef
  /** Half the model's width, for the mid tier's blob shadow. */
  readonly footprintM: number
  readonly sizeM: { readonly w: number; readonly d: number }
  readonly backM: number
}

interface DecorEntry {
  readonly model: string
  /** The model slot the colour variant recolours, or null for a model with one look. */
  readonly slot: string | null
}

/** A static model's manifest entry as a model ref with its size. */
function modelEntry(id: string): ModelEntry {
  const entry = manifestJson.models.find((candidate) => candidate.id === id)
  if (entry === undefined || entry.kind !== 'static' || entry.bounds === undefined) {
    fail(`"${id}" is not a static model in the manifest`)
  }
  const [minX = 0, minY = 0, minZ = 0] = entry.bounds?.min ?? []
  const [maxX = 0, maxY = 0, maxZ = 0] = entry.bounds?.max ?? []
  return {
    footprintM: Math.max(maxX - minX, maxZ - minZ) / 2,
    sizeM: { w: maxX - minX, d: maxZ - minZ },
    backM: Math.max(0, -minZ),
    ref: {
      id: entry.id,
      kind: 'static',
      category: entry.category as ModelRef['category'],
      slots: entry.slots,
      emissive: entry.emissive,
      clips: entry.clips,
      bounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
      files: {
        low: entry.tiers.low.file,
        mid: entry.tiers.mid.file,
        high: entry.tiers.high.file,
      },
    },
  }
}

/** Each mapped decor item's model and recolour slot. */
export function decorEntries(): ReadonlyMap<string, DecorEntry> {
  const entries = new Map<string, DecorEntry>()
  for (const [itemId, { model, slot }] of Object.entries(modelsConfig().decor)) {
    const { ref } = modelEntry(model)
    if (slot !== null && !ref.slots.includes(slot)) fail(`${model} has no slot "${slot}"`)
    entries.set(itemId, { model, slot })
  }
  return entries
}

/** Every model the apartment draws: the decor items' and the homes' fixtures'. */
export function apartmentModelIds(): readonly string[] {
  const ids = new Set<string>([...decorEntries().values()].map((entry) => entry.model))
  for (const home of Object.values(interiorsJson.homes)) {
    for (const fixture of home.fixtures) {
      if ('model' in fixture && typeof fixture.model === 'string') ids.add(fixture.model)
    }
  }
  return [...ids].sort()
}

export interface DecorModels {
  /** `placeholder` with every mapped decor item and fixture drawn by its model. */
  visuals(placeholder: ApartmentVisuals): ApartmentVisuals
  /** Releases the models and the shared material. */
  dispose(): void
}

const noRaycast: Object3D['raycast'] = () => {}

function modelVisual(
  model: StaticModel,
  entry: ModelEntry,
  recolor: { readonly slot: string; readonly color: string } | null,
  material: Material,
): DecorVisual {
  const geometry =
    recolor === null
      ? model.geometry
      : recolorGeometry(model.geometry, entry.ref.slots, { [recolor.slot]: recolor.color })
  const mesh = new Mesh(geometry, material)
  // The model's own node transform (real-world scale over quantized positions).
  mesh.matrixAutoUpdate = false
  mesh.matrix.copy(model.matrix)
  mesh.raycast = noRaycast
  mesh.receiveShadow = true
  const object = new Group()
  object.add(mesh)
  object.raycast = noRaycast
  return {
    object,
    footprintM: entry.footprintM,
    sizeM: entry.sizeM,
    backM: entry.backM,
    setCastShadow(on) {
      mesh.castShadow = on
    },
    dispose() {
      if (geometry !== model.geometry) disposeRecolored(model.geometry, geometry)
    },
  }
}

/**
 * Loads every apartment model at `tier`. Rejects when any fails (the caller keeps the
 * stand-ins); the night glow follows `nightGlow` when given (the apartment's lamps).
 */
export async function loadDecorModels(
  tier: QualityTier,
  nightGlow?: IUniform<number>,
): Promise<DecorModels> {
  const config = modelsConfig()
  const decor = decorEntries()
  const ids = apartmentModelIds()
  const entries = new Map(ids.map((id) => [id, modelEntry(id)]))
  const refs = ids.map((id) => entries.get(id)?.ref ?? fail(id))
  const acquired = acquireModels(refs, tier, config.cacheMaxEntries)
  let loaded: LoadedModel[]
  try {
    loaded = await acquired.models
  } catch (error) {
    acquired.release()
    throw error
  }
  const material = createModelMaterial({ config, tier, ...(nightGlow && { nightGlow }) })
  const models = new Map<string, StaticModel>()
  ids.forEach((id, i) => {
    const model = loaded[i]
    if (model?.kind !== 'static') fail(`${id} did not load as a static model`)
    models.set(id, model)
  })
  const build = (modelId: string, recolor: { slot: string; color: string } | null) => {
    const model = models.get(modelId)
    const entry = entries.get(modelId)
    return model === undefined || entry === undefined
      ? null
      : modelVisual(model, entry, recolor, material)
  }
  return {
    visuals(placeholder) {
      return {
        buildRoom: (layout, roomTier, finishes) =>
          placeholder.buildRoom(layout, roomTier, finishes),
        buildDecor(itemId, color) {
          const entry = decor.get(itemId)
          const visual =
            entry === undefined
              ? null
              : build(entry.model, entry.slot === null ? null : { slot: entry.slot, color })
          return visual ?? placeholder.buildDecor(itemId, color)
        },
        buildFixture: (modelId) => build(modelId, null) ?? placeholder.buildFixture(modelId),
        dispose: () => placeholder.dispose(),
      }
    },
    dispose() {
      material.dispose()
      acquired.release()
    },
  }
}
