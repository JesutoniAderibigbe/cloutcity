/**
 * The townsfolk's three.js side (S04o): the locals of src/lib/world/ambient/townsfolk.ts drawn at
 * the player's size (scene.json `avatar`: avatarSize × `playerScale` × `heightOfPlayer`), so they
 * read at the map's default view like the Sims-style crowds of a game map.
 *
 * Each kit (a body in one pose, baked by pedestrianKits.ts into a loop of frames of its rig clip)
 * is one colour-bucket InstancedMesh per bucket on the living city's own material (the blocks'
 * program: zero new shader programs), skin, top, bottom and hair recoloured per local. The
 * locals in one kit move in step: the kit's positions are rewritten when its loop reaches the
 * next frame (S04q). Walkers step at the cadence their pace and drawn size call for, so their
 * feet do not slide, and on tiers with `phaseGroups` > 1 they split into groups stepping out of
 * phase. Standing locals play their idle, talk or wave loop. Only kits with a local in view
 * draw, so a tier pays 4 draw calls per pose, body and phase group it shows. Nothing here uses
 * three's raycast: a tap picks a local by its projected box on screen (`pick`), like the pins.
 *
 * Locals are NPCs, never players (UX-3): no ring, no chip, never counted as "online".
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
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
  TOWNSFOLK_BODIES,
  createTownsfolkSim,
  type TownsfolkProfile,
  type TownsfolkSim,
  type TownsfolkVenue,
} from '@/lib/world/ambient/townsfolk'
import { selectDrawn } from '@/lib/world/ambient/select'
import type {
  AmbientConfig,
  AmbientTier,
  StreetGraph,
  TownsfolkPose,
} from '@/lib/world/ambient/types'
import { NIGHT_GLOW_ATTRIBUTE } from '../lighting/nightGlow'
import { flatNormals } from './flatNormals'
import { kitMeshes, type KitMeshes } from './layer'
import type { AnimatedKit } from './pedestrianKits'

export interface TownsfolkLayerOptions {
  readonly tier: AmbientTier
  readonly config: Pick<AmbientConfig, 'seed' | 'townsfolk' | 'pedestrians'>
  /** The living city's material (AmbientLayer.material): never a new program. */
  readonly material: Material
  readonly groundY: number
  readonly venues: readonly TownsfolkVenue[]
  /** The player's drawn height for a camera distance (buildAvatar.ts mapCharacterHeight). */
  readonly playerHeight: (distance: number) => number
  /** The player's tallest (the map style's `characterMaxM`): what walks are planned for. */
  readonly playerMaxHeight: number
  /** The street graph the cars drive (null when the streets did not load: walks go straight). */
  readonly graph: () => Promise<StreetGraph | null>
  /** Body-major kits: kit = body × poses + pose (pedestrianKits.ts bakeTownsfolkKits). */
  readonly kits: () => Promise<readonly AnimatedKit[]>
  /**
   * The living city's lamp material (AmbientLayer.lampMaterial: the shared night-glow program
   * the vehicles' lamps and the pins use). When given the locals draw with it and glow softly at
   * night (S04r2); never a new program.
   */
  readonly glowMaterial?: Material | null
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
  /** The day/night rig's night blend, 0 (day) to 1 (night): where new cycles are spent. */
  readonly night?: number
}

export interface TownsfolkView {
  readonly status: 'loading' | 'ready' | 'failed'
  readonly drawn: number
  readonly triangles: number
  readonly drawCalls: number
  /** Kits with at least one local drawn. */
  readonly kitsDrawn: number
  /** Benches drawn (S04r2). */
  readonly benches?: number
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

/**
 * The locals' size multiplier at a camera distance: 1, then over the last `share` of
 * `showBelowM` an eased shrink to 0, so pulling back never pops them out.
 */
export function farFade(distance: number, showBelowM: number, share: number): number {
  const from = showBelowM * (1 - share)
  if (distance <= from) return 1
  const u = Math.max(0, Math.min(1, (showBelowM - distance) / (showBelowM - from)))
  return u * u * (3 - 2 * u)
}

/** The longest step a walk loop advances in one update (a tab coming back skips, not races). */
const MAX_STEP_S = 0.25

/** How much of the night glow each bucket takes: the outfit most, the hair least. */
const GLOW_SHARE: Readonly<Record<string, number>> = {
  top: 1,
  bottom: 0.8,
  skin: 0.55,
  accent: 0.4,
}

const liftScratch = new Color()
const WHITE = new Color(1, 1, 1)
/** `color` lifted `share` of the way to white (scratch: copy before the next call). */
function lifted(color: Color | undefined, share: number): Color | undefined {
  if (color === undefined || share <= 0) return color
  return liftScratch.copy(color).lerp(WHITE, share)
}

/**
 * A low-poly bench (S04r2) one local tall: seat, backrest and two end frames, sized for the
 * baked `sit` pose (its seat 0.245 of a standing height up, under the sitter's thighs, which
 * sit just behind the kit's origin), `length` heights long along x, facing +z like the locals.
 * Non-indexed positions with flat normals, no bottoms (never seen): 40 triangles.
 */
export function createBenchGeometry(length: number): BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[]) => {
    positions.push(...a, ...b, ...c, ...a, ...c, ...d)
    for (let i = 0; i < 6; i++) normals.push(...n)
  }
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0])
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1])
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1])
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0])
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0])
  }
  const half = length / 2
  box(-half, half, 0.215, 0.245, -0.24, -0.02)
  box(-half, half, 0.26, 0.48, -0.27, -0.24)
  box(-half, -half + 0.04, 0, 0.215, -0.24, -0.04)
  box(half - 0.04, half, 0, 0.215, -0.24, -0.04)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(Float32Array.from(normals), 3))
  geometry.computeBoundingSphere()
  return geometry
}

const EMPTY: TownsfolkView = {
  status: 'loading',
  drawn: 0,
  triangles: 0,
  drawCalls: 0,
  kitsDrawn: 0,
}

export function createTownsfolkLayer(options: TownsfolkLayerOptions): TownsfolkLayer {
  const { tier, config, material, groundY } = options
  const glowMaterial = options.glowMaterial ?? null
  const tf = config.townsfolk
  const group = new Group()
  group.name = 'townsfolk'
  const cap = tf.maxShown[tier]
  const poses: readonly TownsfolkPose[] = tf.poses[tier]
  const palette = config.pedestrians.palette
  const simOptions = {
    venues: options.venues,
    seed: config.seed,
    config: tf,
    tier,
    palette: {
      skin: palette.skin.length,
      tops: palette.tops.length,
      bottoms: palette.bottoms.length,
    },
    heightM: options.playerMaxHeight * tf.heightOfPlayer,
  }
  // Until the streets arrive the locals are not drawn (their walks depend on the routes).
  let sim: TownsfolkSim = createTownsfolkSim({ ...simOptions, graph: null })
  // Profiles and order never depend on the graph: ids resolve the same before and after.
  const byId = new Map(sim.residents.map((r, i) => [r.profile.id, i]))
  const skins = palette.skin.map((hex) => new Color(hex))
  const tops = palette.tops.map((hex) => new Color(hex))
  const bottoms = palette.bottoms.map((hex) => new Color(hex))
  const hairs = tf.hair.map((hex) => new Color(hex))

  let disposed = false
  let status: TownsfolkView['status'] = cap === 0 ? 'ready' : 'loading'
  let last: TownsfolkView = { ...EMPTY, status }
  /** One phase group of one kit: its own geometry (its frame) and meshes. */
  interface Stepper {
    readonly kit: AnimatedKit
    readonly meshes: KitMeshes
    readonly geometries: readonly BufferGeometry[]
    /** This group's offset into the loop, 0..1. */
    readonly offset: number
    /** Loops walked so far (walkers integrate it: their cadence follows their drawn size). */
    loops: number
    frame: number
  }
  /** steppers[kit][group]. */
  let steppers: Stepper[][] = []
  let kits: KitMeshes[] = []
  let disposeKits = () => {}
  /** Benches at townsfolk scale (S04r2): one instanced mesh on the living city's material. */
  const benchCap = tf.bench.maxShown[tier]
  let benchKit: KitMeshes | null = null
  let benchGeometry: BufferGeometry | null = null
  let standHeight: number[] = []
  const benchOrder: number[] = []
  const benchDist = new Map<number, number>()

  const stepperFor = (kit: AnimatedKit, g: number, groups: number): Stepper => {
    const geometries = kit.parts.map((part) => {
      const geometry = new BufferGeometry()
      const position = new BufferAttribute(
        Float32Array.from(part.geometry.getAttribute('position').array),
        3,
      )
      const normal = new BufferAttribute(
        Float32Array.from(part.geometry.getAttribute('normal').array),
        3,
      )
      position.setUsage(DynamicDrawUsage)
      normal.setUsage(DynamicDrawUsage)
      geometry.setAttribute('position', position)
      geometry.setAttribute('normal', normal)
      if (glowMaterial !== null) {
        // A soft night glow, strongest on the outfit: read under the shared uNightGlow.
        const share = GLOW_SHARE[part.bucket] ?? 0.5
        const glow = new Float32Array(position.count * 3)
        for (let i = 0; i < position.count; i++) {
          glow[i * 3] = tf.night.emissive[0] * share
          glow[i * 3 + 1] = tf.night.emissive[1] * share
          glow[i * 3 + 2] = tf.night.emissive[2] * share
        }
        geometry.setAttribute(NIGHT_GLOW_ATTRIBUTE, new BufferAttribute(glow, 3))
      }
      return geometry
    })
    const meshes = kitMeshes(
      `townsfolk-${kit.id}-${g}`,
      kit.parts.map((part, p) => ({ ...part, geometry: geometries[p] ?? part.geometry })),
      cap,
      glowMaterial ?? material,
      new Set(['skin', 'top', 'bottom', 'accent']),
      kit.triangles,
    )
    return { kit, meshes, geometries, offset: g / groups, loops: 0, frame: 0 }
  }

  async function load() {
    try {
      const [loaded, graph] = await Promise.all([options.kits(), options.graph().catch(() => null)])
      if (disposed) {
        for (const kit of loaded) kit.dispose()
        return
      }
      sim = createTownsfolkSim({ ...simOptions, graph })
      disposeKits = () => {
        for (const kit of loaded) kit.dispose()
      }
      steppers = loaded.map((kit) => {
        const groups = kit.pose === 'walk' ? Math.max(1, tf.phaseGroups[tier]) : 1
        return Array.from({ length: groups }, (_, g) => stepperFor(kit, g, groups))
      })
      kits = steppers.flatMap((list) => list.map((stepper) => stepper.meshes))
      for (const kit of kits) for (const mesh of kit.meshes) group.add(mesh)
      // The standing height of each body: a sitter is scaled as tall as it stands (S04r2).
      const standPose = poses.findIndex((pose) => pose !== 'sit')
      standHeight = TOWNSFOLK_BODIES.map(
        (_, body) => loaded[body * poses.length + Math.max(0, standPose)]?.heightM ?? 0,
      )
      if (benchCap > 0 && sim.benches.length > 0) {
        benchGeometry = createBenchGeometry(tf.bench.seatOfHeight * 3)
        benchKit = kitMeshes(
          'townsfolk-bench',
          [{ bucket: 'bench', geometry: benchGeometry, color: tf.bench.color }],
          benchCap,
          material,
          new Set(),
          benchGeometry.getAttribute('position').count / 3,
        )
        for (const mesh of benchKit.meshes) group.add(mesh)
      }
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

  /** City time of the last update: walkers' loops advance by the time since. */
  let lastS: number | null = null
  /**
   * Moves every kit's loop on to `tS`. Standing loops are a pure function of the clock; a walk
   * loop advances at the cadence that keeps a planted foot still for a local `h` tall walking
   * the sim's pace (pace / (loop length × h) loops a second). A paused or frozen city passes the
   * same time again, so nothing moves.
   */
  function advance(tS: number, h: number): void {
    const dt = lastS === null ? 0 : Math.max(0, Math.min(MAX_STEP_S, tS - lastS))
    lastS = tS
    const pace = tf.walkHeightsPerS * options.playerMaxHeight * tf.heightOfPlayer
    for (const list of steppers) {
      for (const stepper of list) {
        const { kit } = stepper
        if (kit.cycleHeights > 0 && h > 0) {
          stepper.loops = (stepper.loops + (dt * pace) / (kit.cycleHeights * h)) % 1
        } else if (kit.durationS > 0) {
          stepper.loops = (tS / kit.durationS) % 1
        }
      }
    }
  }

  /** Writes a drawn kit's current frame into its geometry when the loop reached a new one. */
  function showFrame(stepper: Stepper): void {
    if (stepper.meshes.count === 0) return
    const frames = stepper.kit.frames
    const u = (stepper.loops + stepper.offset) % 1
    const f = Math.min(frames.length - 1, Math.floor(u * frames.length))
    if (f === stepper.frame && stepper.geometries[0]?.userData.shown === true) return
    stepper.frame = f
    const frame = frames[f]
    stepper.geometries.forEach((geometry, p) => {
      const source = frame?.[p]
      const position = geometry.getAttribute('position')
      const normal = geometry.getAttribute('normal')
      if (source === undefined || !(position instanceof BufferAttribute)) return
      position.array.set(source)
      flatNormals(source, normal.array as Float32Array)
      position.needsUpdate = true
      normal.needsUpdate = true
      geometry.userData.shown = true
    })
  }

  /**
   * Writes the benches near the camera target and in view into `kit`, nearest first, at the
   * locals' drawn size (the frustum was set by the update that called this). Returns how many.
   */
  function placeBenches(input: TownsfolkUpdate, kit: KitMeshes): number {
    const h = options.playerHeight(input.distance) * tf.heightOfPlayer
    const size = h * farFade(input.distance, tf.showBelowDistanceM[tier], tf.fadeShare)
    if (size <= 0) return 0
    const reach = tf.focusRadiusM[tier]
    benchOrder.length = 0
    benchDist.clear()
    sim.benches.forEach((bench, b) => {
      const dx = bench.x - input.targetX
      const dy = bench.y - input.targetY
      if (dx * dx + dy * dy > reach * reach) return
      sphere.center.set(bench.x, groundY + size / 4, -bench.y)
      sphere.radius = size
      if (!frustum.intersectsSphere(sphere)) return
      benchOrder.push(b)
      benchDist.set(b, sphere.center.distanceToSquared(cameraPosition))
    })
    benchOrder.sort((a, b) => (benchDist.get(a) ?? 0) - (benchDist.get(b) ?? 0) || a - b)
    const shown = Math.min(benchCap, benchOrder.length)
    for (let k = 0; k < shown; k++) {
      const bench = sim.benches[benchOrder[k] ?? 0]
      if (bench === undefined) continue
      position.set(bench.x, groundY, -bench.y)
      quaternion.setFromAxisAngle(up, bench.yaw)
      scale.set(size, size, size)
      matrix.compose(position, quaternion, scale)
      matrix.toArray(kit.matrices.array, k * 16)
    }
    kit.count = shown
    return shown
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
      const fade = farFade(input.distance, tf.showBelowDistanceM[tier], tf.fadeShare)
      // At night outfits lift towards white, so the locals read against the dark map (S04r2).
      const lift = tf.night.lift * Math.max(0, Math.min(1, input.night ?? 0))
      advance(input.tS, h)
      const n = sim.collect(
        input.targetX,
        input.targetY,
        tf.focusRadiusM[tier],
        input.tS,
        input.share,
        input.night ?? 0,
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
        const groupList = steppers[kitIndex]
        const stepper = groupList?.[r.hash % Math.max(1, groupList.length)]
        // A sitter is scaled by its standing height, so it sits as tall as it stands.
        const kitHeight =
          s.pose === 'sit'
            ? (standHeight[r.body] ?? stepper?.kit.heightM ?? 0)
            : (stepper?.kit.heightM ?? 0)
        if (stepper === undefined || kitHeight <= 0) continue
        const kit = stepper.meshes
        const slot = kit.count++
        // A local going in or out of a door shrinks or grows there (S04r).
        const size = (h * fade * s.fade) / kitHeight
        const bench = s.bench >= 0 ? sim.benches[s.bench] : undefined
        if (bench !== undefined) {
          // On its seat of the bench as drawn now (the bench is drawn at the locals' size).
          const along = s.seat * h * fade
          position.set(
            bench.x + Math.cos(bench.yaw) * along,
            groundY,
            -(bench.y - Math.sin(bench.yaw) * along),
          )
        } else {
          position.set(s.x, groundY, -s.y)
        }
        quaternion.setFromAxisAngle(up, s.yaw)
        scale.set(size, size, size)
        matrix.compose(position, quaternion, scale)
        matrix.toArray(kit.matrices.array, slot * 16)
        setColor(kit, 'skin', slot, skins[r.skin])
        setColor(kit, 'top', slot, lifted(tops[r.top], lift))
        setColor(kit, 'bottom', slot, lifted(bottoms[r.bottom], lift))
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
    for (const list of steppers) for (const stepper of list) showFrame(stepper)
    let drawCalls = 0
    let kitsDrawn = 0
    let benchesDrawn = 0
    if (benchKit !== null) {
      benchKit.count = 0
      if (status === 'ready' && input.distance <= tf.showBelowDistanceM[tier]) {
        benchesDrawn = placeBenches(input, benchKit)
        triangles += benchesDrawn * benchKit.triangles
      }
      for (const mesh of benchKit.meshes) {
        mesh.count = benchKit.count
        mesh.visible = benchKit.count > 0
      }
      if (benchKit.count > 0) {
        benchKit.matrices.needsUpdate = true
        drawCalls += benchKit.meshes.length
      }
    }
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
    last = { status, drawn: drawnCount, triangles, drawCalls, kitsDrawn, benches: benchesDrawn }
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
    meshes: () => [...kits.flatMap((kit) => kit.meshes), ...(benchKit?.meshes ?? [])],
    dispose() {
      disposed = true
      group.removeFromParent()
      for (const kit of kits) for (const mesh of kit.meshes) mesh.dispose()
      for (const list of steppers) {
        for (const stepper of list) for (const geometry of stepper.geometries) geometry.dispose()
      }
      disposeKits()
      for (const mesh of benchKit?.meshes ?? []) mesh.dispose()
      benchGeometry?.dispose()
    },
  }
}
