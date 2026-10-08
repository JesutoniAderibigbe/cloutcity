/**
 * Place pins (S04c): one InstancedMesh per look (a venue pin, a landmark obelisk placeholder
 * until S07b's models, and a compact badge floating over each landmark that has a model, S07a),
 * so every place costs three draw calls in all, plus a selection ring under the open place. Per-instance colours carry the style (by kind, teaser on "expanding
 * soon" land, muted memorial). Pin height follows the camera distance, clamped, like the station
 * markers, so pins stay findable from street level to the whole-city view. three only, no React.
 */
import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  OctahedronGeometry,
  Quaternion,
  RingGeometry,
  Vector3,
} from 'three'
import type { BufferGeometry, Camera, IUniform, Texture } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { SceneConfig } from '@/lib/data/schemas/scene'
import { LAY_FLAT_X } from '../geo/coords'
import type { GeoPin, PinKind } from '../geo/schema'
import { NIGHT_GLOW_ATTRIBUTE, patchNightGlow } from '../lighting/nightGlow'
import type { ScenePalette } from '../types'
import type { ScreenPin } from './pick'

/** How a pin is drawn: by kind, and as a badge over a modelled landmark (S07a). */
export type PinLook = PinKind | 'badge'
export const PIN_LOOKS = ['venue', 'landmark', 'badge'] as const satisfies readonly PinLook[]

export function pinLook(pin: Pick<GeoPin, 'kind' | 'badge'>): PinLook {
  return pin.kind === 'landmark' && pin.badge === true ? 'badge' : pin.kind
}

/** Where on a unit-height pin its head sits: the point taps aim at. */
export const PIN_HEAD = { venue: 0.8, landmark: 0.85, badge: 0.78 } as const satisfies Record<
  PinLook,
  number
>

/** Position, normal only, non-indexed: the shape every merged pin part must share. */
function part(geometry: BufferGeometry): BufferGeometry {
  geometry.deleteAttribute('uv')
  return geometry.index === null ? geometry : geometry.toNonIndexed()
}

function merged(parts: BufferGeometry[], what: string): BufferGeometry {
  const geometry = mergeGeometries(parts.map(part))
  if (geometry === null) throw new Error(`pins: could not merge the ${what} geometry`)
  for (const piece of parts) piece.dispose()
  return geometry
}

/** A venue pin of unit height: a cone standing on its tip with a gem for a head. */
export function buildVenuePinGeometry(radialSegments: number): BufferGeometry {
  const stem = new ConeGeometry(0.16, 0.62, radialSegments, 1)
  stem.rotateX(Math.PI)
  stem.translate(0, 0.31, 0)
  const head = new OctahedronGeometry(0.2, 0)
  head.translate(0, PIN_HEAD.venue, 0)
  return merged([stem, head], 'venue')
}

/** A landmark marker of unit height: a four-sided obelisk with a pointed cap (placeholder). */
export function buildLandmarkPinGeometry(): BufferGeometry {
  const shaft = new CylinderGeometry(0.07, 0.13, 0.78, 4, 1)
  shaft.rotateY(Math.PI / 4)
  shaft.translate(0, 0.39, 0)
  const cap = new ConeGeometry(0.1, 0.22, 4, 1)
  cap.rotateY(Math.PI / 4)
  cap.translate(0, 0.89, 0)
  return merged([shaft, cap], 'landmark')
}

/**
 * A landmark badge of unit height (S07a): a slim stem with a six-sided medallion facing
 * the camera's side of the map, so it reads as a tap target over a model without hiding it.
 */
export function buildBadgePinGeometry(): BufferGeometry {
  const stem = new CylinderGeometry(0.03, 0.05, 0.56, 4, 1)
  stem.translate(0, 0.28, 0)
  const medallion = new CylinderGeometry(0.22, 0.22, 0.07, 6, 1)
  medallion.rotateX(Math.PI / 2)
  medallion.translate(0, PIN_HEAD.badge, 0)
  return merged([stem, medallion], 'badge')
}

/**
 * Where a pin stands: its compact game-map point (S04n, the places layer's `gx`/`gy`) when
 * `compact` and it has one, else its real point.
 */
export function pinPoint(
  pin: Pick<GeoPin, 'x' | 'y' | 'gx' | 'gy'>,
  compact: boolean,
): { readonly x: number; readonly y: number } {
  return compact && pin.gx !== undefined && pin.gy !== undefined ? { x: pin.gx, y: pin.gy } : pin
}

/** Pin height for a camera distance, clamped. */
export function pinHeight(distance: number, pins: SceneConfig['pins']): number {
  return Math.min(pins.maxHeightM, Math.max(pins.minHeightM, distance * pins.heightPerDistance))
}

/** A pin's colour: its kind's, or its style's when it is a teaser or a memorial. */
export function pinColor(pin: Pick<GeoPin, 'kind' | 'style'>, palette: ScenePalette): string {
  if (pin.style === 'normal') return palette.pins[pin.kind]
  return pin.style === 'teaser' ? palette.pins.teaser : palette.pins.muted
}

export interface PinObjects {
  readonly group: Group
  /** Every pin, venues first, in layer order. */
  readonly pins: readonly GeoPin[]
  /** Rescales the pins (and the ring) for a camera distance. */
  applyDistance(distance: number): void
  /** The pins' current height in metres (0 until the first `applyDistance`). */
  height(): number
  /** Scene height of a pin's head at the current scale (pin icons sit on it, S04k). */
  headY(pin: GeoPin): number
  /**
   * Venue pins float `liftM` over their plot buildings (the game map style, S04m) or stand on
   * the ground (false, the default until the map style says otherwise).
   */
  setVenueLift(on: boolean): void
  /** Venues stand at their compact game-map points (S04n) or at their real points (false). */
  setCompact(on: boolean): void
  /** Where a pin stands now (local metres, x east, y north). */
  pointOf(pin: GeoPin): { readonly x: number; readonly y: number }
  /** Shows the selection ring under a pin, or hides it (null or an unknown id). */
  setSelected(id: string | null): void
  selectedId(): string | null
  /** The pin's ground point in scene space (x east, y up, z = -north). */
  groundOf(id: string): Vector3 | null
  /**
   * Every pin head in front of the camera, in CSS pixels relative to a viewport of `width` x
   * `height` (add the canvas offset for client coordinates).
   */
  screenPins(camera: Camera, width: number, height: number): ScreenPin[]
  dispose(): void
}

const _matrix = new Matrix4()
const _position = new Vector3()
const _scale = new Vector3()
const _identity = new Quaternion()
const _head = new Vector3()

/**
 * How much a pin glows at full night (S04f): a share of its own colour, so it stays readable
 * and tappable in the dark. Memorial (muted) and teaser pins never glow.
 */
export function pinGlow(
  pin: Pick<GeoPin, 'kind' | 'style'>,
  palette: ScenePalette,
  lift: number,
  out: Color,
): Color {
  if (pin.style !== 'normal') return out.setScalar(0)
  return out.set(pinColor(pin, palette)).multiplyScalar(lift)
}

/**
 * `nightGlow`: the shared night-glow uniform (src/scene/lighting/nightGlow.ts). Each pin's glow
 * is a per-instance `_emissive` attribute, so a muted pin in the same draw call stays unlit.
 */
export function buildPins(
  pins: readonly GeoPin[],
  palette: ScenePalette,
  config: Pick<SceneConfig, 'pins'>,
  groundY: number,
  gradientMap: Texture,
  nightGlow?: IUniform<number>,
): PinObjects {
  const settings = config.pins
  const group = new Group()
  group.name = 'pins'
  const byLook = {
    venue: pins.filter((pin) => pinLook(pin) === 'venue'),
    landmark: pins.filter((pin) => pinLook(pin) === 'landmark'),
    badge: pins.filter((pin) => pinLook(pin) === 'badge'),
  } as const satisfies Record<PinLook, GeoPin[]>
  const ordered = [
    ...pins.filter((pin) => pin.kind === 'venue'),
    ...pins.filter((pin) => pin.kind === 'landmark'),
  ]
  let venueLift = false
  let compact = false
  const baseY = (pin: GeoPin) =>
    groundY + settings.liftM + (pin.kind === 'venue' && !venueLift ? 0 : (pin.liftM ?? 0))

  // White base colour: the instance colour carries each pin's style.
  const material = new MeshToonMaterial({ color: new Color(1, 1, 1), gradientMap })
  if (nightGlow !== undefined) patchNightGlow(material, 'attribute', { uniform: nightGlow })
  const geometries = {
    venue: buildVenuePinGeometry(settings.radialSegments),
    landmark: buildLandmarkPinGeometry(),
    badge: buildBadgePinGeometry(),
  }
  const meshes = {} as Record<PinLook, InstancedMesh>
  const color = new Color()
  for (const look of PIN_LOOKS) {
    const list = byLook[look]
    const mesh = new InstancedMesh(geometries[look], material, Math.max(1, list.length))
    mesh.count = list.length
    // A look with no pins (every modelled landmark now wears a badge, S07c) never draws, so it
    // never compiles a program variant of its own (instancing without instance colours, and its
    // shadow depth pass on high).
    mesh.visible = list.length > 0
    mesh.name = `pins-${look}`
    list.forEach((pin, i) => mesh.setColorAt(i, color.set(pinColor(pin, palette))))
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true
    if (nightGlow !== undefined) {
      const glow = new Float32Array(Math.max(1, list.length) * 3)
      list.forEach((pin, i) =>
        pinGlow(pin, palette, settings.nightGlow, color).toArray(glow, i * 3),
      )
      geometries[look].setAttribute(NIGHT_GLOW_ATTRIBUTE, new InstancedBufferAttribute(glow, 3))
    }
    meshes[look] = mesh
    group.add(mesh)
  }

  const ringGeometry = new RingGeometry(
    settings.ringRadius * 0.7,
    settings.ringRadius,
    settings.ringSegments,
  )
  ringGeometry.rotateX(LAY_FLAT_X)
  ringGeometry.deleteAttribute('uv')
  const ringMaterial = new MeshBasicMaterial({ color: palette.pins.selected })
  const ring = new Mesh(ringGeometry, ringMaterial)
  ring.name = 'pin-selection'
  ring.visible = false
  group.add(ring)

  const byId = new Map(ordered.map((pin) => [pin.id, pin]))
  let height = 0
  let scaledFor = 0
  let selected: string | null = null

  const placeRing = () => {
    const pin = selected === null ? undefined : byId.get(selected)
    ring.visible = pin !== undefined
    if (pin === undefined) return
    const at = pinPoint(pin, compact)
    ring.position.set(at.x, baseY(pin), -at.y)
    ring.scale.setScalar(height)
  }

  const writeMatrices = () => {
    _scale.setScalar(height)
    for (const look of PIN_LOOKS) {
      const mesh = meshes[look]
      byLook[look].forEach((pin, i) => {
        const at = pinPoint(pin, compact)
        _position.set(at.x, baseY(pin), -at.y)
        mesh.setMatrixAt(i, _matrix.compose(_position, _identity, _scale))
      })
      mesh.instanceMatrix.needsUpdate = true
      // Instanced bounds follow the instances, so frustum culling stays right after a rescale.
      mesh.computeBoundingSphere()
    }
    placeRing()
  }

  return {
    group,
    pins: ordered,
    applyDistance(distance) {
      const ratio =
        scaledFor === 0 ? Infinity : Math.max(distance / scaledFor, scaledFor / distance)
      if (ratio <= settings.rescaleRatio) return
      scaledFor = distance
      height = pinHeight(distance, settings)
      writeMatrices()
    },
    setVenueLift(on) {
      venueLift = on
      if (height > 0) writeMatrices()
    },
    setCompact(on) {
      if (compact === on) return
      compact = on
      if (height > 0) writeMatrices()
    },
    pointOf: (pin) => pinPoint(pin, compact),
    setSelected(id) {
      selected = id !== null && byId.has(id) ? id : null
      placeRing()
    },
    selectedId: () => selected,
    height: () => height,
    headY: (pin) => baseY(pin) + PIN_HEAD[pinLook(pin)] * height,
    groundOf(id) {
      const pin = byId.get(id)
      if (pin === undefined) return null
      const at = pinPoint(pin, compact)
      return new Vector3(at.x, groundY, -at.y)
    },
    screenPins(camera, width, height_) {
      const out: ScreenPin[] = []
      // A tap can land before the frame that follows a camera move has rendered.
      camera.updateMatrixWorld()
      for (const pin of ordered) {
        const at = pinPoint(pin, compact)
        _head.set(at.x, baseY(pin) + PIN_HEAD[pinLook(pin)] * height, -at.y).project(camera)
        // Behind the camera or beyond the far plane: not on screen.
        if (_head.z < -1 || _head.z > 1) continue
        out.push({
          id: pin.id,
          x: ((_head.x + 1) / 2) * width,
          y: ((1 - _head.y) / 2) * height_,
        })
      }
      return out
    },
    dispose() {
      for (const geometry of Object.values(geometries)) geometry.dispose()
      for (const mesh of Object.values(meshes)) mesh.dispose()
      material.dispose()
      ringGeometry.dispose()
      ringMaterial.dispose()
    },
  }
}
