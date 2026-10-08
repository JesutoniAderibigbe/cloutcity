/**
 * Place plots (S04m, DEC-59): every playable place and home stands on its own square plot of
 * grass, plaza or parking with a chunky, colourful CC0 building (KayKit / Kenney, recoloured per
 * category), like the places of a game map. Planned purely in src/lib/world/venuePlots.ts from
 * data/config/plots.json; the district buildings and fill blocks keep clear of each plot
 * (src/scene/buildings/layer.ts).
 *
 * Every plot part (slab, kerb, bay lines, building, awning, trees, bushes) is merged, one mesh per
 * `chunkM` square, onto the district buildings' material with exactly their attributes
 * (src/scene/props/mergeChunk.ts), so the plots add no shader program and one draw call per
 * square in view; the buildings' windows glow at night through the district window mask. Built
 * in time slices once, after the map is playable; nothing here requests frames afterwards, and
 * nothing is pickable (the pins and their bubbles stay the tap targets).
 *
 * Loaded lazily by the buildings layer (never on the playable path, never precached: the
 * `cc-feature:venue-plots` marker in src/lib/pwa/lazyChunks.ts). three only, no React.
 */
import plotsJson from '@data/config/plots.json'
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Matrix4,
  Mesh,
  Vector3,
  type Material,
} from 'three'
import type { PlotsConfig } from '@/lib/data/schemas/scene'
import { log } from '@/lib/log'
import {
  planPlots,
  plotPlaces,
  type PlotPart,
  type PlotPlace,
  type PlotPlan,
} from '@/lib/world/venuePlots'
import { acquireModels } from '../models/runtime'
import type { LoadedModel } from '../models/prepare'
import { recolorGeometry } from '../models/slots'
import { createSlicer } from '../schedule'
import { areaNames, homePoints, worldHex } from '@/lib/world/mapDressing'
import { buildAreaLabels } from './areaLabels'
import {
  litWindowUv,
  mergeChunk,
  type PlacedModel,
  type PropModel,
  type WindowMask,
} from '../props/mergeChunk'

/** Marker text the budget's optional-chunk filter finds in this chunk (lazyChunks.ts). */
export const PLOTS_FEATURE = 'cc-feature:venue-plots'

// Validated by PlotsConfigSchema in src/lib/data/data.test.ts, which gates every build: the
// classic-zod loader must stay out of client chunks.
const config = plotsJson as PlotsConfig

/** What the page carries for the plots (src/lib/data/districts.ts `plotAssets`). */
export interface PlotAssets {
  /** Model id → its GLB for the tier. */
  readonly files: Readonly<Record<string, string>>
}

export type PlotsStatus = 'loading' | 'ready' | 'failed'

/** What the e2e hook reads (through the buildings layer's view). */
export interface PlotsView {
  readonly status: PlotsStatus
  readonly plots: number
  readonly chunks: number
  /** Chunks the camera sees now (frustum culling decides; this counts the last frame's). */
  readonly triangles: number
}

export interface PlotsLayerOptions {
  readonly assets: PlotAssets
  readonly pins: readonly (Omit<PlotPlace, 'kind'> & { readonly kind: string })[]
  readonly tier: 'low' | 'mid' | 'high'
  readonly groundY: number
  /** The district buildings' material: plots share its program. */
  readonly material: Material
  /** The district material's window mask (null where the tier has none: nothing glows). */
  readonly mask: WindowMask | null
  readonly windowTileCells: number
  readonly buildSliceMs: number
  readonly cacheMaxEntries: number
  readonly prepare: (object: Mesh) => Promise<void>
  /** Something to draw changed: request a frame. */
  readonly onChange: () => void
  readonly yieldFn?: () => Promise<void>
}

export interface PlotsLayer {
  readonly group: Group
  view(): PlotsView
  dispose(): void
}

type Placed = PlacedModel

const _box = new Vector3()
const _size = new Vector3()
const _color = new Color()

/** A box standing on y = 0, flat-coloured (linear vertex colour, as the GLBs bake theirs). */
function boxModel(width: number, height: number, depth: number, hex: string): PropModel {
  const geometry = new BoxGeometry(width, height, depth)
  geometry.translate(0, height / 2, 0)
  geometry.deleteAttribute('uv')
  const color = new Color(hex)
  const count = geometry.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) color.toArray(colors, i * 3)
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  return { geometry, matrix: new Matrix4(), glow: false }
}

/**
 * The geometry with every vertex of colour `from` (a baked token, matched closely) set to `to`:
 * the packs' near-black roofs read as holes from above (S04m). Shares every other attribute.
 */
function remapColor(geometry: BufferGeometry, from: Color, to: Color): BufferGeometry {
  const source = geometry.getAttribute('color')
  if (source === undefined) return geometry
  const color = new Float32Array(source.count * 3)
  let changed = false
  for (let i = 0; i < source.count; i++) {
    _color.fromBufferAttribute(source, i)
    const match =
      Math.abs(_color.r - from.r) + Math.abs(_color.g - from.g) + Math.abs(_color.b - from.b) < 0.02
    if (match) changed = true
    ;(match ? to : _color).toArray(color, i * 3)
  }
  if (!changed) return geometry
  const out = new BufferGeometry()
  out.setIndex(geometry.index)
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    out.setAttribute(name, name === 'color' ? new BufferAttribute(color, 3) : attribute)
  }
  return out
}

/** The footprint (x and z extent) of a model's geometry under its node transform. */
function footprint(model: PropModel): { width: number; depth: number } {
  const geometry = model.geometry
  geometry.computeBoundingBox()
  const box = geometry.boundingBox
  if (box === null) return { width: 1, depth: 1 }
  const corners = [box.min.x, box.max.x].flatMap((x) =>
    [box.min.z, box.max.z].map((z) => _box.set(x, 0, z).applyMatrix4(model.matrix).clone()),
  )
  _size.set(
    Math.max(...corners.map((c) => c.x)) - Math.min(...corners.map((c) => c.x)),
    0,
    Math.max(...corners.map((c) => c.z)) - Math.min(...corners.map((c) => c.z)),
  )
  return { width: _size.x, depth: _size.z }
}

export function createPlotsLayer(options: PlotsLayerOptions): PlotsLayer {
  const group = new Group()
  group.name = 'plots'
  group.userData.feature = PLOTS_FEATURE
  const plans = planPlots(plotPlaces(options.pins, homePoints()), config)
  let status: PlotsStatus = 'loading'
  let disposed = false
  const meshes: Mesh[] = []
  const hex = worldHex
  // The water plane lies at y = 0 (src/scene/geo/buildLand.ts buildWaterGeometry).
  const areas = buildAreaLabels(areaNames(), config.areas, 0, options.groundY, hex)
  if (areas !== null) group.add(areas.mesh)
  const ids = Object.keys(options.assets.files)
  const acquired = acquireModels(
    ids.map((id) => {
      const file = options.assets.files[id] ?? ''
      return { id, kind: 'static' as const, files: { low: file, mid: file, high: file } }
    }),
    options.tier,
    options.cacheMaxEntries,
  )

  async function build(loaded: readonly LoadedModel[]): Promise<void> {
    const base = new Map<string, { model: PropModel; slots: readonly string[] }>()
    ids.forEach((id, i) => {
      const model = loaded[i]
      if (model?.kind !== 'static') return
      base.set(id, {
        model: { geometry: model.geometry, matrix: model.matrix, glow: true },
        // Plot models carry at most one recolour slot, the one their style names
        // (venuePlots.test.ts checks the manifest), so the part's slot names are the list.
        slots: [],
      })
    })
    const models = new Map<string, PropModel>()
    const roofFrom = new Color(hex(config.roof.from))
    const roofTo = new Color(hex(config.roof.to))
    /** The part's model, recoloured and scaled (one variant per distinct look). */
    const variant = (part: PlotPart, scale: number, squash = 1): string | null => {
      const source = base.get(part.model)
      if (source === undefined) return null
      const colors = Object.fromEntries(
        Object.entries(part.slots).map(([slot, token]) => [slot, hex(token)]),
      )
      // Cache keys only (never shown): millimetre-rounded integers.
      const key = `${part.model}|${JSON.stringify(colors)}|${Math.round(scale * 1000)}|${squash}`
      if (!models.has(key)) {
        const geometry = remapColor(
          recolorGeometry(source.model.geometry, Object.keys(colors), colors),
          roofFrom,
          roofTo,
        )
        const matrix = new Matrix4()
          .makeScale(scale, scale * squash, scale)
          .multiply(source.model.matrix)
        // CPU-side only: the merge copies it, so it never reaches the GPU and needs no dispose.
        models.set(key, { geometry, matrix, glow: source.model.glow })
      }
      return key
    }
    const box = (key: string, w: number, h: number, d: number, colour: string) => {
      if (!models.has(key)) models.set(key, boxModel(w, h, d, colour))
      return key
    }

    const half = config.plotM / 2
    const inner = config.plotM - 2 * config.kerbM
    const slab = config.slabM
    const lift = slab + 0.05
    const chunks = new Map<string, Placed[]>()
    const add = (plan: PlotPlan, placed: Placed) => {
      const key = `${Math.floor(plan.x / config.chunkM)},${Math.floor(plan.y / config.chunkM)}`
      const list = chunks.get(key) ?? []
      list.push(placed)
      chunks.set(key, list)
    }
    for (const plan of plans) {
      const kerb = box('kerb', config.plotM, slab, config.plotM, hex(config.kerb))
      add(plan, { model: kerb, x: plan.x, y: plan.y, rotation: 0, lift: 0 })
      const lawn = box('lawn', inner, slab + 0.05, inner, hex(config.lawn))
      add(plan, { model: lawn, x: plan.x, y: plan.y, rotation: 0, lift: 0 })
      const yard = plan.y - half + config.kerbM
      let frontY = plan.y
      if (plan.building !== null) {
        const source = base.get(plan.building.model)
        if (source !== undefined) {
          const size = footprint(source.model)
          const scale = plan.building.footprintM / Math.max(size.width, size.depth, 0.001)
          const squash = config.buildingHeightScale
          const key = variant(plan.building, scale, squash)
          if (key !== null) {
            add(plan, { model: key, x: plan.building.x, y: plan.building.y, rotation: 0, lift })
          }
          frontY = plan.building.y - (size.depth * scale) / 2
          if (plan.awning !== null) {
            const awning = variant(plan.awning, scale, squash)
            if (awning !== null) {
              add(plan, { model: awning, x: plan.awning.x, y: frontY, rotation: 0, lift })
            }
          }
        }
      }
      if (plan.apron !== 'none') {
        // The front yard, kerb to building (or the whole lawn without one), paved.
        const depth = Math.max(
          4,
          (plan.building === null ? plan.y + half - config.kerbM : frontY) - yard,
        )
        const colour = config.aprons[plan.apron]
        const apron = box(
          `apron|${colour}|${Math.round(depth * 10)}`,
          inner,
          slab + 0.1,
          depth,
          hex(colour),
        )
        add(plan, { model: apron, x: plan.x, y: yard + depth / 2, rotation: 0, lift: 0 })
        if (plan.apron === 'parking') {
          const { widthM, lengthM, gapM, color } = config.stripe
          const stripe = box('stripe', widthM, 0.04, lengthM, hex(color))
          const bays = Math.floor((inner - 2 * gapM) / gapM)
          for (let i = 0; i <= bays; i++) {
            add(plan, {
              model: stripe,
              x: plan.x - inner / 2 + gapM + i * gapM,
              y: yard + 2 + lengthM / 2,
              rotation: 0,
              lift: slab + 0.1,
            })
          }
        }
      }
      for (const part of plan.dressing) {
        const key = variant(part, part.scale)
        if (key !== null) {
          add(plan, { model: key, x: part.x, y: part.y, rotation: part.rotation, lift })
        }
      }
    }

    const litUv = options.mask === null ? null : litWindowUv(options.mask, options.windowTileCells)
    const step = createSlicer(options.buildSliceMs, options.yieldFn)
    for (const [key, placements] of chunks) {
      const merged = await mergeChunk(placements, models, options.groundY, litUv, step)
      if (disposed) {
        merged.geometry.dispose()
        return
      }
      const mesh = new Mesh(merged.geometry, options.material)
      mesh.name = `plots-${key}`
      mesh.raycast = () => {}
      mesh.matrixAutoUpdate = false
      mesh.userData.triangles = merged.triangles
      await options.prepare(mesh)
      if (disposed) {
        merged.geometry.dispose()
        return
      }
      meshes.push(mesh)
      group.add(mesh)
    }
    status = 'ready'
    options.onChange()
  }

  acquired.models
    .then((loaded) => (disposed ? undefined : build(loaded)))
    .catch((error: unknown) => {
      status = 'failed'
      // Expected offline (the models are never precached): the places keep their pins.
      log.info('venue plots: not loaded', {
        reason: error instanceof Error ? error.message : String(error),
      })
    })

  return {
    group,
    view() {
      let triangles = 0
      for (const mesh of meshes) triangles += (mesh.userData.triangles as number | undefined) ?? 0
      return { status, plots: plans.length, chunks: meshes.length, triangles }
    },
    dispose() {
      disposed = true
      for (const mesh of meshes) {
        mesh.geometry.dispose()
        mesh.removeFromParent()
      }
      areas?.dispose()
      group.removeFromParent()
      acquired.release()
    },
  }
}
