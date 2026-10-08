/**
 * The townsfolk's three.js side (S04o): the locals of src/lib/world/ambient/townsfolk.ts drawn at
 * the player's size (scene.json `avatar`: avatarSize × `playerScale` × `heightOfPlayer`), so they
 * read at the map's default view like the Sims-style crowds of a game map.
 *
 * Each kit (a body in one pose, baked rigid by pedestrianKits.ts) is one colour-bucket
 * InstancedMesh per bucket on the living city's own material (the blocks' program: zero new
 * shader programs), skin, top, bottom and hair recoloured per local. Only kits with a local in
 * view draw, so a tier pays 4 draw calls per pose and body it shows. Nothing here uses three's
 * raycast: a tap picks a local by its projected box on screen (`pick`), like the place pins.
 *
 * Locals are NPCs, never players (UX-3): no ring, no chip, never counted as "online".
 */
import {
  Color,
  Frustum,
  Group,
  Matrix4,
  Quaternion,
  Sphere,
  Vector3,
  type Camera,
  type InstancedMesh,
  type Material,
} from 'three'
import {
  createTownsfolkSim,
  type TownsfolkProfile,
  type TownsfolkSim,
  type TownsfolkVenue,
} from '@/lib/world/ambient/townsfolk'
import { selectDrawn } from '@/lib/world/ambient/select'
import type { AmbientConfig, AmbientTier, TownsfolkPose } from '@/lib/world/ambient/types'
import { kitMeshes, type KitMeshes } from './layer'
import type { ScenePedestrianKit } from './pedestrianKits'

export interface TownsfolkLayerOptions {
  readonly tier: AmbientTier
  readonly config: Pick<AmbientConfig, 'seed' | 'townsfolk' | 'pedestrians'>
  /** The living city's material (AmbientLayer.material): never a new program. */
  readonly material: Material
  readonly groundY: number
  readonly venues: readonly TownsfolkVenue[]
  /** The player's drawn height for a camera distance (avatarSize × playerScale). */
  readonly playerHeight: (distance: number) => number
  /** Body-major kits: kit = body × poses + pose (pedestrianKits.ts bakeTownsfolkKits). */
  readonly kits: () => Promise<readonly ScenePedestrianKit[]>
  readonly onChange: () => void
  readonly onFailure?: (reason: string) => void
}

export interface TownsfolkUpdate {
  readonly tS: number
  readonly camera: Camera
  readonly distance: number
  readonly targetX: number
  readonly targetY: number
  /** The FPS step-down's share of active slots (densityShare, without the night blend). */
  readonly share: number
}

export interface TownsfolkView {
  readonly status: 'loading' | 'ready' | 'failed'
  readonly drawn: number
  readonly triangles: number
  readonly drawCalls: number
  /** Kits with at least one local drawn. */
  readonly kitsDrawn: number
}

export interface TownsfolkLayer {
  readonly group: Group
  update(input: TownsfolkUpdate): TownsfolkView
  view(): TownsfolkView
  /** The drawn local under a point (CSS px in a `width` × `height` viewport), nearest first. */
  pick(camera: Camera, x: number, y: number, width: number, height: number): string | null
  /** The drawn locals, nearest the camera first. */
  drawnIds(): readonly string[]
  profile(id: string): TownsfolkProfile | null
  /** A drawn local's head in CSS px, or null when it is not drawn. */
  headOnScreen(
    id: string,
    camera: Camera,
    width: number,
    height: number,
  ): { x: number; y: number } | null
  /** Every drawn local's body centre in CSS px (test hooks). */
  screenPoints(
    camera: Camera,
    width: number,
    height: number,
  ): { id: string; x: number; y: number }[]
  meshes(): readonly InstancedMesh[]
  dispose(): void
}

/** Below this many CSS px wide a local's tap box is widened to it (a thumb's reach). */
const MIN_TAP_HALF_WIDTH_PX = 14
/** A local's tap box half-width as a share of its height on screen. */
const TAP_HALF_WIDTH_SHARE = 0.22

const EMPTY: TownsfolkView = {
  status: 'loading',
  drawn: 0,
  triangles: 0,
  drawCalls: 0,
  kitsDrawn: 0,
}

export function createTownsfolkLayer(options: TownsfolkLayerOptions): TownsfolkLayer {
  const { tier, config, material, groundY } = options
  const tf = config.townsfolk
  const group = new Group()
  group.name = 'townsfolk'
  const cap = tf.maxShown[tier]
  const poses: readonly TownsfolkPose[] = tf.poses[tier]
  const palette = config.pedestrians.palette
  const sim: TownsfolkSim = createTownsfolkSim({
    venues: options.venues,
    seed: config.seed,
    config: tf,
    tier,
    palette: {
      skin: palette.skin.length,
      tops: palette.tops.length,
      bottoms: palette.bottoms.length,
    },
  })
  const byId = new Map(sim.residents.map((r, i) => [r.profile.id, i]))
  const skins = palette.skin.map((hex) => new Color(hex))
  const tops = palette.tops.map((hex) => new Color(hex))
  const bottoms = palette.bottoms.map((hex) => new Color(hex))
  const hairs = tf.hair.map((hex) => new Color(hex))

  let disposed = false
  let status: TownsfolkView['status'] = cap === 0 ? 'ready' : 'loading'
  let last: TownsfolkView = { ...EMPTY, status }
  let kits: KitMeshes[] = []
  let kitHeights: number[] = []
  let disposeKits = () => {}

  async function load() {
    try {
      const loaded = await options.kits()
      if (disposed) {
        for (const kit of loaded) kit.dispose()
        return
      }
      disposeKits = () => {
        for (const kit of loaded) kit.dispose()
      }
      kits = loaded.map((kit) =>
        kitMeshes(
          `townsfolk-${kit.id}`,
          kit.parts,
          cap,
          material,
          new Set(['skin', 'top', 'bottom', 'accent']),
          kit.triangles,
        ),
      )
      kitHeights = loaded.map((kit) => kit.heightM)
      for (const kit of kits) for (const mesh of kit.meshes) group.add(mesh)
      status = 'ready'
      options.onChange()
    } catch (error) {
      status = 'failed'
      options.onFailure?.(`townsfolk: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (cap > 0) void load()

  // ---- per update scratch -------------------------------------------------------------------
  const frustum = new Frustum()
  const projection = new Matrix4()
  const sphere = new Sphere()
  const cameraPosition = new Vector3()
  const matrix = new Matrix4()
  const position = new Vector3()
  const scale = new Vector3()
  const quaternion = new Quaternion()
  const up = new Vector3(0, 1, 0)
  const point = new Vector3()
  const picked = new Int32Array(Math.max(1, cap))
  let dist = new Float64Array(64)
  let vis = new Uint8Array(64)
  let count = 0
  const candidates = {
    get count() {
      return count
    },
    distanceSq: (i: number) => dist[i] ?? Infinity,
    visible: (i: number) => vis[i] === 1,
  }
  /** What the last update drew: resident index, ground point and height, nearest first. */
  const drawn: { resident: number; x: number; y: number; h: number }[] = []
  let drawnCount = 0

  const setColor = (kit: KitMeshes, bucket: string, slot: number, color: Color | undefined) => {
    if (color === undefined) return
    for (const entry of kit.recolour) {
      if (entry.bucket === bucket && entry.mesh.instanceColor) {
        color.toArray(entry.mesh.instanceColor.array, slot * 3)
      }
    }
  }

  function update(input: TownsfolkUpdate): TownsfolkView {
    for (const kit of kits) kit.count = 0
    drawnCount = 0
    let triangles = 0
    if (status === 'ready' && kits.length > 0 && input.distance <= tf.showBelowDistanceM[tier]) {
      const { camera } = input
      camera.updateMatrixWorld()
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      frustum.setFromProjectionMatrix(projection)
      camera.getWorldPosition(cameraPosition)
      const h = options.playerHeight(input.distance) * tf.heightOfPlayer
      const n = sim.collect(
        input.targetX,
        input.targetY,
        tf.focusRadiusM[tier],
        input.tS,
        h,
        input.share,
      )
      if (n > dist.length) {
        dist = new Float64Array(n * 2)
        vis = new Uint8Array(n * 2)
      }
      count = n
      for (let i = 0; i < n; i++) {
        const s = sim.samples[i]
        if (s === undefined) {
          vis[i] = 0
          continue
        }
        sphere.center.set(s.x, groundY + h / 2, -s.y)
        sphere.radius = h / 2
        const inView = frustum.intersectsSphere(sphere)
        vis[i] = inView ? 1 : 0
        dist[i] = inView ? sphere.center.distanceToSquared(cameraPosition) : Infinity
      }
      const shown = selectDrawn(candidates, cap, picked)
      for (let k = 0; k < shown; k++) {
        const s = sim.samples[picked[k] ?? 0]
        if (s === undefined) continue
        const r = sim.residents[s.resident]
        if (r === undefined) continue
        const kitIndex = r.body * poses.length + Math.max(0, poses.indexOf(s.pose))
        const kit = kits[kitIndex]
        const kitHeight = kitHeights[kitIndex] ?? 1
        if (kit === undefined || kitHeight <= 0) continue
        const slot = kit.count++
        const size = h / kitHeight
        position.set(s.x, groundY + s.lift, -s.y)
        quaternion.setFromAxisAngle(up, s.yaw)
        scale.set(size, size, size)
        matrix.compose(position, quaternion, scale)
        matrix.toArray(kit.matrices.array, slot * 16)
        setColor(kit, 'skin', slot, skins[r.skin])
        setColor(kit, 'top', slot, tops[r.top])
        setColor(kit, 'bottom', slot, bottoms[r.bottom])
        setColor(kit, 'accent', slot, hairs[r.hair])
        triangles += kit.triangles
        let entry = drawn[drawnCount]
        if (entry === undefined) {
          entry = { resident: 0, x: 0, y: 0, h: 0 }
          drawn.push(entry)
        }
        entry.resident = s.resident
        entry.x = s.x
        entry.y = s.y
        entry.h = h
        drawnCount++
      }
    }
    let drawCalls = 0
    let kitsDrawn = 0
    for (const kit of kits) {
      for (const mesh of kit.meshes) {
        mesh.count = kit.count
        mesh.visible = kit.count > 0
      }
      if (kit.count > 0) {
        kit.matrices.needsUpdate = true
        for (const entry of kit.recolour) {
          if (entry.mesh.instanceColor) entry.mesh.instanceColor.needsUpdate = true
        }
        drawCalls += kit.meshes.length
        kitsDrawn++
      }
    }
    last = { status, drawn: drawnCount, triangles, drawCalls, kitsDrawn }
    return last
  }

  /** Projects (x, ground + lift, -y) into CSS px; null behind the camera. */
  const project = (camera: Camera, x: number, y: number, lift: number, w: number, hgt: number) => {
    point.set(x, groundY + lift, -y).project(camera)
    if (point.z < -1 || point.z > 1) return null
    return { x: ((point.x + 1) / 2) * w, y: ((1 - point.y) / 2) * hgt }
  }

  const idOf = (resident: number) => sim.residents[resident]?.profile.id ?? null

  return {
    group,
    update,
    view: () => ({ ...last, status }),
    pick(camera, x, y, width, height) {
      camera.updateMatrixWorld()
      // Nearest first (the draw order), so the local in front wins an overlap.
      for (let k = 0; k < drawnCount; k++) {
        const d = drawn[k]
        if (d === undefined) continue
        const foot = project(camera, d.x, d.y, 0, width, height)
        const head = project(camera, d.x, d.y, d.h, width, height)
        if (foot === null || head === null) continue
        const tall = Math.max(1, foot.y - head.y)
        const half = Math.max(MIN_TAP_HALF_WIDTH_PX, tall * TAP_HALF_WIDTH_SHARE)
        const cx = (foot.x + head.x) / 2
        if (Math.abs(x - cx) <= half && y >= head.y - half / 2 && y <= foot.y + half / 2) {
          return idOf(d.resident)
        }
      }
      return null
    },
    drawnIds() {
      const ids: string[] = []
      for (let k = 0; k < drawnCount; k++) {
        const id = idOf(drawn[k]?.resident ?? -1)
        if (id !== null) ids.push(id)
      }
      return ids
    },
    profile(id) {
      const index = byId.get(id)
      return index === undefined ? null : (sim.residents[index]?.profile ?? null)
    },
    headOnScreen(id, camera, width, height) {
      const index = byId.get(id)
      for (let k = 0; k < drawnCount; k++) {
        const d = drawn[k]
        if (d === undefined || d.resident !== index) continue
        camera.updateMatrixWorld()
        return project(camera, d.x, d.y, d.h, width, height)
      }
      return null
    },
    screenPoints(camera, width, height) {
      camera.updateMatrixWorld()
      const out: { id: string; x: number; y: number }[] = []
      for (let k = 0; k < drawnCount; k++) {
        const d = drawn[k]
        const id = d === undefined ? null : idOf(d.resident)
        if (d === undefined || id === null) continue
        const mid = project(camera, d.x, d.y, d.h / 2, width, height)
        if (mid !== null) out.push({ id, ...mid })
      }
      return out
    },
    meshes: () => kits.flatMap((kit) => kit.meshes),
    dispose() {
      disposed = true
      group.removeFromParent()
      for (const kit of kits) for (const mesh of kit.meshes) mesh.dispose()
      disposeKits()
    },
  }
}
