/**
 * The colour-bucket splitter (S04l): one geometry per bucket, positions and normals only, the
 * node matrix baked in without clamping quantized positions, deterministic order.
 */
import { BufferAttribute, BufferGeometry, Matrix4 } from 'three'
import { describe, expect, it } from 'vitest'
import { groundParts, linearToHex, partsBounds, splitIntoBuckets } from './buckets'

type Bucket = 'red' | 'blue' | 'rest'
const ORDER: readonly Bucket[] = ['red', 'blue', 'rest']

/** Three triangles: red (slot 1), blue, grey; indexed, with normalised-int positions. */
function sample(): BufferGeometry {
  const geometry = new BufferGeometry()
  // Quantized positions (Int16 normalised), as the asset build writes them.
  const q = (v: number) => Math.round(v * 32767)
  const positions = new Int16Array(
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, -1, 1, 0, -1, 0, 1, -1].map(q),
  )
  geometry.setAttribute('position', new BufferAttribute(positions, 3, true))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(27).fill(0), 3))
  for (let i = 0; i < 9; i++) geometry.getAttribute('normal').setXYZ(i, 0, 0, 1)
  const colours = new Uint8Array([
    ...[255, 0, 0, 255, 0, 0, 255, 0, 0],
    ...[0, 0, 255, 0, 0, 255, 0, 0, 255],
    ...[128, 128, 128, 128, 128, 128, 128, 128, 128],
  ])
  geometry.setAttribute('color', new BufferAttribute(colours, 3, true))
  geometry.setAttribute(
    '_slot',
    new BufferAttribute(new Uint8Array([1, 1, 1, 0, 0, 0, 0, 0, 0]), 1),
  )
  geometry.setIndex([0, 1, 2, 3, 4, 5, 6, 7, 8])
  return geometry
}

const classify = ({ r, b, slot }: { r: number; b: number; slot: number }): Bucket =>
  slot === 1 && r > 0.9 ? 'red' : b > 0.9 ? 'blue' : 'rest'

describe('splitIntoBuckets', () => {
  it('puts each triangle in its bucket, in the given order, with its mean colour', () => {
    const parts = splitIntoBuckets(sample(), classify, { order: ORDER })
    expect(parts.map((part) => [part.bucket, part.triangles, part.color])).toEqual([
      ['red', 1, '#ff0000'],
      ['blue', 1, '#0000ff'],
      ['rest', 1, linearToHex(128 / 255, 128 / 255, 128 / 255)],
    ])
    for (const part of parts) {
      expect(Object.keys(part.geometry.attributes).sort()).toEqual(['normal', 'position'])
      expect(part.geometry.index).toBeNull()
      expect(part.geometry.getAttribute('position').array).toBeInstanceOf(Float32Array)
    }
  })

  it('bakes the node matrix into Float32 positions (no clamping of quantized values)', () => {
    const matrix = new Matrix4().makeScale(4, 4, 4).setPosition(10, 0, 0)
    const [red] = splitIntoBuckets(sample(), classify, { order: ORDER, matrix })
    const position = red?.geometry.getAttribute('position')
    expect(position?.getX(1)).toBeCloseTo(14, 3)
    expect(position?.getY(2)).toBeCloseTo(4, 3)
    expect(red?.geometry.getAttribute('normal').getZ(0)).toBeCloseTo(1, 6)
  })

  it('leaves empty buckets out and drops triangles classified null', () => {
    const parts = splitIntoBuckets(sample(), ({ slot }) => (slot === 1 ? 'red' : null), {
      order: ORDER,
    })
    expect(parts.map((part) => part.bucket)).toEqual(['red'])
  })

  it('throws on a bucket outside the order', () => {
    expect(() => splitIntoBuckets(sample(), () => 'green' as Bucket, { order: ORDER })).toThrow(
      /unknown bucket "green"/,
    )
  })

  it('recomputes flat normals when asked or when the source has none', () => {
    const geometry = sample()
    geometry.deleteAttribute('normal')
    const parts = splitIntoBuckets(geometry, classify, { order: ORDER })
    // The blue triangle lies in the z = 1 plane, wound counter-clockwise seen from +z.
    const blue = parts.find((part) => part.bucket === 'blue')
    expect(blue?.geometry.getAttribute('normal').getZ(0)).toBeCloseTo(1, 4)
    const flat = splitIntoBuckets(sample(), classify, { order: ORDER, flatNormals: true })
    expect(flat[0]?.geometry.getAttribute('normal').getZ(2)).toBeCloseTo(1, 4)
  })

  it('is deterministic', () => {
    const a = splitIntoBuckets(sample(), classify, { order: ORDER })
    const b = splitIntoBuckets(sample(), classify, { order: ORDER })
    expect(a.map((part) => Array.from(part.geometry.getAttribute('position').array))).toEqual(
      b.map((part) => Array.from(part.geometry.getAttribute('position').array)),
    )
  })

  it('treats an uncoloured geometry as white and works without an index', () => {
    const geometry = sample().toNonIndexed()
    geometry.deleteAttribute('color')
    const parts = splitIntoBuckets(geometry, () => 'rest' as const, { order: ORDER })
    expect(parts).toHaveLength(1)
    expect(parts[0]?.triangles).toBe(3)
    expect(parts[0]?.color).toBe('#ffffff')
  })
})

describe('groundParts', () => {
  it('centres the union on x and z and stands it on y = 0', () => {
    const matrix = new Matrix4().makeTranslation(5, 2, -3)
    const parts = splitIntoBuckets(sample(), classify, { order: ORDER, matrix })
    groundParts(parts)
    const { min, max } = partsBounds(parts)
    expect(min.y).toBeCloseTo(0, 6)
    expect(min.x + max.x).toBeCloseTo(0, 6)
    expect(min.z + max.z).toBeCloseTo(0, 6)
  })
})
