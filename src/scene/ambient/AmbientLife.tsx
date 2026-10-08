'use client'

/**
 * The living city (S04l, DEC-52): ambient traffic, pedestrians and subway trains, loaded lazily
 * once the city is playable (CityCanvas mounts it after `cityReady`, like the trip animation),
 * so none of it is on the path to playable or in the precache.
 *
 * The map keeps `frameloop="demand"`. While the city is alive this chunk's own ticker requests a
 * frame at most `fpsCap` times a second, and only while something ambient is in view; every
 * rendered frame (the ticker's, a gesture's or a flight's) moves the sim to the city clock and
 * rewrites the matrices before it draws. The ticker stops, and the step-down's continuous window
 * closes, while the tab is hidden, the apartment or creator has the screen, or the WebGL context
 * is lost: the map renders nothing then. Under reduced motion the city is drawn once, frozen at
 * the clock it mounted with, and the map renders on demand only. On return the sim jumps to the
 * current clock (positions are a pure function of it).
 *
 * The FPS step-down lowers ambient density before it drops a tier: this chunk registers the
 * density levels and its own FPS floor with the quality store.
 *
 * The townsfolk (S04o, townsfolk.ts) live here too: Sims-like locals at the player's size around
 * the places, on the same material, ticker and pauses. A tap on one claims the map tap
 * (src/scene/pins/mapTaps.ts) and opens their card (src/state/townsfolk.ts, TownsfolkCard.tsx).
 */
import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { InstancedMesh, Mesh, type Material, type Object3D, type WebGLRenderer } from 'three'
import ambientJson from '@data/config/ambient.json'
import perfJson from '@data/config/perf.json'
import type { GeoBase } from '../geo/schema'
import { decodePath } from '@/lib/geo/codec'
import { log } from '@/lib/log'
import { useReducedMotion } from '@/lib/useReducedMotion'
import { densityShare, maxDensityLevel } from '@/lib/world/ambient/density'
import type { TownsfolkVenue } from '@/lib/world/ambient/townsfolk'
import type {
  AmbientConfig,
  AmbientTier,
  Circle,
  PedestrianAnchor,
  TrainLine,
} from '@/lib/world/ambient/types'
import type { SceneConfig } from '@/lib/data/schemas/scene'
import type { AvatarConfig } from '../avatar/buildAvatar'
import { acquireModels } from '../models/runtime'
import { ambientSteps } from '../quality/ambientSteps'
import { beginContinuous, endContinuous } from '../quality/continuity'
import { claimMapTaps } from '../pins/mapTaps'
import { loadStreets } from '../streets/loadStreets'
import { selectLocal, townsfolkBridge, townsfolkStore } from '@/state/townsfolk'
import type { AmbientAssets, AmbientModelAsset } from './assets'
import { createAmbientLayer, type AmbientCaps, type AmbientLayer, type AmbientView } from './layer'
import {
  AMBIENT_TEST_KEY,
  ambientHook,
  type AmbientHookState,
  type AmbientMode,
  type AmbientPauseReason,
} from './registry'
import type { ScenePedestrianKit } from './pedestrianKits'
import { createTownsfolkLayer, type TownsfolkLayer, type TownsfolkView } from './townsfolk'
import { catalogVehicleKits, type AmbientModelLoader } from './vehicleKits'

const config = ambientJson as unknown as AmbientConfig

interface AmbientPerf {
  readonly instancesMax: Record<
    'vehicle' | 'bus' | 'pedestrian' | 'trainCar',
    Record<AmbientTier, number>
  >
  readonly trianglesMax: Record<AmbientTier, number>
  readonly drawCallsMax: Record<AmbientTier, number>
}

/** perf.json `ambient` for a tier (validated with perf.json by src/lib/data/data.test.ts). */
export function ambientCaps(tier: AmbientTier): AmbientCaps {
  const perf = (perfJson as unknown as { ambient: AmbientPerf }).ambient
  return {
    vehicle: perf.instancesMax.vehicle[tier],
    bus: perf.instancesMax.bus[tier],
    pedestrian: perf.instancesMax.pedestrian[tier],
    trainCar: perf.instancesMax.trainCar[tier],
    triangles: perf.trianglesMax[tier],
    drawCalls: perf.drawCallsMax[tier],
  }
}

/** A fixed clock for test builds that set no `cc:test:ambient`: specs stay deterministic. */
const TEST_FROZEN_MS = 1_760_000_000_000

/**
 * The clock mode: test-hook builds read `cc:test:ambient` (`live`, or `frozen:<ms>`; frozen at a
 * fixed clock when unset); otherwise live.
 */
function testClock(): { readonly live: boolean; readonly frozenMs: number } | null {
  if (process.env.NEXT_PUBLIC_TEST_HOOKS !== '1') return null
  let value: string | null = null
  try {
    value = window.localStorage.getItem(AMBIENT_TEST_KEY)
  } catch {
    value = null
  }
  if (value === 'live') return { live: true, frozenMs: 0 }
  const ms = value?.startsWith('frozen:') ? Number(value.slice('frozen:'.length)) : NaN
  return { live: false, frozenMs: Number.isFinite(ms) ? ms : TEST_FROZEN_MS }
}

export interface AmbientLifeProps {
  readonly assets: AmbientAssets
  readonly tier: AmbientTier
  readonly geo: Pick<GeoBase, 'subway' | 'places' | 'landmarks'>
  readonly subwayPalette: readonly string[]
  readonly homes: readonly { readonly x: number; readonly y: number }[]
  /**
   * Where the townsfolk hang out: the place pins as the map draws them (built.pins, so they
   * follow whatever layout the map style puts the places in).
   */
  readonly venues: readonly TownsfolkVenue[]
  /** The blocks' material recipe (createBuildingMaterial, instance colours): zero new programs. */
  readonly createMaterial: () => Material
  readonly groundY: number
  readonly config: Pick<SceneConfig, 'subway' | 'travel' | 'models'> & {
    readonly avatar: AvatarConfig
  }
  /** The apartment or creator has the screen. */
  readonly hidden: boolean
  /** The day/night rig's night blend, 0 (day) to 1 (night). */
  readonly night: number
}

export default function AmbientLife({
  assets,
  tier,
  geo,
  subwayPalette,
  homes,
  venues,
  createMaterial,
  groundY,
  config: scene,
  hidden,
  night,
}: AmbientLifeProps) {
  const gl = useThree((state) => state.gl)
  const sceneRoot = useThree((state) => state.scene)
  const invalidate = useThree((state) => state.invalidate)
  const get = useThree((state) => state.get)
  const reducedMotion = useReducedMotion()
  const [test] = useState(testClock)
  // Under reduced motion the city stays as it was when it mounted.
  const [mountedMs] = useState(() => Date.now())
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible',
  )
  const [contextLost, setContextLost] = useState(false)
  const materialRef = useRef(createMaterial)
  const levelRef = useRef(ambientSteps.get().steps)
  const nightRef = useRef(night)
  const viewRef = useRef<AmbientView | null>(null)
  const clockRef = useRef(0)
  const ticksRef = useRef(0)

  const frozen = test !== null ? !test.live : reducedMotion
  const frozenMs = test !== null ? test.frozenMs : mountedMs
  const pauseReason: AmbientPauseReason | null = !pageVisible
    ? 'hidden'
    : hidden
      ? 'focus'
      : contextLost
        ? 'context'
        : frozen
          ? test !== null
            ? 'test'
            : 'reduced-motion'
          : null
  const mode: AmbientMode = frozen ? 'frozen' : pauseReason === null ? 'live' : 'paused'
  const live = mode === 'live'

  const layerRef = useRef<AmbientLayer | null>(null)
  const townsfolkRef = useRef<TownsfolkLayer | null>(null)
  const townsfolkViewRef = useRef<TownsfolkView | null>(null)
  useEffect(() => {
    nightRef.current = night
    invalidate()
  }, [night, invalidate])
  useEffect(() => {
    materialRef.current = createMaterial
  }, [createMaterial])

  // The layer is created (and its loads start) in an effect, so a discarded render never leaks one.
  useEffect(() => {
    const colorById = trainLineColors(geo.subway.lines, subwayPalette)
    const lines: TrainLine[] = geo.subway.lines.map((line) => ({
      id: line.id,
      color: colorById.get(line.id) ?? subwayPalette[0] ?? 'gray',
      paths: line.paths.map((path) => decodePath(path)),
    }))
    const memorials: Circle[] = geo.places.pins
      .filter((pin) => pin.style === 'memorial')
      .map((pin) => ({ x: pin.x, y: pin.y, r: 0 }))
    const anchors: PedestrianAnchor[] = [
      ...geo.places.pins
        .filter((pin) => pin.style === 'normal')
        .map((pin) => ({
          id: pin.id,
          kind: pin.kind === 'venue' ? ('place' as const) : ('landmark' as const),
          x: pin.x,
          y: pin.y,
        })),
      ...homes.map((home, i) => ({ id: `home-${i}`, kind: 'home' as const, x: home.x, y: home.y })),
    ]
    const cacheMax = scene.models.cacheMaxEntries
    /** A loader over the tier's listed models; `release` drops every reference it took. */
    const loaderFor = (list: readonly AmbientModelAsset[]) => {
      const releases: (() => void)[] = []
      const loader: AmbientModelLoader = async (ids) => {
        const entries = ids.map((id) => {
          const entry = list.find((asset) => asset[0] === id)
          if (entry === undefined) throw new Error(`no ambient asset "${id}"`)
          const [, kind, file, slots] = entry
          return { id, kind, file, slots: slots === '' ? [] : slots.split(',') }
        })
        const acquired = acquireModels(
          entries.map((entry) => ({
            id: entry.id,
            kind: entry.kind,
            files: { low: entry.file, mid: entry.file, high: entry.file },
          })),
          tier,
          cacheMax,
        )
        releases.push(acquired.release)
        const models = await acquired.models
        return models.map((model, i) => ({
          ref: { id: entries[i]?.id ?? '', slots: entries[i]?.slots ?? [] },
          model,
        }))
      }
      return { loader, release: () => releases.forEach((release) => release()) }
    }
    const { travel, avatar } = scene
    const trains = config.trains
    // The pedestrians' and the townsfolk's kits, baked from one load of the character models.
    // The bakers (skeleton cloning, posing) load only when a tier draws characters.
    const characterKits = (async (): Promise<{
      pedestrians: ScenePedestrianKit[]
      townsfolk: ScenePedestrianKit[]
    }> => {
      if (assets.pedestrians.length === 0) return { pedestrians: [], townsfolk: [] }
      const { PEDESTRIAN_KIT_SOURCES, bakeTownsfolkKits } = await import('./pedestrianKits')
      const source = PEDESTRIAN_KIT_SOURCES[config.pedestrians.source]
      const { loader, release } = loaderFor(assets.pedestrians)
      try {
        const [pedestrians, townsfolk] = await Promise.all([
          source === undefined ? [] : source(tier, loader),
          bakeTownsfolkKits(tier, config.townsfolk, loader),
        ])
        return { pedestrians, townsfolk }
      } finally {
        release()
      }
    })()
    const created = createAmbientLayer({
      tier,
      config,
      caps: ambientCaps(tier),
      createMaterial: () => materialRef.current(),
      groundY,
      trainY: groundY + scene.subway.liftM,
      trainCarSize: (distance, out) => {
        // The trip train's size (src/scene/avatar/buildAvatar.ts avatarSize × travel ratios).
        const h = Math.min(
          avatar.maxHeightM,
          Math.max(avatar.minHeightM, distance * avatar.heightPerDistance),
        )
        return out.set(
          Math.max(trains.carWidthM, h * travel.vehicleWidthRatio),
          Math.max(trains.carHeightM, h * travel.vehicleHeightRatio),
          Math.max(trains.carLengthM, h * travel.trainLengthRatio),
        )
      },
      lines,
      stations: geo.subway.stations,
      anchors,
      memorials,
      streets: () => loadStreets(assets.streetsUrl),
      vehicleKits: async () => {
        const { loader, release } = loaderFor(assets.vehicles)
        try {
          return await catalogVehicleKits(config.vehicleKit)(
            tier,
            assets.vehicles.map((asset) => asset[0]),
            loader,
          )
        } finally {
          release()
        }
      },
      pedestrianKits: async () => (await characterKits).pedestrians,
      prepare: async (object) => {
        const { camera } = get()
        if (gl.extensions.has('KHR_parallel_shader_compile')) {
          await gl.compileAsync(object, camera, sceneRoot)
        }
      },
      onChange: () => invalidate(),
      onFailure: (reason) => {
        // Expected offline (streets and models are never precached): the city stays still.
        log.info('ambient life: not loaded', { reason })
      },
    })
    const townsfolk = createTownsfolkLayer({
      tier,
      config,
      material: created.material,
      groundY,
      venues,
      // The player's drawn height (src/scene/avatar/buildAvatar.ts avatarSize × playerScale),
      // repeated so this chunk does not pull the avatar builder in.
      playerHeight: (distance) =>
        Math.min(
          avatar.maxHeightM,
          Math.max(avatar.minHeightM, distance * avatar.heightPerDistance),
        ) * avatar.playerScale,
      kits: async () => (await characterKits).townsfolk,
      onChange: () => invalidate(),
      onFailure: (reason) => log.info('ambient life: not loaded', { reason }),
    })
    sceneRoot.add(created.group)
    sceneRoot.add(townsfolk.group)
    layerRef.current = created
    townsfolkRef.current = townsfolk
    invalidate()
    return () => {
      sceneRoot.remove(townsfolk.group)
      townsfolk.dispose()
      sceneRoot.remove(created.group)
      created.dispose()
      if (layerRef.current === created) layerRef.current = null
      if (townsfolkRef.current === townsfolk) townsfolkRef.current = null
      viewRef.current = null
      townsfolkViewRef.current = null
      selectLocal(null)
    }
  }, [
    assets,
    tier,
    geo,
    subwayPalette,
    homes,
    venues,
    groundY,
    scene,
    get,
    gl,
    sceneRoot,
    invalidate,
  ])

  // A tap on a local opens their card; a tap elsewhere on the map closes it (and goes on to the
  // pins). The card reaches the locals in view through the bridge.
  useEffect(() => {
    const off = claimMapTaps((x, y, width, height) => {
      const layer = townsfolkRef.current
      const id = layer?.pick(get().camera, x, y, width, height) ?? null
      const profile = id === null ? null : (layer?.profile(id) ?? null)
      selectLocal(profile)
      if (profile !== null) invalidate()
      return profile !== null
    })
    townsfolkBridge.current = {
      nearby: () => {
        const layer = townsfolkRef.current
        if (layer === null) return []
        return layer.drawnIds().flatMap((id) => {
          const profile = layer.profile(id)
          return profile === null ? [] : [profile]
        })
      },
      headAt: (id) => {
        const layer = townsfolkRef.current
        if (layer === null) return null
        const rect = gl.domElement.getBoundingClientRect()
        const head = layer.headOnScreen(id, get().camera, rect.width, rect.height)
        return head === null ? null : { x: head.x + rect.left, y: head.y + rect.top }
      },
    }
    return () => {
      off()
      townsfolkBridge.current = null
    }
  }, [get, gl, invalidate])

  // The map is covered (the apartment or creator) or the city paused hidden: no card over it.
  useEffect(() => {
    if (hidden && townsfolkStore.getState().selected !== null) selectLocal(null)
  }, [hidden])

  // Density levels and the ambient-only FPS floor for the step-down (density before tier).
  useEffect(() => {
    ambientSteps.register(maxDensityLevel(config.density), config.stepDown.belowFps[tier])
    const off = ambientSteps.subscribe(() => {
      const { steps } = ambientSteps.get()
      if (steps !== levelRef.current) {
        levelRef.current = steps
        invalidate()
      }
    })
    return () => {
      off()
      ambientSteps.register(0, null)
    }
  }, [tier, invalidate])

  useEffect(() => {
    const onVisibility = () => setPageVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVisibility)
    const canvas = gl.domElement
    const lost = () => setContextLost(true)
    const restored = () => setContextLost(false)
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', restored)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', restored)
    }
  }, [gl])

  const clockNow = () => (frozen ? frozenMs : Date.now())

  const updateNow = (): AmbientView | null => {
    const layer = layerRef.current
    if (layer === null) return null
    const { camera, controls } = get()
    const rig = controls as unknown as {
      getDistance?: () => number
      target?: { x: number; z: number }
    } | null
    const distance = rig?.getDistance?.() ?? camera.position.length()
    const target = rig?.target ?? { x: 0, z: 0 }
    const ms = clockNow()
    clockRef.current = ms
    viewRef.current = layer.update({
      tS: ms / 1000,
      camera,
      distance,
      targetX: target.x,
      targetY: -target.z,
      level: levelRef.current,
      night: nightRef.current,
    })
    // The locals stay out at night (the city is alive); only the FPS step-down thins them.
    townsfolkViewRef.current =
      townsfolkRef.current?.update({
        tS: ms / 1000,
        camera,
        distance,
        targetX: target.x,
        targetY: -target.z,
        share: densityShare(config.density, levelRef.current, 0),
      }) ?? null
    return viewRef.current
  }

  const updateRef = useRef(updateNow)
  useEffect(() => {
    updateRef.current = updateNow
  })

  // Every rendered frame draws the city at the clock (before the render: priority 0 is default).
  useFrame(() => {
    updateRef.current()
  })

  // The ticker: capped frames while something ambient is in view; a cheap check once a second
  // (no frame) while nothing is.
  useEffect(() => {
    if (!live) {
      endContinuous('ambient')
      // A frozen or paused city still shows where it stands (one frame, when the map is shown).
      if (pauseReason !== 'hidden' && pauseReason !== 'focus') invalidate()
      return
    }
    const minGap = 1000 / config.fpsCap[tier]
    let raf = 0
    let lastTick = 0
    let lastCheck = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const drawing =
        viewRef.current !== null && drawnTotal(viewRef.current, townsfolkViewRef.current) > 0
      if (drawing) {
        // Half a display frame of tolerance, so a 60 Hz display hits a 30 fps cap exactly.
        if (now - lastTick >= minGap - 8) {
          lastTick = now
          ticksRef.current++
          beginContinuous('ambient')
          invalidate()
        }
        return
      }
      endContinuous('ambient')
      if (now - lastCheck >= 1000) {
        lastCheck = now
        const view = updateRef.current()
        if (view !== null && drawnTotal(view, townsfolkViewRef.current) > 0) invalidate()
      }
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      endContinuous('ambient')
    }
  }, [live, pauseReason, tier, invalidate])

  // Test-hook builds: scene.ambient() (src/scene/testHooks.tsx).
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_TEST_HOOKS !== '1') return
    const townsfolkState = (): AmbientHookState['townsfolk'] => {
      const layer = townsfolkRef.current
      const view = townsfolkViewRef.current ?? layer?.view() ?? null
      if (layer === null || view === null) {
        return { status: 'off', drawn: 0, triangles: 0, drawCalls: 0, kitsDrawn: 0, points: [] }
      }
      const rect = gl.domElement.getBoundingClientRect()
      const points = layer
        .screenPoints(get().camera, rect.width, rect.height)
        .map((p) => ({ id: p.id, x: p.x + rect.left, y: p.y + rect.top }))
      return { ...view, points }
    }
    const read = (): AmbientHookState => {
      const layer = layerRef.current
      const view = viewRef.current ?? layer?.view() ?? null
      const meshes = [...(layer?.meshes() ?? []), ...(townsfolkRef.current?.meshes() ?? [])]
      if (layer === null || view === null) {
        return {
          status: 'loading',
          mode,
          pauseReason,
          clockMs: clockRef.current,
          densityLevel: ambientSteps.get().steps,
          drawn: { vehicles: 0, buses: 0, pedestrians: 0, trainCars: 0 },
          triangles: 0,
          drawCalls: 0,
          sameProgramAsBlocks: false,
          raycastOff: true,
          inMemorialClearance: 0,
          positionsHash: '0',
          ticks: ticksRef.current,
          townsfolk: townsfolkState(),
        }
      }
      return {
        status: view.status,
        mode,
        pauseReason,
        clockMs: clockRef.current,
        densityLevel: ambientSteps.get().steps,
        drawn: view.drawn,
        triangles: view.triangles,
        drawCalls: view.drawCalls,
        sameProgramAsBlocks: sameProgram(gl, sceneRoot, layer.material, meshes),
        raycastOff: meshes.every((mesh) => mesh.raycast !== Mesh.prototype.raycast),
        inMemorialClearance: view.inMemorialClearance,
        positionsHash: view.positionsHash,
        ticks: ticksRef.current,
        townsfolk: townsfolkState(),
      }
    }
    ambientHook.current = read
    return () => {
      if (ambientHook.current === read) ambientHook.current = null
    }
  }, [mode, pauseReason, gl, sceneRoot, get])

  return null
}

/**
 * Line id to its ribbon colour, as src/scene/geo/buildSubway.ts `lineColors` maps them (the
 * palette cycled over the sorted ids; AmbientLife.test.ts holds the two equal). Repeated so this
 * chunk does not pull the subway builder in.
 */
export function trainLineColors(
  lines: readonly { readonly id: string }[],
  palette: readonly string[],
): Map<string, string> {
  const ids = lines.map((line) => line.id).sort()
  return new Map(ids.map((id, index) => [id, palette[index % palette.length] ?? palette[0] ?? '']))
}

const drawnTotal = (view: AmbientView, townsfolk: TownsfolkView | null) =>
  view.drawn.vehicles +
  view.drawn.buses +
  view.drawn.pedestrians +
  view.drawn.trainCars +
  (townsfolk?.drawn ?? 0)

/** Whether the ambient material compiled to the very program the blocks draw with. */
function sameProgram(
  gl: WebGLRenderer,
  root: Object3D,
  material: Material,
  meshes: readonly InstancedMesh[],
): boolean {
  let blocks: Material | null = null
  root.traverse((object) => {
    if (blocks === null && object instanceof InstancedMesh && object.name.startsWith('blocks-')) {
      blocks = Array.isArray(object.material) ? (object.material[0] ?? null) : object.material
    }
  })
  if (blocks === null) return false
  const programOf = (m: Material) =>
    (gl.properties.get(m) as { currentProgram?: unknown }).currentProgram
  const ours = programOf(material)
  return (
    ours !== undefined &&
    ours === programOf(blocks) &&
    meshes.every((mesh) => mesh.material === material)
  )
}
