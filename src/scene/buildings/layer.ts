/**
 * The district buildings and blocks of one quality tier, loaded and culled by view (S04d,
 * TUNE-7): a district is fetched and built (time-sliced) once the camera comes within its draw
 * distance plus a margin, drawn only while within that distance, and the blocks draw only the
 * instances in view. Nothing loads until the city is on screen (`start`). three only, no React:
 * Buildings.tsx owns one per tier and feeds it the camera, and loads this module (with the
 * district and block builders) only once the city has drawn, so none of it weighs on the
 * playable path (PERF-6).
 */
import plotsJson from '@data/config/plots.json'
import { Group, Mesh, Vector3, type Camera, type Material } from 'three'
import type { DistrictAssets } from '@/lib/data/districts'
import type { MapStyle, PlotsConfig, SceneConfig } from '@/lib/data/schemas/scene'
import { log } from '@/lib/log'
import {
  inClearing,
  planPlots,
  plotClearings,
  plotPlaces,
  type PlotClearing,
  type PlotPlace,
} from '@/lib/world/venuePlots'
import { homePoints, worldHex } from '@/lib/world/mapDressing'
import { toLocal } from '../geo/coords'
import type { BoroughId } from '../geo/schema'
import { createSlicer } from '../schedule'
import {
  NO_FILL,
  buildBlocks,
  type BlockColors,
  type BlockFill,
  type BlocksObjects,
} from './buildBlocks'
import {
  buildDistrictGeometry,
  districtMasses,
  drawnAt,
  massesFor,
  type DistrictColors,
  type DistrictGeometry,
  type DistrictMass,
} from './buildDistrict'
import type { WindowMask } from '../props/mergeChunk'
import type { PlotsLayer, PlotsView } from '../plots/layer'
import { BlocksMiniSchema, DistrictBuildingsMiniSchema, type Blocks } from './schema'
import { distanceToDistrict, drawDistances, type ViewPoint } from './view'

export type DistrictStatus = 'idle' | 'loading' | 'ready' | 'failed'

export interface DistrictView {
  readonly id: string
  readonly status: DistrictStatus
  /** Drawn for the current view (loaded and within the draw distance). */
  readonly visible: boolean
  readonly masses: number
  readonly drawnMasses: number
  /** Triangles at the current density (whether or not the camera sees them). */
  readonly triangles: number
}

export interface BuildingsLayerView {
  readonly tier: DistrictAssets['tier']
  readonly started: boolean
  /** A fetch or build is under way. */
  readonly busy: boolean
  readonly density: number
  readonly drawDistances: { readonly districts: number; readonly blocks: number }
  readonly districts: readonly DistrictView[]
  readonly blocks: {
    readonly status: DistrictStatus
    readonly total: number
    readonly drawn: number
    readonly triangles: number
    /** Fill-lite instances drawn (S04i). */
    readonly lots: number
    readonly plates: number
    readonly trees: number
  }
  /** The place plots (S04m), or null before their chunk loads (or with no plots). */
  readonly plots: PlotsView | null
}

export interface BuildingsLayerOptions {
  readonly assets: DistrictAssets
  readonly groundY: number
  readonly config: SceneConfig['buildings']
  readonly districtColors: DistrictColors
  readonly blockColors: BlockColors
  /** The map style's background height (S04m): masses and blocks at this share. Default 1. */
  readonly heightScale?: number
  /**
   * The map style's colours (S04m), theme tokens resolved here, in this lazy chunk: walls, roof
   * and blocks replace `districtColors` and `blockColors` where given.
   */
  readonly styleColors?: MapStyle['colors']
  /** How the tier dresses its blocks (S04i fill-lite); default: one box per block, no trees. */
  readonly blockFill?: BlockFill
  readonly dimmedBoroughs: ReadonlySet<BoroughId>
  readonly materials: {
    readonly district: Material
    readonly blocks: Material
    readonly blocksDimmed: Material
  }
  /** Compiles an object's shaders before it is first drawn (renderer.compileAsync). */
  readonly prepare: (object: Group | Mesh) => Promise<void>
  /** Something to draw changed: request a frame. */
  readonly onChange: () => void
  /** A file failed to load or validate (the rest of the city carries on without it). */
  readonly onError: (url: string, reason: string) => void
  /**
   * A district's masses are built and in the scene (S04i: street props put water towers on
   * them). Masses come most prominent first; the tier draws the first
   * `massesFor(density, masses.length)` of them (buildDistrict.ts).
   */
  readonly onDistrictReady?: (id: string, masses: readonly DistrictMass[]) => void
  /** The tier's procedural blocks are drawn: street props keep out of them (S04i). */
  readonly onBlocksReady?: (blocks: Blocks) => void
  /**
   * The place plots (S04m): the pins (venues get plots) and the page's plot assets. District
   * masses and fill blocks keep clear of every plot; the plots themselves load lazily.
   */
  readonly plots?: {
    readonly pins: readonly (Omit<PlotPlace, 'kind'> & {
      readonly kind: string
      /** A ring landmark on the game map (S07d): masses and blocks clear its footprint too. */
      readonly game?: { readonly clearM: number }
    })[]
    readonly mask: WindowMask | null
    readonly cacheMaxEntries: number
  }
  readonly fetchJson?: (url: string) => Promise<unknown>
  readonly yieldFn?: () => Promise<void>
}

/**
 * The masses outside every clearing, at `heightScale` of their height (S04m): a mass goes when
 * its first ring's centroid or any of its corners lies in a plot's clearing.
 */
export function softenMasses(
  masses: readonly DistrictMass[],
  clearings: readonly PlotClearing[],
  heightScale: number,
): DistrictMass[] {
  return masses
    .filter((mass) => {
      const outer = mass.rings[0] ?? []
      if (outer.length === 0) return true
      const centre = {
        x: outer.reduce((sum, p) => sum + p.x, 0) / outer.length,
        y: outer.reduce((sum, p) => sum + p.y, 0) / outer.length,
      }
      return !inClearing(centre, clearings) && !outer.some((p) => inClearing(p, clearings))
    })
    .map((mass) =>
      heightScale === 1
        ? mass
        : {
            ...mass,
            h: Math.max(1, mass.h * heightScale),
            prominence: mass.prominence * heightScale,
          },
    )
}

/** The blocks outside every clearing (a block's half-size counts), at `heightScale`. */
export function softenBlocks(
  file: Blocks,
  clearings: readonly PlotClearing[],
  heightScale: number,
): Blocks {
  const margin = file.sizeM / 2
  return {
    ...file,
    groups: file.groups.flatMap((group) => {
      const p: number[] = []
      const h: number[] = []
      group.h.forEach((height, i) => {
        const x = group.p[i * 2] ?? 0
        const y = group.p[i * 2 + 1] ?? 0
        if (inClearing({ x, y }, clearings, margin)) return
        p.push(x, y)
        h.push(Math.max(1, Math.round(height * heightScale)))
      })
      return h.length === 0 ? [] : [{ ...group, p, h }]
    }),
  }
}

export interface BuildingsLayer {
  readonly group: Group
  /** The city is on screen: loading may begin. */
  start(): void
  /** Applies the camera: draw distances, district visibility, loads, block culling. */
  setView(camera: Camera): void
  setDensity(density: number): void
  setDistanceScale(scale: number): void
  view(): BuildingsLayerView
  dispose(): void
}

interface DistrictEntry {
  status: DistrictStatus
  mesh: Mesh | null
  built: DistrictGeometry | null
}

const _world = new Vector3()

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as unknown
}

export function createBuildingsLayer(input: BuildingsLayerOptions): BuildingsLayer {
  const style = input.styleColors ?? {}
  const options: BuildingsLayerOptions = {
    ...input,
    districtColors: {
      ...input.districtColors,
      ...(style.walls === undefined ? {} : { walls: style.walls.map(worldHex) }),
      ...(style.roof === undefined ? {} : { roof: worldHex(style.roof) }),
    },
    blockColors: {
      ...input.blockColors,
      ...(style.blocks === undefined ? {} : { blocks: style.blocks.map(worldHex) }),
    },
  }
  const fetchJson = options.fetchJson ?? defaultFetchJson
  const group = new Group()
  group.name = 'buildings'
  const entries = new Map<string, DistrictEntry>(
    options.assets.districts.map((d) => [d.id, { status: 'idle', mesh: null, built: null }]),
  )
  let blocks: BlocksObjects | null = null
  let blocksStatus: DistrictStatus = 'idle'
  let started = false
  let disposed = false
  let density = 1
  let scale = 1
  let camera: Camera | null = null
  let busy = 0
  const queue: string[] = []
  let pumping = false
  const heightScale = options.heightScale ?? 1
  const clearings =
    options.plots === undefined
      ? []
      : [
          ...plotClearings(
            planPlots(plotPlaces(options.plots.pins, homePoints()), plotsJson as PlotsConfig),
            plotsJson as PlotsConfig,
          ),
          ...options.plots.pins.flatMap((pin) =>
            pin.game === undefined ? [] : [{ x: pin.x, y: pin.y, half: pin.game.clearM }],
          ),
        ]
  let plots: PlotsLayer | null = null

  const ranges = () => drawDistances(options.config, scale)

  const viewPoint = (): ViewPoint | null => {
    if (camera === null) return null
    camera.getWorldPosition(_world)
    const local = toLocal(_world)
    return { x: local.x, y: local.y, altitude: Math.max(0, _world.y - options.groundY) }
  }

  const applyDensity = (entry: DistrictEntry) => {
    if (entry.built === null || entry.mesh === null) return
    entry.mesh.geometry.setDrawRange(0, drawnAt(entry.built, density).index)
  }

  const applyView = () => {
    const point = viewPoint()
    if (point === null || camera === null) return
    const { districts: districtRange, blocks: blockRange } = ranges()
    for (const asset of options.assets.districts) {
      const entry = entries.get(asset.id)
      if (entry === undefined) continue
      const distance = distanceToDistrict(point, asset)
      if (entry.mesh !== null) entry.mesh.visible = distance <= districtRange
      if (
        started &&
        entry.status === 'idle' &&
        distance <= districtRange + options.config.loadMarginM
      ) {
        entry.status = 'loading'
        queue.push(asset.id)
      }
    }
    queue.sort((a, b) => {
      const da = options.assets.districts.find((d) => d.id === a)
      const db = options.assets.districts.find((d) => d.id === b)
      return (da ? distanceToDistrict(point, da) : 0) - (db ? distanceToDistrict(point, db) : 0)
    })
    blocks?.cull(camera, blockRange, (options.blockFill ?? NO_FILL).treeViewM * scale)
    void pump()
  }

  const fail = (url: string, error: unknown) =>
    options.onError(url, error instanceof Error ? error.message : String(error))

  async function loadBlocks(): Promise<void> {
    blocksStatus = 'loading'
    busy++
    try {
      const parsed = BlocksMiniSchema.safeParse(await fetchJson(options.assets.blocksUrl))
      if (!parsed.success) throw new Error('invalid blocks file')
      if (disposed) return
      const file = softenBlocks(parsed.data, clearings, heightScale)
      const built = buildBlocks(
        file,
        options.groundY,
        options.blockColors,
        options.dimmedBoroughs,
        { normal: options.materials.blocks, dimmed: options.materials.blocksDimmed },
        options.blockFill,
      )
      await options.prepare(built.group)
      if (disposed) {
        built.dispose()
        return
      }
      blocks = built
      blocksStatus = 'ready'
      group.add(built.group)
      applyView()
      options.onChange()
      // Apart from the build: a listener's failure is reported, but the blocks stay drawn.
      try {
        options.onBlocksReady?.(file)
      } catch (error) {
        fail(options.assets.blocksUrl, error)
      }
    } catch (error) {
      blocksStatus = 'failed'
      fail(options.assets.blocksUrl, error)
    } finally {
      busy--
    }
  }

  async function loadDistrict(id: string): Promise<void> {
    const asset = options.assets.districts.find((d) => d.id === id)
    const entry = entries.get(id)
    if (asset === undefined || entry === undefined) return
    busy++
    let ready: readonly DistrictMass[] | null = null
    try {
      const parsed = DistrictBuildingsMiniSchema.safeParse(await fetchJson(asset.url))
      if (!parsed.success || parsed.data.district !== id) throw new Error('invalid district file')
      if (disposed) return
      const step = createSlicer(options.config.buildSliceMs, options.yieldFn)
      const masses = softenMasses(districtMasses(parsed.data), clearings, heightScale)
      const built = await buildDistrictGeometry(
        masses,
        options.groundY,
        options.districtColors,
        step,
      )
      if (disposed) {
        built.geometry.dispose()
        return
      }
      const mesh = new Mesh(built.geometry, options.materials.district)
      mesh.name = `district-${id}`
      mesh.raycast = () => {}
      mesh.matrixAutoUpdate = false
      entry.built = built
      entry.mesh = mesh
      applyDensity(entry)
      await options.prepare(mesh)
      if (disposed) return
      entry.status = 'ready'
      group.add(mesh)
      applyView()
      options.onChange()
      ready = masses
    } catch (error) {
      entry.status = 'failed'
      fail(asset.url, error)
    } finally {
      busy--
    }
    // Apart from the build: a listener's failure is reported, but the district stays drawn.
    if (ready !== null) {
      try {
        options.onDistrictReady?.(id, ready)
      } catch (error) {
        fail(asset.url, error)
      }
    }
  }

  /** The place plots' chunk (S04m), once: never on the playable path. */
  function loadPlots(): void {
    const settings = options.plots
    if (settings === undefined) return
    import('../plots/layer')
      .then(({ createPlotsLayer }) => {
        if (disposed) return
        plots = createPlotsLayer({
          assets: options.assets.plots,
          pins: settings.pins,
          tier: options.assets.tier,
          groundY: options.groundY,
          material: options.materials.district,
          mask: settings.mask,
          windowTileCells: options.config.windowTileCells,
          buildSliceMs: options.config.buildSliceMs,
          cacheMaxEntries: settings.cacheMaxEntries,
          prepare: options.prepare,
          onChange: options.onChange,
          ...(options.yieldFn === undefined ? {} : { yieldFn: options.yieldFn }),
        })
        group.add(plots.group)
      })
      .catch((error: unknown) =>
        log.info('venue plots: chunk not loaded', {
          reason: error instanceof Error ? error.message : String(error),
        }),
      )
  }

  /** Loads queued districts one at a time, nearest first. */
  async function pump(): Promise<void> {
    if (pumping) return
    pumping = true
    try {
      while (!disposed && queue.length > 0) {
        const id = queue.shift()
        if (id !== undefined) await loadDistrict(id)
      }
    } finally {
      pumping = false
    }
  }

  return {
    group,
    start() {
      if (started || disposed) return
      started = true
      void loadBlocks()
      loadPlots()
      applyView()
    },
    setView(next) {
      camera = next
      applyView()
    },
    setDensity(next) {
      density = next
      for (const entry of entries.values()) applyDensity(entry)
      options.onChange()
    },
    setDistanceScale(next) {
      scale = next
      applyView()
      options.onChange()
    },
    view() {
      const blockView = blocks?.view()
      return {
        tier: options.assets.tier,
        started,
        busy: busy > 0 || queue.length > 0,
        density,
        drawDistances: ranges(),
        districts: options.assets.districts.map((asset) => {
          const entry = entries.get(asset.id)
          const drawn = entry?.built ? drawnAt(entry.built, density) : null
          return {
            id: asset.id,
            status: entry?.status ?? 'idle',
            visible: entry?.mesh?.visible === true && entry.status === 'ready',
            masses: entry?.built?.masses ?? 0,
            drawnMasses: entry?.built ? massesFor(density, entry.built.masses) : 0,
            triangles: drawn?.triangles ?? 0,
          }
        }),
        blocks: {
          status: blocksStatus,
          total: blockView?.total ?? 0,
          drawn: blockView?.drawn ?? 0,
          triangles: blockView?.triangles ?? 0,
          lots: blockView?.lots ?? 0,
          plates: blockView?.plates ?? 0,
          trees: blockView?.trees ?? 0,
        },
        plots: plots?.view() ?? null,
      }
    },
    dispose() {
      disposed = true
      queue.length = 0
      plots?.dispose()
      for (const entry of entries.values()) {
        entry.mesh?.geometry.dispose()
        entry.mesh?.removeFromParent()
      }
      blocks?.dispose()
      blocks?.group.removeFromParent()
      group.removeFromParent()
    },
  }
}
