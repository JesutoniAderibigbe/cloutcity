/**
 * Colour buckets for the living city (S04l, DEC-52 decision 7): splits a model's vertex-coloured
 * geometry into one geometry per colour bucket (a car's paint, glass and lights; a pedestrian's
 * skin, top, bottom and accent). Each bucket becomes one InstancedMesh on the blocks' instanced
 * toon material, which draws a per-instance colour and no vertex colours, so ambient life adds no
 * shader program: three shares the blocks' compiled program.
 *
 * The output is non-indexed, carries only `position` and `normal` (Float32, the model's node
 * transform baked in) and is deterministic: triangles keep their source order inside a bucket,
 * and buckets come back in the caller's `order`, empty ones left out.
 */
import { BufferAttribute, BufferGeometry, Color, Matrix3, Matrix4, Vector3 } from 'three'
import type { KitPart } from '@/lib/world/ambient/types'

/** What a classifier sees of one triangle: its mean colour and its `_slot` value. */
export interface BucketTriangle {
  /** Mean vertex colour, linear RGB 0..1 (three's working space; white when uncoloured). */
  readonly r: number
  readonly g: number
  readonly b: number
  /** `_slot` of the triangle's first corner (0 = fixed colour, slot index + 1 otherwise). */
  readonly slot: number
}

/** The bucket a triangle joins, or null to drop it. */
export type BucketClassifier<B extends string> = (triangle: BucketTriangle) => B | null

export interface SplitOptions<B extends string> {
  /** Buckets in output order. A classifier result outside it throws. */
  readonly order: readonly B[]
  /** Applied to every position (normals get its normal matrix): a static model's node matrix. */
  readonly matrix?: Matrix4
  /** Recompute flat normals from the (transformed) triangles instead of keeping the source's. */
  readonly flatNormals?: boolean
}

export interface BucketGeometry<B extends string> extends KitPart<B, BufferGeometry> {
  readonly triangles: number
}

/** Linear-RGB mean → sRGB hex (`#rrggbb`), the way KitPart colours are written. */
export function linearToHex(r: number, g: number, b: number): string {
  return `#${new Color(r, g, b).getHexString()}`
}

/**
 * Splits `geometry` (indexed or not; `color` and `_slot` optional) into colour buckets.
 * Positions may be quantized (normalised integers): they are read through the attribute's own
 * denormalisation and written as Float32 after `matrix`, so nothing clamps.
 */
export function splitIntoBuckets<B extends string>(
  geometry: BufferGeometry,
  classify: BucketClassifier<B>,
  options: SplitOptions<B>,
): BucketGeometry<B>[] {
  const position = geometry.getAttribute('position')
  if (position === undefined) throw new Error('splitIntoBuckets needs a position attribute')
  const normal = geometry.getAttribute('normal')
  const color = geometry.getAttribute('color')
  const slot = geometry.getAttribute('_slot')
  const index = geometry.getIndex()
  const corners = index ? index.count : position.count
  const triangleCount = Math.floor(corners / 3)

  const rank = new Map(options.order.map((bucket, i) => [bucket, i]))
  // Pass 1: classify every triangle (and total its colour per bucket).
  const assigned = new Int32Array(triangleCount).fill(-1)
  const counts = new Array<number>(options.order.length).fill(0)
  const colourSum = options.order.map(() => [0, 0, 0])
  const corner = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k)
  for (let t = 0; t < triangleCount; t++) {
    let r = 0
    let g = 0
    let b = 0
    for (let k = 0; k < 3; k++) {
      const i = corner(t, k)
      r += color ? color.getX(i) : 1
      g += color ? color.getY(i) : 1
      b += color ? color.getZ(i) : 1
    }
    r /= 3
    g /= 3
    b /= 3
    const bucket = classify({ r, g, b, slot: slot ? slot.getX(corner(t, 0)) : 0 })
    if (bucket === null) continue
    const at = rank.get(bucket)
    if (at === undefined) throw new Error(`classifier returned unknown bucket "${bucket}"`)
    assigned[t] = at
    counts[at] = (counts[at] ?? 0) + 1
    const sum = colourSum[at]
    if (sum !== undefined) {
      sum[0] = (sum[0] ?? 0) + r
      sum[1] = (sum[1] ?? 0) + g
      sum[2] = (sum[2] ?? 0) + b
    }
  }

  const matrix = options.matrix
  const normalMatrix = matrix ? new Matrix3().getNormalMatrix(matrix) : undefined
  const v = new Vector3()
  const n = new Vector3()
  const a = new Vector3()
  const ab = new Vector3()
  const ac = new Vector3()
  const flat = options.flatNormals === true || normal === undefined

  // Pass 2: write each bucket's triangles, in source order.
  const out: BucketGeometry<B>[] = []
  options.order.forEach((bucket, at) => {
    const count = counts[at] ?? 0
    if (count === 0) return
    const positions = new Float32Array(count * 9)
    const normals = new Float32Array(count * 9)
    let w = 0
    for (let t = 0; t < triangleCount; t++) {
      if (assigned[t] !== at) continue
      for (let k = 0; k < 3; k++) {
        const i = corner(t, k)
        v.fromBufferAttribute(position, i)
        if (matrix) v.applyMatrix4(matrix)
        positions.set([v.x, v.y, v.z], w + k * 3)
        if (!flat && normal !== undefined) {
          n.fromBufferAttribute(normal, i)
          if (normalMatrix) n.applyMatrix3(normalMatrix)
          n.normalize()
          normals.set([n.x, n.y, n.z], w + k * 3)
        }
      }
      if (flat) faceNormal(positions, w, a, ab, ac, normals)
      w += 9
    }
    const part = new BufferGeometry()
    part.setAttribute('position', new BufferAttribute(positions, 3))
    part.setAttribute('normal', new BufferAttribute(normals, 3))
    part.computeBoundingBox()
    part.computeBoundingSphere()
    const sum = colourSum[at] ?? [0, 0, 0]
    out.push({
      bucket,
      geometry: part,
      triangles: count,
      color: linearToHex((sum[0] ?? 0) / count, (sum[1] ?? 0) / count, (sum[2] ?? 0) / count),
    })
  })
  return out
}

/** Writes the flat normal of the triangle at `offset` (9 floats) into all three corners. */
function faceNormal(
  positions: Float32Array,
  offset: number,
  a: Vector3,
  ab: Vector3,
  ac: Vector3,
  normals: Float32Array,
): void {
  a.fromArray(positions, offset)
  ab.fromArray(positions, offset + 3).sub(a)
  ac.fromArray(positions, offset + 6).sub(a)
  ab.cross(ac)
  const length = ab.length()
  if (length > 0) ab.divideScalar(length)
  else ab.set(0, 1, 0)
  for (let k = 0; k < 3; k++) normals.set([ab.x, ab.y, ab.z], offset + k * 3)
}

/** Bounds over every part (metres, model space). */
export function partsBounds(parts: readonly { readonly geometry: BufferGeometry }[]): {
  readonly min: Vector3
  readonly max: Vector3
} {
  const min = new Vector3(Infinity, Infinity, Infinity)
  const max = new Vector3(-Infinity, -Infinity, -Infinity)
  for (const part of parts) {
    const box = part.geometry.boundingBox
    if (box === null) continue
    min.min(box.min)
    max.max(box.max)
  }
  if (min.x > max.x) {
    min.set(0, 0, 0)
    max.set(0, 0, 0)
  }
  return { min, max }
}

/** Moves every part so the union stands centred on x and z with its lowest point on y = 0. */
export function groundParts(parts: readonly { readonly geometry: BufferGeometry }[]): void {
  const { min, max } = partsBounds(parts)
  const dx = -(min.x + max.x) / 2
  const dy = -min.y
  const dz = -(min.z + max.z) / 2
  if (dx === 0 && dy === 0 && dz === 0) return
  for (const part of parts) {
    part.geometry.translate(dx, dy, dz)
    part.geometry.computeBoundingSphere()
  }
}
