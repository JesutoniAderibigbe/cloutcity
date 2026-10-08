/**
 * One chunk of street props as one merged mesh on the district material (S04i, D1): every
 * placement's model geometry, moved into place and written with exactly the district geometry's
 * attributes (position and normal float32, uv float32, colour normalised uint8 RGB), so the
 * renderer draws it with the program the district buildings already compiled. Any other
 * attribute (the models' `_emissive`, `_SLOT`) is dropped; night glow instead comes from the
 * window mask: a glowing model's emissive vertices get the uv of a lit window
 * (`litWindowUv`), every other vertex uv (0, 0), a wall texel. three only, no React.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Euler,
  Matrix3,
  Matrix4,
  Quaternion,
  Vector3,
  type InterleavedBufferAttribute,
} from 'three'
import type { Placement } from '@/lib/world/streetProps'

/** A loaded static model, as src/scene/models/prepare.ts hands it over. */
export interface PropModel {
  readonly geometry: BufferGeometry
  /** The GLB mesh node's transform (scale, pivot): placement × matrix. */
  readonly matrix: Matrix4
  /** Its `_emissive` vertices glow at night (props.json `glowModels`). */
  readonly glow: boolean
}

export interface MergedChunk {
  readonly geometry: BufferGeometry
  readonly instances: Readonly<Record<string, number>>
  readonly triangles: number
  /** Vertices that sample a lit window (they glow at night). */
  readonly glowVertices: number
}

type Attribute = BufferAttribute | InterleavedBufferAttribute

/** The window mask as the district material samples it (materials.ts createWindowMask). */
export interface WindowMask {
  readonly image: { readonly data: ArrayLike<number> | null; readonly width: number }
}

/**
 * The uv of the centre of the first lit window (red 255) in the window mask, read from the mask
 * itself so it can never disagree with what the district material draws. Null when the mask has
 * no lit window.
 */
export function litWindowUv(
  mask: WindowMask,
  cells: number,
): { readonly u: number; readonly v: number } | null {
  const { data, width } = mask.image
  if (data === null) return null
  const cell = width / cells
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== 255) continue
    const cx = Math.floor((i % width) / cell)
    const cy = Math.floor(Math.floor(i / width) / cell)
    return { u: (cx + 0.5) / cells, v: (cy + 0.5) / cells }
  }
  return null
}

/** A linear 0..1 channel as a normalised byte (clamped and rounded, as buildDistrict.ts does). */
const toByte = (channel: number) => Math.min(255, Math.max(0, Math.round(channel * 255)))

const _place = new Matrix4()
const _normal = new Matrix3()
const _quaternion = new Quaternion()
const _euler = new Euler()
const _position = new Vector3()
const _unit = new Vector3(1, 1, 1)
const _v = new Vector3()

/** placement (on the land top, turned about +y) × the model's own node transform. */
export function placementMatrix(
  placement: Placement,
  groundY: number,
  model: Matrix4,
  out: Matrix4,
) {
  _position.set(placement.x, groundY + placement.lift, -placement.y)
  _quaternion.setFromEuler(_euler.set(0, placement.rotation, 0))
  return out.compose(_position, _quaternion, _unit).multiply(model)
}

function isEmissive(attribute: Attribute | undefined, index: number): boolean {
  if (attribute === undefined) return false
  return attribute.getX(index) + attribute.getY(index) + attribute.getZ(index) > 0
}

/**
 * Merges a chunk's placements. Awaits `step` after every placement, which yields once the
 * current slice has run long enough (src/scene/schedule.ts createSlicer).
 */
export async function mergeChunk(
  placements: readonly Placement[],
  models: ReadonlyMap<string, PropModel>,
  groundY: number,
  /** Where glowing vertices sample the mask; null: nothing glows. */
  litUv: { readonly u: number; readonly v: number } | null,
  step: () => Promise<void>,
): Promise<MergedChunk> {
  let vertexCount = 0
  let indexCount = 0
  const drawn: { placement: Placement; model: PropModel }[] = []
  for (const placement of placements) {
    const model = models.get(placement.model)
    if (model === undefined) continue
    drawn.push({ placement, model })
    vertexCount += model.geometry.getAttribute('position').count
    indexCount += model.geometry.index?.count ?? model.geometry.getAttribute('position').count
  }
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const colors = new Uint8Array(vertexCount * 3)
  const index = new Uint32Array(indexCount)
  const instances: Record<string, number> = {}
  let v = 0
  let i = 0
  let glowVertices = 0

  for (const { placement, model } of drawn) {
    instances[placement.model] = (instances[placement.model] ?? 0) + 1
    placementMatrix(placement, groundY, model.matrix, _place)
    _normal.getNormalMatrix(_place)
    const geometry = model.geometry
    const position = geometry.getAttribute('position') as Attribute
    const normal = geometry.getAttribute('normal') as Attribute | undefined
    const color = geometry.getAttribute('color') as Attribute | undefined
    const emissive = model.glow
      ? (geometry.getAttribute('_emissive') as Attribute | undefined)
      : undefined
    const first = v
    for (let k = 0; k < position.count; k++, v++) {
      _v.set(position.getX(k), position.getY(k), position.getZ(k)).applyMatrix4(_place)
      positions[v * 3] = _v.x
      positions[v * 3 + 1] = _v.y
      positions[v * 3 + 2] = _v.z
      if (normal === undefined) _v.set(0, 1, 0)
      else _v.set(normal.getX(k), normal.getY(k), normal.getZ(k)).applyMatrix3(_normal).normalize()
      normals[v * 3] = _v.x
      normals[v * 3 + 1] = _v.y
      normals[v * 3 + 2] = _v.z
      // glTF COLOR_0 is linear, as are the district's colour bytes (buildDistrict.ts toByte).
      colors[v * 3] = color === undefined ? 255 : toByte(color.getX(k))
      colors[v * 3 + 1] = color === undefined ? 255 : toByte(color.getY(k))
      colors[v * 3 + 2] = color === undefined ? 255 : toByte(color.getZ(k))
      if (litUv !== null && isEmissive(emissive, k)) {
        uvs[v * 2] = litUv.u
        uvs[v * 2 + 1] = litUv.v
        glowVertices++
      }
    }
    const source = geometry.index
    const count = source?.count ?? position.count
    for (let k = 0; k < count; k++) index[i++] = first + (source === null ? k : source.getX(k))
    await step()
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new BufferAttribute(colors, 3, true))
  geometry.setIndex(new BufferAttribute(index, 1))
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  return { geometry, instances, triangles: indexCount / 3, glowVertices }
}
