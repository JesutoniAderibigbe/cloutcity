/**
 * Real players on the map, three.js side (S42 phase 1): each online player the server lets this
 * viewer see stands at their place pin as a Sims-like figure, drawn with the townsfolk's own baked
 * kits (src/scene/ambient/pedestrianKits.ts), on the living city's material (zero new shader
 * programs), at the player's own drawn size (the map style's `characterMaxM` curve). Each one
 * stands over a flat ring in the theme's accent (on the same material, instance-coloured), and
 * the DOM overlay adds a name tag: real players never read as locals (UX-3).
 *
 * At most `cap` are drawn (perf.json `otherPlayersMax` for the tier), nearest the camera first.
 * Like the townsfolk, nothing here uses three's raycast: a tap picks a player by their projected
 * box on screen. Loaded in its own chunk by the living city (AmbientLife.tsx) only once there
 * are players to draw.
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
import themeJson from '@data/config/theme.json'
import type { TownsfolkPose } from '@/lib/world/ambient/types'
import { placePlayers, type PlacementConfig } from '@/lib/world/playerPlacement'
import type { MapPlayer } from '@/state/presence'
import { kitMeshes, type KitMeshes } from '../ambient/layer'
import type { AnimatedKit } from '../ambient/pedestrianKits'
import { farFade, flatNormals } from '../ambient/townsfolk'
import { LOOK_BODIES, lookColours } from './lookColors'

export interface PlayersLayerOptions {
  /** perf.json `otherPlayersMax` for the tier. */
  readonly cap: number
  readonly material: Material
  readonly groundY: number
  /** The townsfolk's kits (body-major: kit = body × poses + pose), already baked. */
  readonly kits: readonly AnimatedKit[]
  /** The tier's townsfolk poses, in kit order. */
  readonly poses: readonly TownsfolkPose[]
  readonly pose: TownsfolkPose
  /** The player's drawn height for a camera distance (buildAvatar.ts mapCharacterHeight). */
  readonly playerHeight: (distance: number) => number
  /** Beyond this camera distance nobody is drawn (the townsfolk's `showBelowDistanceM`). */
  readonly showBelowM: number
  readonly fadeShare: number
  readonly placement: PlacementConfig
  readonly ringColor: string
  readonly ringInnerOfHeight: number
  readonly ringOuterOfHeight: number
}

export interface PlayersUpdate {
  readonly tS: number
  readonly camera: Camera
  readonly distance: number
}

export interface PlayersView {
  readonly drawn: number
  readonly drawCalls: number
  readonly triangles: number
}

export interface PlayersLayer {
  readonly group: Group
  /** The players to stand on the map and the place pins they stand at (x, y metres). */
  setPlayers(
    players: readonly MapPlayer[],
    pins: ReadonlyMap<string, { readonly x: number; readonly y: number }>,
  ): void
  update(input: PlayersUpdate): PlayersView
  /** The drawn player under a point (CSS px in a `width` × `height` viewport), nearest first. */
  pick(camera: Camera, x: number, y: number, width: number, height: number): string | null
  /** Every drawn player's head in CSS px, nearest first. */
  heads(camera: Camera, width: number, height: number): { id: string; x: number; y: number }[]
  meshes(): readonly InstancedMesh[]
  dispose(): void
}

/** Marker text the budget's optional-chunk filter finds in this chunk (lazyChunks.ts). */
export const PLAYERS_LAYER_FEATURE = 'cc-feature:players-layer'

const MIN_TAP_HALF_WIDTH_PX = 16
const TAP_HALF_WIDTH_SHARE = 0.25
const RING_SEGMENTS = 24
/** The ring floats this share of the height over the ground (no z-fighting with the streets). */
const RING_LIFT_OF_HEIGHT = 0.02

/** A flat annulus at y = 0, outer radius 1, facing up: position and normal only, like the kits. */
export function ringGeometry(innerShare: number): BufferGeometry {
  const inner = Math.min(0.95, Math.max(0.05, innerShare))
  const positions = new Float32Array(RING_SEGMENTS * 6 * 3)
  let k = 0
  const put = (x: number, z: number) => {
    positions[k++] = x
    positions[k++] = 0
    positions[k++] = z
  }
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const a0 = (i / RING_SEGMENTS) * Math.PI * 2
    const a1 = ((i + 1) / RING_SEGMENTS) * Math.PI * 2
    const [c0, s0, c1, s1] = [Math.cos(a0), Math.sin(a0), Math.cos(a1), Math.sin(a1)]
    // Counter-clockwise seen from above, so the faces point up.
    put(c0 * inner, s0 * inner)
    put(c1 * inner, s1 * inner)
    put(c0, s0)
    put(c0, s0)
    put(c1 * inner, s1 * inner)
    put(c1, s1)
  }
  const normals = new Float32Array(positions.length)
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  return geometry
}

interface Stand {
  readonly kit: AnimatedKit
  readonly meshes: KitMeshes
  readonly geometries: readonly BufferGeometry[]
  frame: number
}

export function createPlayersLayer(options: PlayersLayerOptions): PlayersLayer {
  const { cap, material, groundY, kits, poses } = options
  const group = new Group()
  group.name = 'players'
  group.userData.feature = PLAYERS_LAYER_FEATURE
  const poseIndex = Math.max(0, poses.indexOf(options.pose))

  // One stand per body: its own copy of the pose's geometry, stepped through the loop's frames.
  const stands: (Stand | null)[] = LOOK_BODIES.map((_, body) => {
    const kit = kits[body * poses.length + poseIndex]
    if (kit === undefined || cap <= 0) return null
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
      return geometry
    })
    const meshes = kitMeshes(
      `players-${kit.id}`,
      kit.parts.map((part, p) => ({ ...part, geometry: geometries[p] ?? part.geometry })),
      cap,
      material,
      new Set(['skin', 'top', 'bottom', 'accent']),
      kit.triangles,
    )
    for (const mesh of meshes.meshes) group.add(mesh)
    return { kit, meshes, geometries, frame: -1 }
  })
  const ring = ringGeometry(options.ringInnerOfHeight / options.ringOuterOfHeight)
  const rings = kitMeshes(
    'players-ring',
    [{ bucket: 'ring', geometry: ring, color: options.ringColor }],
    Math.max(1, cap),
    material,
    new Set(),
    RING_SEGMENTS * 2,
  )
  for (const mesh of rings.meshes) group.add(mesh)

  interface Entry {
    readonly player: MapPlayer
    readonly body: number
    readonly colours: readonly [Color, Color, Color, Color]
  }
  let entries = new Map<string, Entry>()
  let pins: ReadonlyMap<string, { readonly x: number; readonly y: number }> = new Map()
  /** What the last update drew, nearest first. */
  let drawn: { id: string; x: number; y: number; h: number }[] = []

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

  const colourOf = (kit: KitMeshes, bucket: string, slot: number, colour: Color) => {
    for (const entry of kit.recolour) {
      if (entry.bucket === bucket && entry.mesh.instanceColor) {
        colour.toArray(entry.mesh.instanceColor.array, slot * 3)
      }
    }
  }

  function showFrame(stand: Stand, tS: number): void {
    const frames = stand.kit.frames
    if (stand.meshes.count === 0 || frames.length === 0) return
    const u = stand.kit.durationS > 0 ? (tS / stand.kit.durationS) % 1 : 0
    const f = Math.min(frames.length - 1, Math.floor(u * frames.length))
    if (f === stand.frame) return
    stand.frame = f
    stand.geometries.forEach((geometry, p) => {
      const source = frames[f]?.[p]
      const positionAttribute = geometry.getAttribute('position')
      const normal = geometry.getAttribute('normal')
      if (source === undefined || !(positionAttribute instanceof BufferAttribute)) return
      positionAttribute.array.set(source)
      flatNormals(source, normal.array as Float32Array)
      positionAttribute.needsUpdate = true
      normal.needsUpdate = true
    })
  }

  function update(input: PlayersUpdate): PlayersView {
    for (const stand of stands) if (stand !== null) stand.meshes.count = 0
    rings.count = 0
    drawn = []
    let triangles = 0
    if (entries.size > 0 && input.distance <= options.showBelowM) {
      const { camera } = input
      camera.updateMatrixWorld()
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      frustum.setFromProjectionMatrix(projection)
      camera.getWorldPosition(cameraPosition)
      const h = options.playerHeight(input.distance)
      const fade = farFade(input.distance, options.showBelowM, options.fadeShare)
      const placed = placePlayers(
        [...entries.values()].map((e) => e.player),
        pins,
        h,
        options.placement,
      )
      const candidates: { id: string; x: number; y: number; yaw: number; d: number }[] = []
      for (const p of placed) {
        sphere.center.set(p.x, groundY + h / 2, -p.y)
        sphere.radius = h
        if (!frustum.intersectsSphere(sphere)) continue
        candidates.push({ ...p, d: sphere.center.distanceToSquared(cameraPosition) })
      }
      candidates.sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1))
      for (const c of candidates.slice(0, cap)) {
        const entry = entries.get(c.id)
        const stand = entry === undefined ? null : (stands[entry.body] ?? stands[0] ?? null)
        if (entry === undefined || stand === null || stand.kit.heightM <= 0) continue
        const slot = stand.meshes.count++
        const size = (h * fade) / stand.kit.heightM
        position.set(c.x, groundY, -c.y)
        quaternion.setFromAxisAngle(up, c.yaw)
        scale.set(size, size, size)
        matrix.compose(position, quaternion, scale)
        matrix.toArray(stand.meshes.matrices.array, slot * 16)
        const [skin, top, bottom, hair] = entry.colours
        colourOf(stand.meshes, 'skin', slot, skin)
        colourOf(stand.meshes, 'top', slot, top)
        colourOf(stand.meshes, 'bottom', slot, bottom)
        colourOf(stand.meshes, 'accent', slot, hair)
        triangles += stand.meshes.triangles
        const ringSlot = rings.count++
        const r = h * fade * options.ringOuterOfHeight
        position.set(c.x, groundY + h * RING_LIFT_OF_HEIGHT, -c.y)
        quaternion.identity()
        scale.set(r, 1, r)
        matrix.compose(position, quaternion, scale)
        matrix.toArray(rings.matrices.array, ringSlot * 16)
        triangles += rings.triangles
        drawn.push({ id: c.id, x: c.x, y: c.y, h: h * fade })
      }
    }
    let drawCalls = 0
    for (const kit of [...stands.map((s) => s?.meshes ?? null), rings]) {
      if (kit === null) continue
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
      }
    }
    for (const stand of stands) if (stand !== null) showFrame(stand, input.tS)
    return { drawn: drawn.length, drawCalls, triangles }
  }

  const project = (camera: Camera, x: number, y: number, lift: number, w: number, h: number) => {
    point.set(x, groundY + lift, -y).project(camera)
    if (point.z < -1 || point.z > 1) return null
    return { x: ((point.x + 1) / 2) * w, y: ((1 - point.y) / 2) * h }
  }

  return {
    group,
    setPlayers(players, nextPins) {
      pins = nextPins
      const next = new Map<string, Entry>()
      for (const player of players) {
        const previous = entries.get(player.id)
        if (previous !== undefined && previous.player.look === player.look) {
          next.set(player.id, { ...previous, player })
          continue
        }
        const colours = lookColours(player.look)
        next.set(player.id, {
          player,
          body: LOOK_BODIES.indexOf(colours.body),
          colours: [
            new Color(colours.skin.hex),
            new Color(colours.top.hex),
            new Color(colours.bottom.hex),
            new Color(colours.hair.hex),
          ],
        })
      }
      entries = next
    },
    update,
    pick(camera, x, y, width, height) {
      camera.updateMatrixWorld()
      for (const d of drawn) {
        const foot = project(camera, d.x, d.y, 0, width, height)
        const head = project(camera, d.x, d.y, d.h, width, height)
        if (foot === null || head === null) continue
        const tall = Math.max(1, foot.y - head.y)
        const half = Math.max(MIN_TAP_HALF_WIDTH_PX, tall * TAP_HALF_WIDTH_SHARE)
        const cx = (foot.x + head.x) / 2
        if (Math.abs(x - cx) <= half && y >= head.y - half && y <= foot.y + half / 2) return d.id
      }
      return null
    },
    heads(camera, width, height) {
      camera.updateMatrixWorld()
      const out: { id: string; x: number; y: number }[] = []
      for (const d of drawn) {
        const head = project(camera, d.x, d.y, d.h, width, height)
        if (head !== null) out.push({ id: d.id, ...head })
      }
      return out
    },
    meshes: () => [
      ...stands.flatMap((stand) => (stand === null ? [] : stand.meshes.meshes)),
      ...rings.meshes,
    ],
    dispose() {
      group.removeFromParent()
      for (const stand of stands) {
        if (stand === null) continue
        for (const mesh of stand.meshes.meshes) mesh.dispose()
        for (const geometry of stand.geometries) geometry.dispose()
      }
      for (const mesh of rings.meshes) mesh.dispose()
      ring.dispose()
    },
  }
}

/** A data/config/theme.json colour token's hex (the ring's accent). */
export function themeColour(token: string): string {
  const hex = (themeJson as { colors: Readonly<Record<string, string>> }).colors[token]
  // realtime.json's token is checked against theme.json by layer.test.ts.
  if (hex === undefined) throw new Error(`players: no theme colour "${token}"`)
  return hex
}
