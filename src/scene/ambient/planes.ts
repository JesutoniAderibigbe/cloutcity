/**
 * The sky's three.js side (S04q): the airliners and helicopter of src/lib/world/ambient/planes.ts,
 * loaded by the living city on demand in a chunk of its own (`cc-feature:ambient-planes`, never
 * precached, src/lib/pwa/lazyChunks.ts).
 *
 * The aircraft are tiny low-poly meshes built here in code (no model to load): an airliner is a
 * fuselage, swept wings, tailplane, fin and two engines, a helicopter a cabin, tail boom, skids
 * and a two-blade rotor. Each part group is one InstancedMesh:
 * - bodies, the airliners' livery (fin and engines) and the rotor draw with the living city's
 *   material (the blocks' program, instance colours);
 * - the lamps (red port and green starboard wingtips, white tail; the white strobes; the
 *   helicopter's red beacon) draw with the map pins' material recipe: instanced toon, white,
 *   glowing at night from the `_emissive` attribute (src/scene/lighting/nightGlow.ts), so three
 *   reuses the pins' compiled program. The steady lamps glow per vertex; the strobes and the
 *   beacon blink per instance (their `_emissive` is an instance attribute).
 * No new shader program, at most 7 draw calls, a few hundred triangles. Nothing is pickable.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Euler,
  Frustum,
  Group,
  InstancedBufferAttribute,
  Matrix4,
  MeshToonMaterial,
  Quaternion,
  Sphere,
  Vector3,
  type Camera,
  type IUniform,
  type InstancedMesh,
  type Material,
  type Texture,
} from 'three'
import { createPlaneSim, type AircraftSample } from '@/lib/world/ambient/planes'
import type { AmbientTier, PlanesConfig } from '@/lib/world/ambient/types'
import { NIGHT_GLOW_ATTRIBUTE, patchNightGlow } from '../lighting/nightGlow'
import { kitMeshes, type KitMeshes } from './layer'

/** Marker text the budget's optional-chunk filter finds in this chunk (lazyChunks.ts). */
export const PLANES_FEATURE = 'cc-feature:ambient-planes'

export interface PlaneLayerOptions {
  readonly tier: AmbientTier
  readonly config: PlanesConfig
  /** ambient.json `seed`: the passing flights' draws. */
  readonly seed: number
  /** The living city's material (AmbientLayer.material): the blocks' program. */
  readonly material: Material
  /** The toon ramp the pins' material uses (the blocks' gradient map). */
  readonly gradientMap: Texture | null
  /** The shared night-glow uniform (absent: the lamps never glow). */
  readonly nightGlow?: IUniform<number>
  readonly groundY: number
}

export interface PlaneUpdate {
  readonly tS: number
  readonly camera: Camera
  readonly distance: number
  readonly targetX: number
  readonly targetY: number
}

export interface PlaneView {
  readonly planes: number
  readonly helicopters: number
  readonly drawCalls: number
  readonly triangles: number
}

export interface PlaneLayer {
  readonly group: Group
  /** The lamps' material (the pins' recipe). */
  readonly lampMaterial: Material
  update(input: PlaneUpdate): PlaneView
  meshes(): readonly InstancedMesh[]
  dispose(): void
}

type Part = [geometry: BufferGeometry, glow?: Color]

/** One non-indexed geometry from parts (position, normal and, when any glows, `_emissive`). */
function merge(parts: readonly Part[]): BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const glows: number[] = []
  const anyGlow = parts.some(([, glow]) => glow !== undefined)
  for (const [part, glow] of parts) {
    const flat = part.index === null ? part : part.toNonIndexed()
    const p = flat.getAttribute('position')
    const n = flat.getAttribute('normal')
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i))
      normals.push(n.getX(i), n.getY(i), n.getZ(i))
      if (anyGlow) glows.push(glow?.r ?? 0, glow?.g ?? 0, glow?.b ?? 0)
    }
    if (flat !== part) flat.dispose()
    part.dispose()
  }
  const out = new BufferGeometry()
  out.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3))
  out.setAttribute('normal', new BufferAttribute(Float32Array.from(normals), 3))
  if (anyGlow)
    out.setAttribute(NIGHT_GLOW_ATTRIBUTE, new BufferAttribute(Float32Array.from(glows), 3))
  return out
}

const m4 = new Matrix4()
const at = (g: BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
  g.applyMatrix4(
    m4.compose(
      new Vector3(x, y, z),
      new Quaternion().setFromEuler(new Euler(rx, ry, rz)),
      new Vector3(1, 1, 1),
    ),
  )
const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d)

/** An airliner one unit long, nose +z, wings along x, belly on y = 0. */
function airliner(lamp: number, colors: { red: Color; green: Color; white: Color }) {
  const r = 0.055
  const body = merge([
    [at(new CylinderGeometry(r, r, 0.7, 8, 1), 0, r, 0, Math.PI / 2)],
    [at(new ConeGeometry(r, 0.14, 8), 0, r, 0.42, Math.PI / 2)],
    [at(new ConeGeometry(r, 0.16, 8), 0, r * 1.25, -0.43, -Math.PI / 2)],
    // Swept wings and tailplane.
    [at(box(0.46, 0.012, 0.11), 0.24, r * 0.7, 0.02, 0, 0.45)],
    [at(box(0.46, 0.012, 0.11), -0.24, r * 0.7, 0.02, 0, -0.45)],
    [at(box(0.15, 0.01, 0.06), 0.08, r * 1.4, -0.42, 0, 0.4)],
    [at(box(0.15, 0.01, 0.06), -0.08, r * 1.4, -0.42, 0, -0.4)],
  ])
  const livery = merge([
    [at(box(0.012, 0.13, 0.1), 0, r * 2.3, -0.42, -0.35)],
    [at(new CylinderGeometry(0.022, 0.02, 0.1, 6, 1), 0.17, r * 0.25, 0.1, Math.PI / 2)],
    [at(new CylinderGeometry(0.022, 0.02, 0.1, 6, 1), -0.17, r * 0.25, 0.1, Math.PI / 2)],
  ])
  // Port is the left wing: +x for a nose on +z.
  const nav = merge([
    [at(box(lamp, lamp, lamp), 0.45, r * 0.7, -0.09), colors.red],
    [at(box(lamp, lamp, lamp), -0.45, r * 0.7, -0.09), colors.green],
    [at(box(lamp, lamp, lamp), 0, r * 1.3, -0.52), colors.white],
  ])
  const strobes = merge([
    [at(box(lamp, lamp, lamp), 0.45, r * 0.7, -0.11)],
    [at(box(lamp, lamp, lamp), -0.45, r * 0.7, -0.11)],
    [at(box(lamp, lamp * 0.6, lamp), 0, 0, 0.05)],
  ])
  return { body, livery, nav, strobes }
}

/** A helicopter one unit long, nose +z, skids on y = 0; the rotor spins about its own y. */
function helicopter(lamp: number) {
  const body = merge([
    [at(box(0.24, 0.22, 0.4), 0, 0.2, 0.12)],
    [at(new ConeGeometry(0.11, 0.14, 6), 0, 0.2, 0.39, Math.PI / 2)],
    [at(box(0.05, 0.05, 0.5), 0, 0.24, -0.3)],
    [at(box(0.015, 0.14, 0.08), 0, 0.31, -0.53)],
    [at(box(0.02, 0.02, 0.42), 0.1, 0.01, 0.12)],
    [at(box(0.02, 0.02, 0.42), -0.1, 0.01, 0.12)],
    [at(box(0.025, 0.08, 0.025), 0, 0.33, 0.12)],
  ])
  const rotor = merge([[at(box(0.9, 0.008, 0.04), 0, 0, 0)], [at(box(0.04, 0.008, 0.9), 0, 0, 0)]])
  const beacon = merge([[at(box(lamp, lamp, lamp), 0, 0.33, -0.08)]])
  return { body, rotor, beacon }
}

const triangles = (g: BufferGeometry) => g.getAttribute('position').count / 3

export function createPlaneLayer(options: PlaneLayerOptions): PlaneLayer {
  const { config, tier, material, groundY } = options
  const group = new Group()
  group.name = 'ambient-planes'
  group.userData.feature = PLANES_FEATURE
  const lampMaterial = new MeshToonMaterial({
    color: new Color(1, 1, 1),
    gradientMap: options.gradientMap,
  })
  if (options.nightGlow !== undefined) {
    patchNightGlow(lampMaterial, 'attribute', { uniform: options.nightGlow })
  }
  const colors = {
    red: new Color(config.colors.red),
    green: new Color(config.colors.green),
    white: new Color(config.colors.white),
  }
  const sim = createPlaneSim(config, tier, options.seed)
  const planeCap = config.maxShown[tier]
  const heliCap = config.helicopters[tier]
  const lamp = config.lights.navM
  const jet = airliner(lamp, colors)
  const heli = helicopter(lamp * 1.6)

  const kit = (
    name: string,
    geometry: BufferGeometry,
    capacity: number,
    color: string,
    mat: Material,
  ): KitMeshes =>
    kitMeshes(
      `plane-${name}`,
      [{ bucket: name, geometry, color }],
      capacity,
      mat,
      new Set(),
      triangles(geometry),
    )
  /** A per-instance `_emissive` attribute: the lamps that blink. */
  const blinking = (geometry: BufferGeometry, capacity: number) => {
    const glow = new InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * 3), 3)
    glow.setUsage(DynamicDrawUsage)
    geometry.setAttribute(NIGHT_GLOW_ATTRIBUTE, glow)
    return glow
  }
  const strobeGlow = blinking(jet.strobes, planeCap)
  const beaconGlow = blinking(heli.beacon, Math.max(1, heliCap))
  const kits = {
    body: kit('body', jet.body, planeCap, config.colors.body, material),
    livery: kit('livery', jet.livery, planeCap, config.colors.accent, material),
    nav: kit('nav', jet.nav, planeCap, config.colors.lamp, lampMaterial),
    strobes: kit('strobes', jet.strobes, planeCap, config.colors.lamp, lampMaterial),
    heli: kit('heli', heli.body, heliCap, config.colors.helicopter, material),
    rotor: kit('rotor', heli.rotor, heliCap, config.colors.lamp, material),
    beacon: kit('beacon', heli.beacon, heliCap, config.colors.lamp, lampMaterial),
  }
  const all = Object.values(kits)
  for (const k of all) for (const mesh of k.meshes) group.add(mesh)

  const frustum = new Frustum()
  const projection = new Matrix4()
  const sphere = new Sphere()
  const matrix = new Matrix4()
  const spin = new Matrix4()
  const position = new Vector3()
  const scale = new Vector3()
  const quaternion = new Quaternion()
  const euler = new Euler(0, 0, 0, 'YXZ')
  const white = colors.white
  const red = colors.red

  const place = (k: KitMeshes, m: Matrix4) => {
    m.toArray(k.matrices.array, k.count * 16)
    k.count++
  }

  function update(input: PlaneUpdate): PlaneView {
    for (const k of all) k.count = 0
    const { camera } = input
    camera.updateMatrixWorld()
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    frustum.setFromProjectionMatrix(projection)
    const grow = Math.min(config.scale.max, Math.max(1, input.distance * config.scale.perDistance))
    const n = sim.collect(input.targetX, input.targetY, input.tS)
    let planes = 0
    let helicopters = 0
    for (let i = 0; i < n; i++) {
      const s: AircraftSample | undefined = sim.samples[i]
      if (s === undefined || s.fade <= 0) continue
      const isHeli = s.kind === 'helicopter'
      const size = (isHeli ? config.helicopter.lengthM : config.lengthM) * grow * s.fade
      position.set(s.x, groundY + s.alt, -s.y)
      sphere.center.copy(position)
      sphere.radius = size
      if (!frustum.intersectsSphere(sphere)) continue
      euler.set(-s.pitch, s.yaw, -s.bank)
      quaternion.setFromEuler(euler)
      scale.set(size, size, size)
      matrix.compose(position, quaternion, scale)
      if (isHeli) {
        if (kits.heli.count >= heliCap) continue
        const slot = kits.beacon.count
        const on = s.age % config.lights.beaconPeriodS < config.lights.beaconPeriodS / 2
        ;(on ? red : BLACK).toArray(beaconGlow.array, slot * 3)
        place(kits.heli, matrix)
        place(kits.beacon, matrix)
        spin.makeRotationY(s.age * config.helicopter.rotorHz * Math.PI * 2)
        spin.setPosition(0, 0.37, 0.12)
        place(kits.rotor, spin.premultiply(matrix))
        helicopters++
      } else {
        if (kits.body.count >= planeCap) continue
        const slot = kits.strobes.count
        const on = s.age % config.lights.strobePeriodS < config.lights.strobeOnS
        ;(on ? white : BLACK).toArray(strobeGlow.array, slot * 3)
        place(kits.body, matrix)
        place(kits.livery, matrix)
        place(kits.nav, matrix)
        place(kits.strobes, matrix)
        planes++
      }
    }
    strobeGlow.needsUpdate = true
    beaconGlow.needsUpdate = true
    let drawCalls = 0
    let tris = 0
    for (const k of all) {
      for (const mesh of k.meshes) {
        mesh.count = k.count
        mesh.visible = k.count > 0
      }
      if (k.count > 0) {
        k.matrices.needsUpdate = true
        drawCalls += k.meshes.length
        tris += k.triangles * k.count
      }
    }
    return { planes, helicopters, drawCalls, triangles: tris }
  }

  return {
    group,
    lampMaterial,
    update,
    meshes: () => all.flatMap((k) => k.meshes),
    dispose() {
      group.removeFromParent()
      for (const k of all) {
        for (const mesh of k.meshes) {
          mesh.geometry.dispose()
          mesh.dispose()
        }
      }
      lampMaterial.dispose()
    },
  }
}

const BLACK = new Color(0, 0, 0)
