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
  /**
   * Metres the name chip moves north (+) or south (-) from its default spot so it clears a
   * neighbour's chip (UX-14, {@link chipShifts}). Omitted when 0.
   */
  readonly chipShiftM?: number
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
  const sorted = entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const lifts = landmarkPinLifts({ models: sorted })
  const shifts = chipShifts(
    sorted.map((entry) => ({
      id: entry.id,
      x: entry.frame.anchor.x,
      y: entry.frame.anchor.y,
      liftM: lifts.get(entry.id) ?? 0,
    })),
    scene.landmarkChips,
    scene.camera.polarDeg.default,
  )
  return {
    models: sorted.map((entry) => {
      const shift = shifts.get(entry.id) ?? 0
      return shift === 0 ? entry : { ...entry, chipShiftM: shift }
    }),
  }
}

/**
 * Name chips that never overlap (UX-14): two landmarks a block apart (the Deco spire and the
 * 42nd St terminal) put their flat chips on top of each other. A chip floats `liftM` over its
 * model, and from the default camera (`polarDeg` from straight down) a raised chip shows as far
 * north as one lying `liftM * tan(polar)` further north on the ground, so the layout works on
 * that apparent position. Chips are laid out from the apparent north down; one that overlaps a
 * chip already placed moves south, below it, by whole metres, until it overlaps none.
 * Deterministic: the same anchors give the same shifts, whatever their order.
 */
export function chipShifts(
  anchors: readonly {
    readonly id: string
    readonly x: number
    readonly y: number
    readonly liftM: number
  }[],
  chips: Pick<typeof scene.landmarkChips, 'widthM' | 'heightM' | 'offsetM'>,
  polarDeg: number,
): ReadonlyMap<string, number> {
  const gap = chips.heightM * 0.15
  const rise = Math.tan((polarDeg * Math.PI) / 180)
  const apparent = (anchor: (typeof anchors)[number]) =>
    anchor.y - chips.offsetM + anchor.liftM * rise
  const placed: { x: number; y: number }[] = []
  const shifts = new Map<string, number>()
  const order = [...anchors].sort(
    (a, b) => apparent(b) - apparent(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  for (const anchor of order) {
    const start = apparent(anchor)
    let y = start
    for (let moved = true; moved;) {
      moved = false
      for (const other of placed) {
        const clearX = Math.abs(other.x - anchor.x) >= chips.widthM + gap
        const clearY = Math.abs(other.y - y) >= chips.heightM + gap
        if (clearX || clearY) continue
        y = Math.floor(other.y - chips.heightM - gap)
        moved = true
      }
    }
    placed.push({ x: anchor.x, y })
    const shift = Math.round(y - start)
    if (shift !== 0) shifts.set(anchor.id, shift)
  }
  return shifts
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
