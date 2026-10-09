/**
 * A venue interior's own scene pieces (S43), next to the apartment's room shell and furniture
 * (buildApartment.ts draws those): the code-built pieces (the bar, the stools, the DJ booth, the
 * tables, string-light poles and wires, the skyline's towers), everything that glows (neon, the
 * LED wall, bottles, bulbs, the dance floor's tiles, lit windows) and the party lights' beams.
 *
 * Draw calls and programs stay flat however much a venue holds:
 * - every code-built part merges into one vertex-coloured mesh on the room shell's own material
 *   settings (toon, vertex colours, front faces: the shell's program);
 * - every glowing part is one instance of a unit box in one InstancedMesh with instance colours
 *   on a plain basic material; it animates by rewriting instance colours only (the dance floor's
 *   patterns, the beat's colour cycle, lamps by the night glow), never a new shader;
 * - the beams are one more InstancedMesh (transparent cones, additive), turned on the beat.
 *
 * Room space as the apartment's (buildRoom.ts): metres, x right, y up, z toward the open front.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  FrontSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Texture,
} from 'three'
import { hashString, seeded } from '@/lib/world/venueCrowd'
import { mergeParts, paintedPart, part, triangleCount } from '../apartment/parts'
import type { BuiltPart, DanceFloor, Skyline, StringLights, VenueInterior } from './data'

const noRaycast: Object3D['raycast'] = () => {}
const DISC_SEGMENTS = 14
const UP = new Vector3(0, 1, 0)
const FORWARD = new Vector3(0, 0, 1)
const ONE = new Vector3(1, 1, 1)

/** What the interior's lights show this frame. */
export interface VenueLightState {
  /** Seconds since the interior opened (the beat clock). */
  readonly timeS: number
  /** The venue is open now: the floor, panels and beams run. */
  readonly open: boolean
  /** 0 by day, 1 at full night (lamps, bulbs, windows). */
  readonly glow: number
  /** Reduced motion: colours hold still and the beams stop swinging. */
  readonly still: boolean
}

export interface VenueObjects {
  readonly group: Group
  /** Moves the lights on to `state`; returns whether anything changed (a frame is needed). */
  update(state: VenueLightState): boolean
  /** Triangles drawn by these pieces (the test hook adds the rest of the scene). */
  triangles(): number
  dispose(): void
}

type GlowRole =
  | { readonly kind: 'steady' }
  | { readonly kind: 'beat'; readonly cycle: readonly Color[]; readonly index: number }
  | { readonly kind: 'night'; readonly dark: Color }
  | { readonly kind: 'tile'; readonly col: number; readonly row: number }
  | { readonly kind: 'bulb'; readonly day: Color }
  | { readonly kind: 'window'; readonly day: Color; readonly lit: boolean }
  | { readonly kind: 'head'; readonly index: number }

interface GlowInstance {
  readonly matrix: Matrix4
  readonly color: Color
  readonly role: GlowRole
}

const scratchMatrix = new Matrix4()
const scratchQuat = new Quaternion()
const scratchPos = new Vector3()
const scratchScale = new Vector3()

function boxMatrix(at: readonly number[], size: readonly number[], yaw = 0): Matrix4 {
  scratchQuat.setFromAxisAngle(UP, yaw)
  return new Matrix4().compose(
    scratchPos.set(at[0] ?? 0, at[1] ?? 0, at[2] ?? 0),
    scratchQuat,
    scratchScale.set(size[0] ?? 1, size[1] ?? 1, size[2] ?? 1),
  )
}

/** One code-built part as a painted, non-indexed geometry in room space. */
function builtGeometry(built: BuiltPart): BufferGeometry {
  const [w, h, d] = built.size
  const geometry =
    built.shape === 'box'
      ? new BoxGeometry(w, h, d)
      : (() => {
          const disc = new CylinderGeometry(w / 2, w / 2, h, DISC_SEGMENTS)
          disc.scale(1, 1, d / w)
          return disc
        })()
  geometry.rotateY(built.yaw)
  geometry.translate(built.at[0], built.at[1], built.at[2])
  return paintedPart(geometry, built.color)
}

/** A thin box from `a` to `b` (a light strand's wire), painted `hex`. */
function segment(a: Vector3, b: Vector3, thickness: number, hex: string): BufferGeometry {
  const length = a.distanceTo(b)
  const box = new BoxGeometry(thickness, thickness, length)
  const direction = new Vector3().subVectors(b, a).normalize()
  const turn = new Quaternion().setFromUnitVectors(FORWARD, direction)
  box.applyMatrix4(
    new Matrix4().compose(new Vector3().addVectors(a, b).multiplyScalar(0.5), turn, ONE),
  )
  return paintedPart(box, hex)
}
/** The dance floor's tiles: one glow instance each, a hair above the floor. */
function danceTiles(floor: DanceFloor, out: GlowInstance[]): void {
  const gap = floor.tileM * floor.gapShare
  const size = [floor.tileM - gap, 0.02, floor.tileM - gap]
  for (let row = 0; row < floor.rows; row++) {
    for (let col = 0; col < floor.cols; col++) {
      out.push({
        matrix: boxMatrix(
          [floor.x0 + (col + 0.5) * floor.tileM, floor.liftM, floor.z0 + (row + 0.5) * floor.tileM],
          size,
        ),
        color: new Color(floor.dim),
        role: { kind: 'tile', col, row },
      })
    }
  }
}

/** The strands' poles and wires (merged) and their bulbs (glow instances). */
function stringLightParts(
  lights: StringLights,
  parts: BufferGeometry[],
  out: GlowInstance[],
): void {
  const tops = lights.poles.map(([x, z]) => new Vector3(x, lights.topM, z))
  for (const [x, z] of lights.poles) {
    parts.push(
      paintedPart(
        new BoxGeometry(0.08, lights.topM + 0.1, 0.08).translate(x, (lights.topM + 0.1) / 2, z),
        lights.wire,
      ),
    )
  }
  const day = new Color(lights.bulbDay)
  for (const [from, to] of lights.strands) {
    const a = tops[from]
    const b = tops[to]
    if (a === undefined || b === undefined) throw new Error('venue string lights: unknown pole')
    const length = a.distanceTo(b)
    const at = (t: number) =>
      new Vector3().lerpVectors(a, b, t).setY(lights.topM - lights.sagM * 4 * t * (1 - t))
    const pieces = Math.max(2, Math.ceil(length / 0.6))
    for (let i = 0; i < pieces; i++) {
      parts.push(segment(at(i / pieces), at((i + 1) / pieces), 0.025, lights.wire))
    }
    const bulbs = Math.max(1, Math.floor(length / lights.bulbSpacingM))
    for (let i = 1; i < bulbs; i++) {
      const point = at(i / bulbs)
      out.push({
        matrix: boxMatrix(
          [point.x, point.y - 0.07, point.z],
          [lights.bulbM, lights.bulbM * 1.3, lights.bulbM],
        ),
        color: new Color(lights.bulb),
        role: { kind: 'bulb', day },
      })
    }
  }
}

/**
 * The skyline (a rooftop's view): towers seeded around the walls in `sides`, their feet far
 * below the deck, each with a cap and a grid of windows on the face toward the room.
 */
function skylineParts(
  skyline: Skyline,
  room: VenueInterior['room']['room'],
  parts: BufferGeometry[],
  out: GlowInstance[],
): void {
  const random = seeded(hashString(`skyline:${skyline.seed}`))
  const between = ([min, max]: readonly [number, number]) => min + random() * (max - min)
  const halfW = room.widthM / 2
  const halfD = room.depthM / 2
  const day = new Color(skyline.windowDay)
  for (let i = 0; i < skyline.count; i++) {
    const side = skyline.sides[i % skyline.sides.length] ?? 'back'
    const width = between(skyline.widthM)
    const depth = between(skyline.widthM)
    const height = between(skyline.heightM)
    const gap = between(skyline.gapM)
    let x: number
    let z: number
    // Which way the tower's room-facing side looks (its windows), about the vertical.
    let facing: number
    if (side === 'back') {
      x = -halfW - 6 + random() * (room.widthM + 12)
      z = -halfD - gap - depth / 2
      facing = 0
    } else {
      x = (side === 'left' ? -1 : 1) * (halfW + gap + width / 2)
      // Side towers stand behind the deck's middle, never between the camera and the deck.
      z = -halfD - 6 + random() * (halfD + 4)
      facing = side === 'left' ? Math.PI / 2 : -Math.PI / 2
    }
    const color = skyline.colors[Math.floor(random() * skyline.colors.length)] ?? skyline.cap
    const total = height - skyline.baseM
    parts.push(
      paintedPart(
        new BoxGeometry(width, total, depth).translate(x, skyline.baseM + total / 2, z),
        color,
      ),
      paintedPart(
        new BoxGeometry(width * 0.9, 0.5, depth * 0.9).translate(x, height + 0.25, z),
        skyline.cap,
      ),
    )
    // The face toward the room: half the tower's extent along `facing`.
    const reach = side === 'back' ? depth / 2 : width / 2
    const across = side === 'back' ? width : depth
    const cellW = across / skyline.windowCols
    const cellH = Math.min(1.6, (total * 0.7) / skyline.windowRows)
    for (let r = 0; r < skyline.windowRows; r++) {
      for (let c = 0; c < skyline.windowCols; c++) {
        const along = -across / 2 + (c + 0.5) * cellW
        const y = height - 1 - (r + 0.5) * cellH
        if (y < skyline.baseM + 1) continue
        const offset = new Vector3(along, 0, reach + 0.02).applyAxisAngle(UP, facing)
        out.push({
          matrix: boxMatrix(
            [x + offset.x, y, z + offset.z],
            [cellW * 0.55, cellH * 0.55, 0.02],
            facing,
          ),
          color: new Color(skyline.window),
          role: { kind: 'window', day, lit: random() < 0.7 },
        })
      }
    }
  }
}

/** A beam: an open cone with its tip at the origin, opening downward. */
function beamGeometry(length: number, radius: number): BufferGeometry {
  const cone = new ConeGeometry(radius, length, 12, 1, true)
  // ConeGeometry's tip points up at +length/2: turn it over so it opens downward from the tip.
  cone.rotateX(Math.PI)
  cone.translate(0, -length / 2, 0)
  return cone
}

/** Builds the interior's own pieces; `beams` is the tier's beam count (0: none). */
export function buildVenue(
  interior: VenueInterior,
  gradientMap: Texture,
  beams: number,
  timing: { readonly tileBeats: number; readonly panelBeats: number; readonly closedGlow: number },
): VenueObjects {
  const group = new Group()
  group.name = 'venue-pieces'
  group.raycast = noRaycast

  const glows: GlowInstance[] = []
  const solid: BufferGeometry[] = []
  for (const built of interior.parts) {
    if (built.glow === null) {
      solid.push(builtGeometry(built))
      continue
    }
    const size =
      built.shape === 'disc'
        ? [built.size[0] * 0.8, built.size[1], built.size[2] * 0.8]
        : built.size
    const color = new Color(built.color)
    glows.push({
      matrix: boxMatrix(built.at, size, built.yaw),
      color,
      role:
        built.glow === 'beat'
          ? { kind: 'beat', cycle: built.cycle.map((hex) => new Color(hex)), index: built.index }
          : built.glow === 'night'
            ? { kind: 'night', dark: color.clone().multiplyScalar(0.22) }
            : { kind: 'steady' },
    })
  }
  if (interior.danceFloor !== null) danceTiles(interior.danceFloor, glows)
  if (interior.stringLights !== null) stringLightParts(interior.stringLights, solid, glows)
  if (interior.skyline !== null) {
    skylineParts(interior.skyline, interior.room.room, solid, glows)
  }
  const lights = interior.partyLights
  if (lights !== null) {
    lights.heads.forEach((head, index) => {
      glows.push({
        matrix: boxMatrix([head[0], head[1] - 0.08, head[2]], [0.18, 0.16, 0.18]),
        color: new Color(lights.colors[index % lights.colors.length] ?? lights.ball?.color ?? 0),
        role: { kind: 'head', index },
      })
    })
    if (lights.ball !== null) {
      const ball = part(new IcosahedronGeometry(lights.ball.radiusM, 1))
      ball.translate(lights.ball.at[0], lights.ball.at[1], lights.ball.at[2])
      solid.push(paintedPart(ball, lights.ball.color))
    }
  }

  const solidMaterial = new MeshToonMaterial({ vertexColors: true, gradientMap, side: FrontSide })
  const solidMesh =
    solid.length === 0 ? null : new Mesh(mergeParts(solid, 'venue pieces'), solidMaterial)
  if (solidMesh !== null) {
    solidMesh.name = 'venue-built'
    solidMesh.raycast = noRaycast
    solidMesh.receiveShadow = true
    group.add(solidMesh)
  }

  const glowGeometry = new BoxGeometry(1, 1, 1)
  const glowMaterial = new MeshBasicMaterial()
  const glowMesh = new InstancedMesh(glowGeometry, glowMaterial, Math.max(1, glows.length))
  glowMesh.name = 'venue-glow'
  glowMesh.raycast = noRaycast
  glowMesh.count = glows.length
  glowMesh.frustumCulled = false
  glows.forEach((glow, i) => {
    glowMesh.setMatrixAt(i, glow.matrix)
    glowMesh.setColorAt(i, glow.color)
  })
  glowMesh.instanceColor?.setUsage(DynamicDrawUsage)
  group.add(glowMesh)

  const beamCount = lights === null ? 0 : Math.min(beams, lights.heads.length)
  const beamMaterial = new MeshBasicMaterial({
    transparent: true,
    opacity: lights?.beamOpacity ?? 0,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  })
  const beamMesh =
    lights === null || beamCount === 0
      ? null
      : new InstancedMesh(
          beamGeometry(lights.beamLengthM, lights.beamRadiusM),
          beamMaterial,
          beamCount,
        )
  if (beamMesh !== null) {
    beamMesh.name = 'venue-beams'
    beamMesh.raycast = noRaycast
    beamMesh.frustumCulled = false
    beamMesh.renderOrder = 4
    beamMesh.instanceMatrix.setUsage(DynamicDrawUsage)
    beamMesh.visible = false
    group.add(beamMesh)
  }

  const beatS = 60 / interior.mood.bpm
  const floor = interior.danceFloor
  let lastKey = ''
  const scratchColor = new Color()
  const tileColors = floor?.colors.map((hex) => new Color(hex)) ?? []
  // Unlit heads and tiles fall back to black when there is no dance floor to take the dim from.
  const tileDim = floor === null ? new Color(0, 0, 0) : new Color(floor.dim)
  const headColors = lights?.colors.map((hex) => new Color(hex)) ?? []

  /** A dance-floor tile's colour on beat `beat` (a new pattern every four bars). */
  const tileColor = (col: number, row: number, beat: number, out: Color): Color => {
    if (floor === null || tileColors.length === 0) return out.copy(tileDim)
    const step = Math.floor(beat / timing.tileBeats)
    const pattern = Math.floor(step / 16) % 4
    const cx = (floor.cols - 1) / 2
    const cz = (floor.rows - 1) / 2
    let index: number
    let on = true
    switch (pattern) {
      case 0:
        index = (col + row + step) % tileColors.length
        on = (col + row + step) % 2 === 0
        break
      case 1:
        index = Math.floor(Math.hypot(col - cx, row - cz) - step) % tileColors.length
        break
      case 2:
        index = (Math.floor(col / 2) + Math.floor(row / 2) + step) % tileColors.length
        on = (Math.floor(col / 2) + Math.floor(row / 2) + step) % 2 === 0
        break
      default: {
        const sparkle = hashString(`${col}:${row}:${step}`)
        index = sparkle % tileColors.length
        on = sparkle % 3 !== 0
      }
    }
    const color = tileColors[((index % tileColors.length) + tileColors.length) % tileColors.length]
    return on && color !== undefined ? out.copy(color) : out.copy(tileDim)
  }

  const paint = (beat: number, open: boolean, glow: number) => {
    glows.forEach((instance, i) => {
      const { role } = instance
      switch (role.kind) {
        case 'steady':
          scratchColor.copy(instance.color)
          break
        case 'beat': {
          const cycle = role.cycle.length > 0 ? role.cycle : [instance.color]
          const step = Math.floor(beat / timing.panelBeats)
          const pick = cycle[(step + role.index) % cycle.length] ?? instance.color
          scratchColor.copy(pick)
          if (!open) scratchColor.copy(instance.color).multiplyScalar(timing.closedGlow)
          break
        }
        case 'night':
          scratchColor.copy(role.dark).lerp(instance.color, Math.max(glow, open ? 0.6 : 0))
          break
        case 'tile':
          if (open) tileColor(role.col, role.row, beat, scratchColor)
          else scratchColor.copy(tileDim)
          break
        case 'bulb':
          scratchColor.copy(role.day).lerp(instance.color, glow)
          break
        case 'window':
          scratchColor.copy(role.day).lerp(instance.color, role.lit ? glow : 0)
          break
        case 'head': {
          const pick = headColors[(beat + role.index) % Math.max(1, headColors.length)]
          scratchColor.copy(open && pick !== undefined ? pick : tileDim)
          break
        }
      }
      glowMesh.setColorAt(i, scratchColor)
    })
    if (glowMesh.instanceColor !== null) glowMesh.instanceColor.needsUpdate = true
    if (beamMesh !== null && lights !== null) {
      for (let b = 0; b < beamMesh.count; b++) {
        const pick = headColors[(beat + b) % Math.max(1, headColors.length)]
        if (pick !== undefined) beamMesh.setColorAt(b, pick)
      }
      if (beamMesh.instanceColor !== null) beamMesh.instanceColor.needsUpdate = true
    }
  }

  const aim = new Vector3()
  const tip = new Vector3()
  const swing = (timeS: number) => {
    if (beamMesh === null || lights === null) return
    for (let b = 0; b < beamMesh.count; b++) {
      const head = lights.heads[b]
      if (head === undefined) continue
      tip.set(head[0], head[1] - 0.16, head[2])
      const phase = timeS * (0.35 + 0.07 * b) + b * 1.7
      aim
        .set(
          lights.aim[0] + Math.sin(phase) * Math.tan(lights.swingRad) * head[1],
          lights.aim[1],
          lights.aim[2] + Math.cos(phase * 0.8) * Math.tan(lights.swingRad) * head[1] * 0.6,
        )
        .sub(tip)
        .normalize()
      // The cone opens along −y: turn −y onto the aim.
      scratchQuat.setFromUnitVectors(new Vector3(0, -1, 0), aim)
      beamMesh.setMatrixAt(b, scratchMatrix.compose(tip, scratchQuat, ONE))
    }
    beamMesh.instanceMatrix.needsUpdate = true
  }

  const triangles =
    (solidMesh === null ? 0 : triangleCount(solidMesh.geometry)) +
    glows.length * triangleCount(glowGeometry) +
    (beamMesh === null ? 0 : beamCount * triangleCount(beamMesh.geometry))

  return {
    group,
    update(state) {
      const beat = state.still ? 0 : Math.floor(state.timeS / beatS)
      const key = `${beat}:${state.open ? 1 : 0}:${Math.round(state.glow * 1000)}`
      let changed = false
      if (key !== lastKey) {
        lastKey = key
        paint(beat, state.open, state.glow)
        changed = true
      }
      if (beamMesh !== null) {
        const shown = state.open
        if (beamMesh.visible !== shown) {
          beamMesh.visible = shown
          changed = true
        }
        if (shown && (!state.still || beamMesh.userData.placed !== true)) {
          swing(state.still ? 0 : state.timeS)
          beamMesh.userData.placed = true
          changed = true
        }
      }
      return changed
    },
    triangles: () => triangles,
    dispose() {
      solidMesh?.geometry.dispose()
      solidMaterial.dispose()
      glowGeometry.dispose()
      glowMaterial.dispose()
      glowMesh.dispose()
      beamMesh?.geometry.dispose()
      beamMesh?.dispose()
      beamMaterial.dispose()
    },
  }
}
