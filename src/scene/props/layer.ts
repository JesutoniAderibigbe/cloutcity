/**
 * Street props (S04i): hand-made streetlights, trees, benches, hydrants, traffic lights, parked
 * cars and roof water towers on the real LION streets around the camera focus. Lives in its own
 * lazy chunk (Buildings.tsx imports it only once the camera comes within
 * `props.prefetchBelowDistanceM` on mid or high), so the map never waits for it and the low tier
 * never loads it.
 *
 * Placement is pure (src/lib/world/streetProps.ts); here the placements are bucketed into
 * `chunkM` squares, and the squares nearest the camera target, within the perf.json
 * `streetProps` caps, are merged one mesh each onto the district material (mergeChunk.ts): one
 * draw call per chunk and no new shader program. Building runs in time slices; nothing is drawn
 * above `props.showBelowDistanceM`, and only a change of what is drawn requests a frame, so an
 * props add no frames of their own. Props are never pickable. three only, no React.
 */
import perfJson from '@data/config/perf.json'
import propsJson from '@data/config/props.json'
import {
  Group,
  Mesh,
  type Camera,
  type Material,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from 'three'
import type { MapControls } from 'three/addons/controls/MapControls.js'
import type { CitySceneConfig } from '@/lib/data/schemas/scene'
import type { LocalPoint } from '@/lib/geo/projection'
import { log } from '@/lib/log'
import {
  applyQuotas,
  bucket,
  fillBlockLookup,
  outsideFillBlocks,
  decodeStreets,
  placeChain,
  placeJunctions,
  placeWaterTowers,
  selectChunks,
  type Chunk,
  type ChunkCaps,
  type FillBlocks,
  type Placement,
  type PlacementContext,
  type PropsConfig,
  type PropsTier,
  type TowerCandidate,
} from '@/lib/world/streetProps'
import { acquireModels } from '../models/runtime'
import type { LoadedModel } from '../models/prepare'
import type { ModelRef } from '../models/types'
import { createSlicer } from '../schedule'
import {
  litWindowUv,
  mergeChunk,
  type MergedChunk,
  type PropModel,
  type WindowMask,
} from './mergeChunk'
import { loadStreets } from '../streets/loadStreets'

/** What the page carries for a tier that draws props (src/lib/data/districts.ts). */
export interface StreetPropsAssets {
  /** /geo/streets?v=<hash>. */
  readonly url: string
  /** props.json `prefetchBelowDistanceM` of the tier: Buildings.tsx loads this chunk then. */
  readonly prefetchBelowDistanceM: number
  /** props.json `rules.waterTower` heights: the buildings keep only masses within. */
  readonly towerHeightM: readonly [number, number]
  /** Model id → its GLB for the tier. */
  readonly files: Readonly<Record<string, string>>
}

export type StreetPropsStatus = 'idle' | 'loading' | 'ready' | 'failed'

/** What the e2e hook reads (src/scene/testHooks.tsx `props()`). */
export interface StreetPropsView {
  readonly status: StreetPropsStatus
  readonly tier: PropsTier
  /** A fetch, placement or chunk build is under way. */
  readonly busy: boolean
  /** Chunks drawn now, nearest the camera target first. */
  readonly chunks: readonly { readonly key: string; readonly distance: number }[]
  readonly chunksDrawn: number
  /** Drawn instances per model id. */
  readonly instances: Readonly<Record<string, number>>
  readonly triangles: number
  /** Drawn vertices that sample a lit window (they glow at night). */
  readonly glowVertices: number
  /** Placements in the whole city, before chunk selection. */
  readonly placements: number
}

/**
 * data/config/props.json and perf.json `streetProps` of a tier, read here rather than carried by the
 * page (both files are validated by src/lib/data/data.test.ts, which gates every build).
 */
export function propsSettings(tier: PropsTier): { config: PropsConfig; caps: ChunkCaps } {
  const budget = (perfJson as unknown as { streetProps: StreetPropsBudget }).streetProps
  return {
    config: propsJson as unknown as PropsConfig,
    caps: {
      instancesMax: Object.fromEntries(
        Object.entries(budget.instancesMax).map(([model, caps]) => [model, caps[tier]]),
      ),
      trianglesMax: budget.trianglesMax[tier],
      drawCallsMax: budget.drawCallsMax[tier],
    },
  }
}

interface StreetPropsBudget {
  readonly instancesMax: Readonly<Record<string, Readonly<Record<PropsTier, number>>>>
  readonly trianglesMax: Readonly<Record<PropsTier, number>>
  readonly drawCallsMax: Readonly<Record<PropsTier, number>>
}

export interface StreetPropsLayerOptions {
  readonly assets: StreetPropsAssets
  readonly tier: PropsTier
  /** props.json and the tier's perf.json caps; propsSettings(tier) by default. */
  readonly settings?: { readonly config: PropsConfig; readonly caps: ChunkCaps }
  /** The district windows' tile size (litWindowUv) and the build slice length. */
  readonly buildings: CitySceneConfig['buildings']
  /** The district material's window mask (null on a tier without windows: nothing glows). */
  readonly mask: WindowMask | null
  readonly cacheMaxEntries: number
  /** The district buildings' material: props share its program. */
  readonly material: Material
  readonly groundY: number
  /** Pin ground points, local metres: props keep `props.pinClearM` away. */
  readonly pins: readonly LocalPoint[]
  /** Compiles an object's shaders before it is first drawn (renderer.compileAsync). */
  readonly prepare: (object: Object3D) => Promise<void>
  /** Something to draw changed: request a frame. */
  readonly onChange: () => void
  readonly fetchJson?: (url: string) => Promise<unknown>
  readonly loadModels?: (refs: readonly Pick<ModelRef, 'id' | 'kind' | 'files'>[]) => {
    readonly models: Promise<LoadedModel[]>
    release(): void
  }
  readonly yieldFn?: () => Promise<void>
}

export interface StreetPropsLayer {
  readonly group: Group
  /** The camera: its distance to its target, and the target in local metres. */
  setView(distance: number, target: LocalPoint): void
  /** A district's drawn masses arrived: roof water towers may stand on them. */
  addTowers(districtId: string, masses: readonly TowerCandidate[]): void
  /** The tier's fill blocks arrived: props keep out of their footprints. */
  setBlocks(blocks: FillBlocks): void
  view(): StreetPropsView
  /** The chunk meshes built so far (drawn or not). */
  meshes(): readonly Mesh[]
  dispose(): void
}

/** The merged meshes ignore the raycaster: props never block a pin or a tap. */
export const noRaycast: Object3D['raycast'] = () => {}

interface Built {
  readonly mesh: Mesh
  readonly merged: MergedChunk
  /** The placements it was built from (a tower update makes a new array). */
  readonly placements: readonly Placement[]
}

export function createStreetPropsLayer(options: StreetPropsLayerOptions): StreetPropsLayer {
  const { tier } = options
  const { config, caps } = options.settings ?? propsSettings(tier)
  const loadModels =
    options.loadModels ??
    ((refs: readonly Pick<ModelRef, 'id' | 'kind' | 'files'>[]) =>
      acquireModels(refs, tier, options.cacheMaxEntries))
  // Every prop model is a static GLB: one file serves the tier.
  const refs = Object.entries(options.assets.files).map(([id, file]) => ({
    id,
    kind: 'static' as const,
    files: { low: file, mid: file, high: file },
  }))
  const group = new Group()
  group.name = 'street-props'
  let status: StreetPropsStatus = 'idle'
  let disposed = false
  let distance = Infinity
  let target: LocalPoint = { x: 0, y: 0 }
  let release: (() => void) | null = null
  let models = new Map<string, PropModel>()
  let triangles = new Map<string, number>()
  let context: PlacementContext | null = null
  /** Fill block footprints (Buildings.tsx onBlocksReady), or null before they arrive. */
  let insideBlock: ((point: LocalPoint) => boolean) | null = null
  /** Street props per chunk, every one placed (filtered and trimmed in combine). */
  let streetChunks = new Map<string, Chunk>()
  /** Every chunk to choose from: street props plus the current water towers. */
  let chunks = new Map<string, Chunk>()
  const towers = new Map<string, readonly TowerCandidate[]>()
  const built = new Map<string, Built>()
  const queue: string[] = []
  let building = false
  let placing = false
  let drawnKeys: readonly string[] = []

  const litUv =
    options.mask === null ? null : litWindowUv(options.mask, options.buildings.windowTileCells)
  const step = () => createSlicer(options.buildings.buildSliceMs, options.yieldFn)

  /** Rebuilds `chunks` from the street props and every district's towers. */
  /** A cheap identity of a placement list: a changed chunk is rebuilt when next drawn. */
  const signature = (list: readonly Placement[]) =>
    `${list.length}:${Math.round(list.reduce((sum, p) => sum + p.x * 3 + p.y, 0) * 10)}`

  /**
   * Rebuilds `chunks`: the street props outside every fill block, plus the current water
   * towers, each chunk then trimmed to the rule quotas (after the filter, so a quota is never
   * spent on a prop the blocks would hide).
   */
  const combine = () => {
    if (context === null) return
    const next = new Map<string, Chunk>()
    for (const chunk of streetChunks.values()) {
      next.set(chunk.key, {
        ...chunk,
        placements: outsideFillBlocks(chunk.placements, insideBlock),
      })
    }
    for (const masses of towers.values()) {
      bucket(next, placeWaterTowers(masses, context), config.chunkM)
    }
    applyQuotas(next, config, tier)
    chunks = next
    for (const [key, entry] of built) {
      const now = chunks.get(key)?.placements ?? []
      if (signature(now) !== signature(entry.placements)) drop(key)
    }
  }

  const drop = (key: string) => {
    const entry = built.get(key)
    if (entry === undefined) return
    built.delete(key)
    entry.mesh.removeFromParent()
    entry.mesh.geometry.dispose()
  }

  const applyView = () => {
    if (status !== 'ready' || disposed) return
    const show = distance <= config.showBelowDistanceM[tier]
    const selection = show
      ? selectChunks(
          chunks.values(),
          target,
          config.focusRadiusM[tier],
          caps,
          (model) => triangles.get(model) ?? 0,
        )
      : null
    const wanted = selection?.chunks.map((chunk) => chunk.key) ?? []
    let changed = false
    for (const [key, entry] of built) {
      const visible = wanted.includes(key)
      if (entry.mesh.visible !== visible) {
        entry.mesh.visible = visible
        changed = true
      }
    }
    drawnKeys = wanted.filter((key) => built.has(key))
    queue.length = 0
    queue.push(...wanted.filter((key) => !built.has(key)))
    // Keep a few undrawn chunks for panning back; free the rest.
    const keep = 2 * caps.drawCallsMax
    const spare = [...built.keys()].filter((key) => !wanted.includes(key))
    for (const key of spare.slice(0, Math.max(0, built.size - keep))) drop(key)
    if (changed) options.onChange()
    void pump()
  }

  async function pump(): Promise<void> {
    if (building) return
    building = true
    try {
      while (!disposed && queue.length > 0) {
        const key = queue.shift()
        const chunk = key === undefined ? undefined : chunks.get(key)
        if (chunk === undefined || built.has(chunk.key)) continue
        const placements = chunk.placements
        const merged = await mergeChunk(placements, models, options.groundY, litUv, step())
        if (disposed) {
          merged.geometry.dispose()
          return
        }
        const mesh = new Mesh(merged.geometry, options.material)
        mesh.name = `street-props-${chunk.key}`
        mesh.raycast = noRaycast
        mesh.matrixAutoUpdate = false
        mesh.visible = false
        await options.prepare(mesh)
        if (disposed) {
          merged.geometry.dispose()
          return
        }
        // The towers may have changed while it was built: build it again.
        if (chunks.get(chunk.key)?.placements !== placements) {
          merged.geometry.dispose()
          continue
        }
        built.set(chunk.key, { mesh, merged, placements })
        group.add(mesh)
        applyView()
      }
    } finally {
      building = false
    }
  }

  async function load(): Promise<void> {
    status = 'loading'
    const acquired = loadModels(refs)
    release = acquired.release
    try {
      const [streets, loaded] = await Promise.all([
        loadStreets(options.assets.url, options.fetchJson),
        acquired.models,
      ])
      if (disposed) return
      const glow = new Set<string>(config.glowModels)
      models = new Map()
      triangles = new Map()
      refs.forEach((ref, i) => {
        const model = loaded[i]
        if (model?.kind !== 'static') return
        models.set(ref.id, {
          geometry: model.geometry,
          matrix: model.matrix,
          glow: glow.has(ref.id),
        })
        triangles.set(ref.id, model.triangles)
      })
      placing = true
      const data = decodeStreets(streets, config.seed)
      const ctx: PlacementContext = { tier, config, pins: options.pins, clear: data.clear }
      const street = new Map<string, Chunk>()
      const slice = step()
      for (const chain of data.chains) {
        bucket(street, placeChain(chain, ctx), config.chunkM)
        await slice()
        if (disposed) return
      }
      bucket(street, placeJunctions(data, ctx), config.chunkM)
      streetChunks = street
      context = ctx
      combine()
      placing = false
      status = 'ready'
      applyView()
    } catch (error) {
      placing = false
      status = 'failed'
      release?.()
      release = null
      // Expected offline (the streets and models are never precached): the map carries on bare.
      log.info('street props: not loaded', {
        url: options.assets.url,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    group,
    setView(nextDistance, nextTarget) {
      distance = nextDistance
      target = nextTarget
      if (status === 'idle' && distance <= config.prefetchBelowDistanceM[tier]) void load()
      applyView()
    },
    setBlocks(blocks) {
      insideBlock = fillBlockLookup(blocks, config.blockClearM)
      if (status !== 'ready') return
      combine()
      applyView()
    },
    addTowers(districtId, masses) {
      towers.set(districtId, masses)
      if (status !== 'ready') return
      combine()
      applyView()
    },
    view() {
      const instances: Record<string, number> = {}
      let drawnTriangles = 0
      let glowVertices = 0
      const drawn = drawnKeys
        .map((key) => ({ key, entry: built.get(key), chunk: chunks.get(key) }))
        .filter((d) => d.entry?.mesh.visible === true)
      for (const { entry } of drawn) {
        if (entry === undefined) continue
        for (const [model, n] of Object.entries(entry.merged.instances)) {
          instances[model] = (instances[model] ?? 0) + n
        }
        drawnTriangles += entry.merged.triangles
        glowVertices += entry.merged.glowVertices
      }
      let placements = 0
      for (const chunk of chunks.values()) placements += chunk.placements.length
      return {
        status,
        tier,
        busy: status === 'loading' || placing || building || queue.length > 0,
        chunks: drawn.map(({ key, chunk }) => ({
          key,
          distance: chunk === undefined ? 0 : Math.hypot(chunk.x - target.x, chunk.y - target.y),
        })),
        chunksDrawn: drawn.length,
        instances,
        triangles: drawnTriangles,
        glowVertices,
        placements,
      }
    },
    meshes() {
      return [...built.values()].map((entry) => entry.mesh)
    },
    dispose() {
      disposed = true
      queue.length = 0
      for (const key of [...built.keys()]) drop(key)
      group.removeFromParent()
      release?.()
      release = null
    },
  }
}

export interface MountStreetPropsOptions {
  /** The camera rig: props follow its target and distance. */
  readonly rig: MapControls
  /** Where the props' group joins the scene (the buildings' root). */
  readonly root: Object3D
  readonly assets: StreetPropsAssets
  readonly tier: string
  /** The city config: `buildings` (windows, build slices) and `models` (cache size). */
  readonly config: Pick<CitySceneConfig, 'buildings' | 'models'>
  /** The buildings' material set: props draw with `district` and its window `mask`. */
  readonly materials: { readonly district: Material; readonly mask: WindowMask | null }
  readonly groundY: number
  readonly pins: readonly LocalPoint[]
  /** Each loaded district's water tower candidates, kept by Buildings.tsx; read once here. */
  readonly towers: ReadonlyMap<string, readonly TowerCandidate[]>
  /** The tier's fill blocks if the buildings already drew them (later: `setBlocks`). */
  readonly blocks: FillBlocks | null
  /** Set to the layer for its life: later districts reach it through `addTowers`. */
  readonly layerRef: { current: StreetPropsLayer | null }
  readonly three: { readonly gl: WebGLRenderer; readonly camera: Camera; readonly scene: Scene }
  readonly onChange: () => void
}

/**
 * Creates the layer and keeps it on the rig's view; returns the unmount. What Buildings.tsx
 * calls once the camera comes close, so the code that follows the camera ships here, in the lazy
 * chunk, not with the map.
 */
export function mountStreetProps(options: MountStreetPropsOptions): () => void {
  const { rig, three } = options
  const layer = createStreetPropsLayer({
    assets: options.assets,
    tier: options.tier === 'high' ? 'high' : 'mid',
    buildings: options.config.buildings,
    cacheMaxEntries: options.config.models.cacheMaxEntries,
    material: options.materials.district,
    mask: options.materials.mask,
    groundY: options.groundY,
    pins: options.pins,
    onChange: options.onChange,
    prepare: async (object) => {
      if (three.gl.extensions.has('KHR_parallel_shader_compile')) {
        await three.gl.compileAsync(object, three.camera, three.scene)
      }
    },
  })
  for (const [id, masses] of options.towers) layer.addTowers(id, masses)
  if (options.blocks !== null) layer.setBlocks(options.blocks)
  options.layerRef.current = layer
  options.root.add(layer.group)
  const update = () => layer.setView(rig.getDistance(), { x: rig.target.x, y: -rig.target.z })
  rig.addEventListener('change', update)
  update()
  return () => {
    rig.removeEventListener('change', update)
    layer.dispose()
    if (options.layerRef.current === layer) options.layerRef.current = null
  }
}
