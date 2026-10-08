/**
 * The living city's three.js side (S04l, DEC-52): ambient traffic, pedestrians and subway trains
 * drawn as colour-bucket InstancedMeshes. Positions come from the pure sim
 * (src/lib/world/ambient/), a function of the seed and the city clock; this layer culls them to
 * the camera, keeps the nearest within the tier's perf.json `ambient` caps and writes matrices.
 * three only, no React (AmbientLife.tsx drives it).
 *
 * Zero new shader programs: every mesh draws with a fresh material made exactly as the blocks'
 * (`createBuildingMaterial({ gradientMap, colors: 'instance' })`: instanced toon with
 * instanceColor, no vertex colours, no patch), so three reuses the program the blocks already
 * compiled on every tier. All bucket meshes of one kit share one instanceMatrix attribute.
 * Nothing here is pickable, casts a shadow, or is ever counted as a player (UX-3).
 */
import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Frustum,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Sphere,
  Vector3,
  type BufferGeometry,
  type Camera,
  type Material,
  type Object3D,
  type Texture,
} from 'three'
import { decodeStreets } from '@/lib/world/streetProps'
import { densityShare } from '@/lib/world/ambient/density'
import { buildStreetGraph } from '@/lib/world/ambient/graph'
import { createPedestrianSim, type PedestrianSim } from '@/lib/world/ambient/pedestrians'
import { selectDrawn, type DrawCandidates } from '@/lib/world/ambient/select'
import { buildTrainRuns, trainCarsAt, type TrainRun } from '@/lib/world/ambient/trains'
import {
  createPose,
  type AmbientConfig,
  type AmbientPose,
  type AmbientTier,
  type Circle,
  type PedestrianAnchor,
  type TrainLine,
  type TrainStation,
} from '@/lib/world/ambient/types'
import { createVehicleSim, type VehicleSim } from '@/lib/world/ambient/vehicles'
import { createBuildingMaterial } from '../buildings/materials'
import type { StreetsMini } from '../props/schema'
import type { ScenePedestrianKit } from './pedestrianKits'
import type { SceneVehicleKit } from './vehicleKits'

/** perf.json `ambient` caps of one tier. */
export interface AmbientCaps {
  readonly vehicle: number
  readonly bus: number
  readonly pedestrian: number
  readonly trainCar: number
  readonly triangles: number
  readonly drawCalls: number
}

export type AmbientStatus = 'loading' | 'ready' | 'failed'

/** What one update drew. */
export interface AmbientDrawn {
  readonly vehicles: number
  readonly buses: number
  readonly pedestrians: number
  readonly trainCars: number
}

export interface AmbientView {
  /** Trains draw as soon as the layer exists; `ready` once streets and kits joined them. */
  readonly status: AmbientStatus
  readonly drawn: AmbientDrawn
  readonly triangles: number
  readonly drawCalls: number
  /** Drawn instances inside a memorial clearance (always 0). */
  readonly inMemorialClearance: number
  /** A hash of every drawn position (two loads at one clock draw the same). */
  readonly positionsHash: string
  /** Updates run so far. */
  readonly updates: number
}

export interface AmbientLayerOptions {
  readonly tier: AmbientTier
  readonly config: AmbientConfig
  readonly caps: AmbientCaps
  readonly gradientMap: Texture
  readonly groundY: number
  /** Height trains run at (the subway ribbons'). */
  readonly trainY: number
  /** Train car size at a camera distance (the trip train's scaling, never below real size). */
  readonly trainCarSize: (distance: number, out: Vector3) => Vector3
  readonly lines: readonly TrainLine[]
  readonly stations: readonly TrainStation[]
  readonly anchors: readonly PedestrianAnchor[]
  /** Memorial pins: trains keep `trains.lookOnlyMarginM`, pedestrians `lookOnlyMarginM` + r. */
  readonly memorials: readonly Circle[]
  readonly streets: () => Promise<StreetsMini>
  readonly vehicleKits: () => Promise<readonly SceneVehicleKit[]>
  readonly pedestrianKits: () => Promise<readonly ScenePedestrianKit[]>
  /** Compiles an object's shaders before it is first drawn (renderer.compileAsync). */
  readonly prepare: (object: Object3D) => Promise<void>
  /** Something new can be drawn (kits arrived): request a frame. */
  readonly onChange: () => void
  /** A load failed (expected offline: the streets and models are never precached). */
  readonly onFailure?: (reason: string) => void
}

export interface AmbientUpdate {
  /** City time, seconds. */
  readonly tS: number
  readonly camera: Camera
  /** Camera distance to its target, and the target in local metres. */
  readonly distance: number
  readonly targetX: number
  readonly targetY: number
  /** Density step-down level (quality store `ambientSteps`) and night blend 0..1. */
  readonly level: number
  readonly night: number
}

export interface AmbientLayer {
  readonly group: Group
  /** The material every ambient mesh draws with. */
  readonly material: Material
  update(input: AmbientUpdate): AmbientView
  view(): AmbientView
  meshes(): readonly InstancedMesh[]
  dispose(): void
}

/** The ambient meshes ignore the raycaster: nothing ambient is ever picked. */
const noRaycast: Object3D['raycast'] = () => {}

/** Bucket meshes of one kit sharing one matrix attribute. */
interface KitMeshes {
  readonly meshes: readonly InstancedMesh[]
  /** Indices of the meshes whose colour is the instance's (paint, skin, top, bottom). */
  readonly recolour: readonly { readonly mesh: InstancedMesh; readonly bucket: string }[]
  readonly matrices: InstancedBufferAttribute
  readonly capacity: number
  readonly triangles: number
  count: number
}

function kitMeshes(
  name: string,
  parts: readonly {
    readonly bucket: string
    readonly geometry: BufferGeometry
    readonly color: string
  }[],
  capacity: number,
  material: Material,
  recoloured: ReadonlySet<string>,
  triangles: number,
): KitMeshes {
  const matrices = new InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * 16), 16)
  matrices.setUsage(DynamicDrawUsage)
  const color = new Color()
  const meshes: InstancedMesh[] = []
  const recolour: { mesh: InstancedMesh; bucket: string }[] = []
  for (const part of parts) {
    const mesh = new InstancedMesh(part.geometry, material, Math.max(1, capacity))
    mesh.name = `ambient-${name}-${part.bucket}`
    mesh.instanceMatrix = matrices
    const colors = new Float32Array(Math.max(1, capacity) * 3)
    color.set(part.color)
    for (let i = 0; i < Math.max(1, capacity); i++) color.toArray(colors, i * 3)
    mesh.instanceColor = new InstancedBufferAttribute(colors, 3)
    if (recoloured.has(part.bucket)) {
      mesh.instanceColor.setUsage(DynamicDrawUsage)
      recolour.push({ mesh, bucket: part.bucket })
    }
    // Culled per instance below; three's per-mesh test would use stale bounds.
    mesh.frustumCulled = false
    mesh.matrixAutoUpdate = false
    mesh.raycast = noRaycast
    mesh.count = 0
    mesh.visible = false
    meshes.push(mesh)
  }
  return { meshes, recolour, matrices, capacity, triangles, count: 0 }
}

const EMPTY_DRAWN: AmbientDrawn = { vehicles: 0, buses: 0, pedestrians: 0, trainCars: 0 }

export function createAmbientLayer(options: AmbientLayerOptions): AmbientLayer {
  const { config, caps, tier, groundY } = options
  const group = new Group()
  group.name = 'ambient-life'
  const material = createBuildingMaterial({ gradientMap: options.gradientMap, colors: 'instance' })
  let disposed = false
  let status: AmbientStatus = 'loading'
  let updates = 0
  let last: AmbientView = {
    status,
    drawn: EMPTY_DRAWN,
    triangles: 0,
    drawCalls: 0,
    inMemorialClearance: 0,
    positionsHash: '0',
    updates: 0,
  }

  // ---- trains: one mesh of the trip train's box, line colour per instance --------------------
  const box = new BoxGeometry(1, 1, 1)
  box.translate(0, 0.5, 0)
  const trainRuns: TrainRun[] = buildTrainRuns(options.lines, options.stations, config)
  const carsPerTrain = config.trains.cars[tier]
  const trainMesh = kitMeshes(
    'train',
    [{ bucket: 'line', geometry: box, color: options.lines[0]?.color ?? 'gray' }],
    caps.trainCar,
    material,
    new Set(['line']),
    12,
  )
  const trainLineColor = trainRuns.map((run) => new Color(run.color))
  const trainPoses: AmbientPose[] = []
  for (let i = 0; i < trainRuns.length * carsPerTrain; i++) trainPoses.push(createPose())
  const trainMemorials = options.memorials.map((m) => ({ x: m.x, y: m.y }))
  for (const mesh of trainMesh.meshes) group.add(mesh)

  // ---- vehicles and pedestrians: after the streets and the kits -----------------------------
  let vehicleSim: VehicleSim | null = null
  let pedestrianSim: PedestrianSim | null = null
  let vehicleKits: readonly SceneVehicleKit[] = []
  let pedestrianKits: readonly ScenePedestrianKit[] = []
  let vehicleMeshes: KitMeshes[] = []
  let pedestrianMeshes: KitMeshes[] = []
  const paint = config.vehicles.paint.map((hex) => new Color(hex))
  const palette = config.pedestrians.palette
  const skins = palette.skin.map((hex) => new Color(hex))
  const tops = palette.tops.map((hex) => new Color(hex))
  const bottoms = palette.bottoms.map((hex) => new Color(hex))

  async function load(): Promise<void> {
    try {
      const [streets, vKits, pKits] = await Promise.all([
        options.streets(),
        options.vehicleKits().catch((error: unknown) => {
          options.onFailure?.(
            `vehicle kits: ${error instanceof Error ? error.message : String(error)}`,
          )
          return [] as SceneVehicleKit[]
        }),
        options.pedestrianKits().catch((error: unknown) => {
          options.onFailure?.(
            `pedestrian kits: ${error instanceof Error ? error.message : String(error)}`,
          )
          return [] as ScenePedestrianKit[]
        }),
      ])
      if (disposed) {
        for (const kit of [...vKits, ...pKits]) kit.dispose()
        return
      }
      const data = decodeStreets(streets, config.seed)
      const pedestrianAvoid = [
        ...data.clear.map((c) => ({ x: c.x, y: c.y, r: c.r + config.pedestrians.lookOnlyMarginM })),
        ...options.memorials.map((m) => ({
          x: m.x,
          y: m.y,
          r: m.r + config.pedestrians.lookOnlyMarginM,
        })),
      ]
      const graph = buildStreetGraph(data, {
        seed: config.seed,
        cellM: config.cellM,
        lights: config.lights,
        vehicleAvoid: [...data.clear, ...options.memorials],
        pedestrianAvoid,
      })
      // The draw-call cap: trains first, then vehicle kits, then pedestrian kits, each kit
      // taking one call per bucket while they still fit.
      let calls = trainMesh.meshes.length
      const keptVehicles: SceneVehicleKit[] = []
      for (const kit of vKits) {
        const capacity = kit.kind === 'bus' ? caps.bus : caps.vehicle
        if (capacity === 0 || calls + kit.parts.length > caps.drawCalls) {
          kit.dispose()
          continue
        }
        calls += kit.parts.length
        keptVehicles.push(kit)
      }
      const keptPedestrians: ScenePedestrianKit[] = []
      for (const kit of pKits) {
        if (caps.pedestrian === 0 || calls + kit.parts.length > caps.drawCalls) {
          kit.dispose()
          continue
        }
        calls += kit.parts.length
        keptPedestrians.push(kit)
      }
      vehicleKits = keptVehicles
      pedestrianKits = keptPedestrians
      vehicleMeshes = keptVehicles.map((kit) =>
        kitMeshes(
          kit.id,
          kit.parts,
          kit.kind === 'bus' ? caps.bus : caps.vehicle,
          material,
          new Set(kit.kind === 'taxi' ? [] : ['paint']),
          kit.triangles,
        ),
      )
      pedestrianMeshes = keptPedestrians.map((kit) =>
        kitMeshes(
          kit.id,
          kit.parts,
          caps.pedestrian,
          material,
          new Set(['skin', 'top', 'bottom']),
          kit.triangles,
        ),
      )
      if (keptVehicles.length > 0) {
        vehicleSim = createVehicleSim({
          graph,
          config,
          tier,
          models: keptVehicles.map((kit) => ({ kind: kit.kind, lengthM: kit.lengthM })),
        })
      }
      if (keptPedestrians.length > 0) {
        pedestrianSim = createPedestrianSim({
          graph,
          config,
          tier,
          anchors: options.anchors,
          avoid: pedestrianAvoid,
          kits: keptPedestrians.length,
        })
      }
      const added = [...vehicleMeshes, ...pedestrianMeshes].flatMap((kit) => kit.meshes)
      for (const mesh of added) group.add(mesh)
      // Shares the blocks' program: compiling is a cache hit, but it also uploads buffers.
      for (const mesh of added.slice(0, 1)) await options.prepare(mesh)
      if (disposed) return
      status = 'ready'
      options.onChange()
    } catch (error) {
      status = 'failed'
      options.onFailure?.(error instanceof Error ? error.message : String(error))
    }
  }
  void load()

  // ---- per update scratch (no allocation per tick) ------------------------------------------
  const frustum = new Frustum()
  const projection = new Matrix4()
  const sphere = new Sphere()
  const cameraPosition = new Vector3()
  const matrix = new Matrix4()
  const position = new Vector3()
  const scale = new Vector3()
  const quaternion = new Quaternion()
  const up = new Vector3(0, 1, 0)
  const carSize = new Vector3()
  const picked = new Int32Array(Math.max(caps.trainCar, caps.vehicle, caps.bus, caps.pedestrian, 1))

  /** Candidate list for one kind: squared distance and visibility per index. */
  const makeCandidates = () => {
    const state = { count: 0, dist: new Float64Array(64), vis: new Uint8Array(64) }
    const grow = (n: number) => {
      if (n <= state.dist.length) return
      const size = Math.max(n, state.dist.length * 2)
      state.dist = new Float64Array(size)
      state.vis = new Uint8Array(size)
    }
    const candidates: DrawCandidates = {
      get count() {
        return state.count
      },
      distanceSq: (i) => state.dist[i] ?? Infinity,
      visible: (i) => state.vis[i] === 1,
    }
    return { state, grow, candidates }
  }
  const trainList = makeCandidates()
  const vehicleList = makeCandidates()
  const pedestrianList = makeCandidates()

  /** Squared camera distance of (x, groundY + lift, -y) when its sphere is in view, else -1. */
  const cull = (x: number, y: number, lift: number, radius: number): number => {
    sphere.center.set(x, lift, -y)
    sphere.radius = radius
    if (!frustum.intersectsSphere(sphere)) return -1
    return sphere.center.distanceToSquared(cameraPosition)
  }

  const writeMatrix = (
    kit: KitMeshes,
    slot: number,
    pose: AmbientPose,
    y: number,
    sx: number,
    sy: number,
    sz: number,
  ) => {
    position.set(pose.x, y, -pose.y)
    quaternion.setFromAxisAngle(up, pose.yaw)
    scale.set(sx, sy, sz)
    matrix.compose(position, quaternion, scale)
    matrix.toArray(kit.matrices.array, slot * 16)
  }

  const setColor = (kit: KitMeshes, bucket: string, slot: number, color: Color | undefined) => {
    if (color === undefined) return
    for (const entry of kit.recolour) {
      if (entry.bucket === bucket && entry.mesh.instanceColor) {
        color.toArray(entry.mesh.instanceColor.array, slot * 3)
      }
    }
  }

  const finish = (kit: KitMeshes) => {
    for (const mesh of kit.meshes) {
      mesh.count = kit.count
      mesh.visible = kit.count > 0
    }
    if (kit.count > 0) {
      kit.matrices.needsUpdate = true
      for (const entry of kit.recolour) {
        if (entry.mesh.instanceColor) entry.mesh.instanceColor.needsUpdate = true
      }
    }
  }

  const memorialHits = (x: number, y: number, margin: number) => {
    for (const m of options.memorials) if (Math.hypot(x - m.x, y - m.y) < m.r + margin) return 1
    return 0
  }

  function update(input: AmbientUpdate): AmbientView {
    updates++
    const { camera, distance, tS } = input
    camera.updateMatrixWorld()
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    frustum.setFromProjectionMatrix(projection)
    camera.getWorldPosition(cameraPosition)
    let hash = 2166136261
    const mix = (v: number) => {
      hash = Math.imul(hash ^ (Math.round(v * 10) | 0), 16777619) >>> 0
    }
    let triangles = 0
    let inMemorial = 0
    const share = densityShare(config.density, input.level, input.night)

    // Trains: every zoom, nearest in view first.
    options.trainCarSize(distance, carSize)
    const tl = trainList
    tl.grow(trainPoses.length)
    tl.state.count = trainPoses.length
    for (let r = 0; r < trainRuns.length; r++) {
      const run = trainRuns[r]
      if (run === undefined) continue
      const base = r * carsPerTrain
      trainCarsAt(run, carsPerTrain, carSize.z, tS, config.trains, trainMemorials, trainPoses, base)
      for (let c = 0; c < carsPerTrain; c++) {
        const pose = trainPoses[base + c]
        const i = base + c
        const d =
          pose === undefined || pose.alpha === 0
            ? -1
            : cull(pose.x, pose.y, options.trainY + carSize.y / 2, carSize.z / 2)
        tl.state.vis[i] = d >= 0 ? 1 : 0
        tl.state.dist[i] = d
      }
    }
    const trainBudget = Math.min(caps.trainCar, Math.floor(caps.triangles / trainMesh.triangles))
    const trainCount = selectDrawn(tl.candidates, trainBudget, picked)
    for (let k = 0; k < trainCount; k++) {
      const i = picked[k] ?? 0
      const pose = trainPoses[i]
      if (pose === undefined) continue
      writeMatrix(
        trainMesh,
        k,
        pose,
        options.trainY,
        carSize.x * pose.scale,
        carSize.y * pose.scale,
        carSize.z * pose.scale,
      )
      setColor(trainMesh, 'line', k, trainLineColor[Math.floor(i / carsPerTrain)])
      inMemorial += memorialHits(pose.x, pose.y, config.trains.lookOnlyMarginM)
      mix(pose.x)
      mix(pose.y)
    }
    trainMesh.count = trainCount
    finish(trainMesh)
    triangles += trainCount * trainMesh.triangles

    // Vehicles: within `showBelowDistanceM`, around the camera target.
    let vehicles = 0
    let buses = 0
    for (const kit of vehicleMeshes) kit.count = 0
    const vehiclesShown = distance <= config.vehicles.showBelowDistanceM[tier]
    if (vehicleSim !== null && vehiclesShown) {
      const n = vehicleSim.collect(
        input.targetX,
        input.targetY,
        config.focusRadiusM[tier],
        tS,
        share,
      )
      const grow = Math.min(
        config.vehicles.scale.max,
        Math.max(1, distance * config.vehicles.scale.perDistance),
      )
      const vl = vehicleList
      vl.grow(n)
      for (const wantBus of [false, true]) {
        vl.state.count = n
        for (let i = 0; i < n; i++) {
          const v = vehicleSim.samples[i]
          const kit = v === undefined ? undefined : vehicleKits[v.model]
          const ok = v !== undefined && kit !== undefined && (v.kind === 'bus') === wantBus
          const d = ok ? cull(v.pose.x, v.pose.y, groundY, (kit.lengthM * grow) / 2 + 1) : -1
          vl.state.vis[i] = d >= 0 ? 1 : 0
          vl.state.dist[i] = d
        }
        const capKind = wantBus ? caps.bus : caps.vehicle
        const count = selectDrawn(vl.candidates, capKind, picked)
        for (let k = 0; k < count; k++) {
          const v = vehicleSim.samples[picked[k] ?? 0]
          if (v === undefined) continue
          const kit = vehicleMeshes[v.model]
          const vkit = vehicleKits[v.model]
          if (kit === undefined || vkit === undefined) continue
          if (triangles + kit.triangles > caps.triangles) break
          const slot = kit.count++
          const s = grow * v.pose.scale
          writeMatrix(kit, slot, v.pose, groundY, s, s, s)
          setColor(kit, 'paint', slot, paint[v.paint])
          triangles += kit.triangles
          inMemorial += memorialHits(v.pose.x, v.pose.y, 0)
          mix(v.pose.x)
          mix(v.pose.y)
          if (wantBus) buses++
          else vehicles++
        }
      }
    }
    for (const kit of vehicleMeshes) finish(kit)

    // Pedestrians: closer still, near their anchors.
    let pedestrians = 0
    for (const kit of pedestrianMeshes) kit.count = 0
    if (pedestrianSim !== null && distance <= config.pedestrians.showBelowDistanceM[tier]) {
      const n = pedestrianSim.collect(
        input.targetX,
        input.targetY,
        config.focusRadiusM[tier],
        tS,
        share,
      )
      const grow = Math.min(
        config.pedestrians.scale.max,
        Math.max(1, distance * config.pedestrians.scale.perDistance),
      )
      const pl = pedestrianList
      pl.grow(n)
      pl.state.count = n
      for (let i = 0; i < n; i++) {
        const p = pedestrianSim.samples[i]
        const d = p === undefined ? -1 : cull(p.pose.x, p.pose.y, groundY + 1, 1.5 * grow)
        pl.state.vis[i] = d >= 0 ? 1 : 0
        pl.state.dist[i] = d
      }
      const count = selectDrawn(pl.candidates, caps.pedestrian, picked)
      for (let k = 0; k < count; k++) {
        const p = pedestrianSim.samples[picked[k] ?? 0]
        if (p === undefined) continue
        const kit = pedestrianMeshes[p.kit]
        if (kit === undefined) continue
        if (triangles + kit.triangles > caps.triangles) break
        const slot = kit.count++
        const s = grow * p.pose.scale
        writeMatrix(kit, slot, p.pose, groundY + p.pose.lift * grow, s, s, s)
        setColor(kit, 'skin', slot, skins[p.skin])
        setColor(kit, 'top', slot, tops[p.top])
        setColor(kit, 'bottom', slot, bottoms[p.bottom])
        triangles += kit.triangles
        inMemorial += memorialHits(p.pose.x, p.pose.y, config.pedestrians.lookOnlyMarginM)
        mix(p.pose.x)
        mix(p.pose.y)
        pedestrians++
      }
    }
    for (const kit of pedestrianMeshes) finish(kit)

    let drawCalls = 0
    for (const kit of [trainMesh, ...vehicleMeshes, ...pedestrianMeshes]) {
      if (kit.count > 0) drawCalls += kit.meshes.length
    }
    last = {
      status,
      drawn: { vehicles, buses, pedestrians, trainCars: trainCount },
      triangles,
      drawCalls,
      inMemorialClearance: inMemorial,
      positionsHash: hash.toString(16),
      updates,
    }
    return last
  }

  return {
    group,
    material,
    update,
    view: () => ({ ...last, status, updates }),
    meshes: () => [trainMesh, ...vehicleMeshes, ...pedestrianMeshes].flatMap((kit) => kit.meshes),
    dispose() {
      disposed = true
      group.removeFromParent()
      for (const kit of [trainMesh, ...vehicleMeshes, ...pedestrianMeshes]) {
        for (const mesh of kit.meshes) mesh.dispose()
      }
      box.dispose()
      for (const kit of [...vehicleKits, ...pedestrianKits]) kit.dispose()
      material.dispose()
    },
  }
}
