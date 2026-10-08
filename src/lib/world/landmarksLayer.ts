/**
 * The `landmarks` layer of GET /geo/base (S07a): every modelled landmark's model parameters
 * (data/landmarks/models.json) and its placement (data/landmarks/frames.derived.json, from
 * LION), plus whether it stands on "expanding soon" land and is drawn as a dimmed teaser. Built
 * on the server at build time from validated data, so the 3D chunk needs no data loader and no
 * classic zod. The models carry no names or text (LEGAL-1): name chips take their text from
 * the server's copy (src/scene/CityScene.tsx).
 */
import blenderJson from '@data/landmarks/blender.derived.json'
import framesJson from '@data/landmarks/frames.derived.json'
import modelsJson from '@data/landmarks/models.json'
import { scene } from '@/lib/data/config'
import { landmarks } from '@/lib/data/content'
import { parseDataFile } from '@/lib/data/parse'
import type { Borough, Landmark } from '@/lib/data/schemas/content'
import { BlenderModelsFileSchema, type BlenderModelsFile } from '@/lib/data/schemas/landmarkBlender'
import {
  landmarkModelsFileSchemaFor,
  type LandmarkFrame,
  type LandmarkModel,
} from '@/lib/data/schemas/landmarkModels'
import { LandmarkFramesFileSchema } from '@/lib/data/schemas/world'
import { boroughRenderState } from './places'

export interface LandmarkLayerEntry {
  readonly id: string
  readonly borough: Borough
  /** The landmark's category (landmarks.json): which ones may glow at night (S04f contract). */
  readonly category: Landmark['category']
  /** `teaser`: on "expanding soon" land, drawn with the dimmed material and no windows. */
  readonly style: 'normal' | 'teaser'
  /** The S07a code-built kit model: the fallback while the Blender model loads (if any). */
  readonly model?: LandmarkModel
  /**
   * The Blender model (S07c): its four levels' versions (the `v` of each level's URL, which the
   * client rebuilds: src/scene/models/landmarkLevels.ts) and the kit fallback's scale.
   */
  readonly glb?: {
    readonly v: readonly string[]
    readonly gameScale: BlenderModelsFile['landmarks'][number]['gameScale']
  }
  /** Its placement, without the exclusions only the geo build reads (the client never does). */
  readonly frame: LandmarkFrame
}

export interface LandmarksLayer {
  /** Sorted by id, like the frames. */
  readonly models: readonly LandmarkLayerEntry[]
}

const models = parseDataFile(
  'landmarks/models.json',
  landmarkModelsFileSchemaFor(landmarks),
  modelsJson,
).models
const frames = parseDataFile(
  'landmarks/frames.derived.json',
  LandmarkFramesFileSchema,
  framesJson,
).landmarks

const blender = parseDataFile(
  'landmarks/blender.derived.json',
  BlenderModelsFileSchema,
  blenderJson,
).landmarks

/** The frame the client gets: the INT-7 exclusion and grounds stay with the geo build. */
function servedFrame(frame: LandmarkFrame): LandmarkFrame {
  return Object.fromEntries(
    Object.entries(frame).filter(([key]) => key !== 'exclusion' && key !== 'grounds'),
  ) as LandmarkFrame
}

export function buildLandmarksLayer(): LandmarksLayer {
  const modelOf = new Map(models.map((model) => [model.id, model]))
  const glbOf = new Map(
    blender.map(({ id, files, gameScale }) => [
      id,
      { v: files.map((file) => file.slice(file.indexOf('?v=') + 3)), gameScale },
    ]),
  )
  for (const model of models) {
    if (!frames.some((frame) => frame.id === model.id)) {
      throw new Error(`landmarks layer: no frame for ${model.id}`)
    }
  }
  // Every framed landmark: the S07a kit model, the Blender model (S07c), or both.
  const entries = frames.flatMap((frame): LandmarkLayerEntry[] => {
    const model = modelOf.get(frame.id)
    const glb = glbOf.get(frame.id)
    if (model === undefined && glb === undefined) return []
    const place = landmarks.find((landmark) => landmark.id === frame.id)
    if (place === undefined) throw new Error(`landmarks layer: no landmark ${frame.id}`)
    const dimmed = boroughRenderState(place.borough).state === 'dimmed'
    return [
      {
        id: frame.id,
        borough: place.borough,
        category: place.category,
        style: dimmed ? 'teaser' : 'normal',
        ...(model === undefined ? {} : { model }),
        ...(glb === undefined ? {} : { glb }),
        frame: servedFrame(frame),
      },
    ]
  })
  return { models: entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) }
}

/** The layer GET /geo/base serves (built once per server process). */
export const landmarksLayer: LandmarksLayer = buildLandmarksLayer()

/**
 * How far above the land top a modelled landmark's pin floats so it clears the model: the
 * model's top (frames `pinLiftM`, at the scene's height scale) above its base, less the land
 * top for bridges, whose piers stand on the water plane (y = 0). Whole metres, rounded up.
 */
export function landmarkPinLifts(
  layer: LandmarksLayer = landmarksLayer,
  config: Pick<typeof scene, 'land' | 'landmarks'> = scene,
): ReadonlyMap<string, number> {
  const landTop = config.land.heightM - config.land.baseM
  return new Map(
    layer.models.map((entry) => {
      const top = entry.frame.pinLiftM * config.landmarks.heightScale
      const base = entry.frame.base === 'water' ? 0 : landTop
      return [entry.id, Math.max(0, Math.ceil(base + top - landTop))]
    }),
  )
}
