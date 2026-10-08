import { BufferAttribute, BufferGeometry, Color, Matrix4 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import blenderModelsJson from '@data/landmarks/blender.derived.json'
import { buildLandmarksLayer } from '@/lib/world/landmarksLayer'
import { litWindowUv } from '../props/mergeChunk'
import { glbLitUv } from '../landmarks/lod'
import { landmarkLevelFiles, toDistrictGeometry } from './landmarkLevels'

vi.mock('../props/mergeChunk', async (actual) => {
  const real = await actual<typeof import('../props/mergeChunk')>()
  return { ...real, litWindowUv: vi.fn(real.litWindowUv) }
})

/** A two-triangle quad as the model runtime hands it over (u8 colour, `_emissive` on two). */
function model() {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3),
  )
  geometry.setAttribute(
    'normal',
    new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
  )
  geometry.setAttribute(
    'color',
    new BufferAttribute(new Uint8Array([255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0]), 3, true),
  )
  geometry.setAttribute(
    '_emissive',
    new BufferAttribute(new Uint8Array([0, 0, 0, 0, 0, 0, 255, 200, 0, 255, 200, 0]), 3, true),
  )
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  return { geometry, matrix: new Matrix4().makeRotationY(Math.PI / 2).setPosition(10, 0, 0) }
}

describe('toDistrictGeometry (S07c)', () => {
  it('writes exactly the district attribute layout', () => {
    const out = toDistrictGeometry(model(), { u: 0.25, v: 0.75 }, null)
    expect(Object.keys(out.attributes).sort()).toEqual(['color', 'normal', 'position', 'uv'])
    expect(out.getAttribute('position').array).toBeInstanceOf(Float32Array)
    expect(out.getAttribute('normal').array).toBeInstanceOf(Float32Array)
    expect(out.getAttribute('uv').array).toBeInstanceOf(Float32Array)
    const color = out.getAttribute('color')
    expect(color.array).toBeInstanceOf(Uint8Array)
    expect(color.itemSize).toBe(3)
    expect(color.normalized).toBe(true)
    expect(Array.from(out.getIndex()?.array ?? [])).toEqual([0, 1, 2, 0, 2, 3])
  })

  it('applies the node transform to positions and normals', () => {
    const out = toDistrictGeometry(model(), null, null)
    const position = out.getAttribute('position')
    // (1, 0, 0) turned a quarter about y lands on (0, 0, -1), then moves 10 east.
    expect(position.getX(1)).toBeCloseTo(10)
    expect(position.getZ(1)).toBeCloseTo(-1)
    const normal = out.getAttribute('normal')
    expect(normal.getX(0)).toBeCloseTo(1)
    expect(normal.getZ(0)).toBeCloseTo(0)
  })

  it('gives glowing vertices the lit window uv and every other vertex a wall texel', () => {
    const uv = toDistrictGeometry(model(), { u: 0.25, v: 0.75 }, null).getAttribute('uv')
    expect([uv.getX(0), uv.getY(0), uv.getX(1), uv.getY(1)]).toEqual([0, 0, 0, 0])
    expect([uv.getX(2), uv.getY(2), uv.getX(3), uv.getY(3)]).toEqual([0.25, 0.75, 0.25, 0.75])
    const dark = toDistrictGeometry(model(), null, null).getAttribute('uv')
    expect(Array.from(dark.array).every((value) => value === 0)).toBe(true)
  })

  it('keeps colours as authored, or dims them toward the teaser colour', () => {
    const plain = toDistrictGeometry(model(), null, null).getAttribute('color')
    expect([plain.array[0], plain.array[1], plain.array[2]]).toEqual([255, 0, 0])
    const dim = { color: new Color(0, 0, 1), mix: 0.5 }
    const dimmed = toDistrictGeometry(model(), null, dim).getAttribute('color')
    expect([dimmed.array[0], dimmed.array[1], dimmed.array[2]]).toEqual([128, 0, 128])
  })
})

describe('landmarkLevelFiles (S07c)', () => {
  it('has the four shipped levels of every landmark /geo/base marks as a Blender model', () => {
    const served = buildLandmarksLayer().models.filter((entry) => entry.glb !== undefined)
    expect(served).toHaveLength(blenderModelsJson.landmarks.length)
    for (const entry of served) {
      const files = blenderModelsJson.landmarks.find((landmark) => landmark.id === entry.id)?.files
      expect(landmarkLevelFiles(entry.id), entry.id).toEqual(files)
      expect(landmarkLevelFiles(entry.id), entry.id).toHaveLength(4)
    }
    expect(landmarkLevelFiles('no-such-landmark')).toBeUndefined()
  })

  it('serves no exclusions to the client (the geo build reads them)', () => {
    for (const entry of buildLandmarksLayer().models) {
      expect(entry.frame, entry.id).not.toHaveProperty('exclusion')
      expect(entry.frame, entry.id).not.toHaveProperty('grounds')
    }
  })
})

describe('the memorial on the district material (S07c, S04f)', () => {
  it('converts with no lit uv: every vertex samples a wall texel, litWindowUv never called', () => {
    const glowing = model()
    // Even were every vertex marked to glow, a memorial lights none.
    glowing.geometry.setAttribute(
      '_emissive',
      new BufferAttribute(new Uint8Array(12).fill(255), 3, true),
    )
    vi.mocked(litWindowUv).mockClear()
    const litUv = glbLitUv({ category: 'memorial', style: 'normal' }, { u: 0.375, v: 0.125 })
    const uv = toDistrictGeometry(glowing, litUv, null).getAttribute('uv')
    expect(Array.from(uv.array).every((value) => value === 0)).toBe(true)
    expect(litWindowUv).not.toHaveBeenCalled()
  })
})
