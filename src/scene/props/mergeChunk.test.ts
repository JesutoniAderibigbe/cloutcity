import { BoxGeometry, BufferAttribute, Matrix4 } from 'three'
import { describe, expect, it } from 'vitest'
import { scene } from '@/lib/data/config'
import type { Placement } from '@/lib/world/streetProps'
import { buildDistrictGeometry } from '../buildings/buildDistrict'
import { createWindowMask } from '../buildings/materials'
import { litWindowUv, mergeChunk, type PropModel } from './mergeChunk'

/** A 1 m box standing on the ground; its top four vertices carry `_emissive` when `glows`. */
function boxModel(glow: boolean, emissiveTop = true): PropModel {
  const geometry = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
  const count = geometry.getAttribute('position').count
  const colors = new Uint8Array(count * 3).fill(128)
  geometry.setAttribute('color', new BufferAttribute(colors, 3, true))
  const emissive = new Uint8Array(count * 3)
  const position = geometry.getAttribute('position')
  for (let i = 0; i < count; i++) {
    if (emissiveTop && position.getY(i) > 0.99) emissive.set([255, 200, 100], i * 3)
  }
  geometry.setAttribute('_emissive', new BufferAttribute(emissive, 3, true))
  geometry.deleteAttribute('uv')
  return { geometry, matrix: new Matrix4(), glow }
}

const at = (model: string, x: number, y: number, rotation = 0, lift = 0): Placement => ({
  rule: 'streetlight',
  model,
  x,
  y,
  rotation,
  lift,
})
const mask = createWindowMask(scene.buildings)
const lit = litWindowUv(mask, scene.buildings.windowTileCells)!
const noStep = async () => undefined

describe('litWindowUv', () => {
  it('points at a fully lit texel of the window mask', () => {
    const data = mask.image.data as Uint8Array
    const size = mask.image.width
    const texel = data[Math.floor(lit.v * size) * size + Math.floor(lit.u * size)]
    expect(texel).toBe(255)
    // uv (0, 0), where every other prop vertex samples, is wall; an unlit mask lights nothing.
    expect(data[0]).toBe(0)
    expect(litWindowUv({ image: { data: new Uint8Array(64), width: 8 } }, 4)).toBeNull()
  })
})

describe('mergeChunk', () => {
  const models = new Map([
    ['streetlight', boxModel(true)],
    ['bench', boxModel(false)],
  ])

  it('writes exactly the district geometry attributes, so the district program draws it', async () => {
    const merged = await mergeChunk([at('streetlight', 0, 0)], models, 2, lit, noStep)
    const district = await buildDistrictGeometry(
      [
        {
          h: 10,
          prominence: 1,
          rings: [
            [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
            ],
          ],
        },
      ],
      0,
      { walls: ['#808080'], roof: '#606060', jitter: 0, windowTile: { u: 16, v: 13.2 } },
      noStep,
    )
    const signature = (g: typeof merged.geometry) =>
      Object.entries(g.attributes).map(([name, a]) => {
        const attribute = a as BufferAttribute
        return [name, attribute.itemSize, attribute.normalized, attribute.array.constructor.name]
      })
    expect(signature(merged.geometry)).toEqual(signature(district.geometry))
    expect(Object.keys(merged.geometry.attributes).sort()).toEqual([
      'color',
      'normal',
      'position',
      'uv',
    ])
  })

  it('moves each model into place on the land top and counts instances and triangles', async () => {
    const merged = await mergeChunk(
      [at('bench', 100, 50), at('bench', -20, 0, Math.PI / 2, 30), at('missing', 0, 0)],
      models,
      2,
      lit,
      noStep,
    )
    expect(merged.instances).toEqual({ bench: 2 })
    expect(merged.triangles).toBe(24)
    merged.geometry.computeBoundingBox()
    const box = merged.geometry.boundingBox
    // Scene z is minus local north; the second bench stands on a 30 m roof.
    expect(box?.min.x).toBeCloseTo(-20.5)
    expect(box?.max.x).toBeCloseTo(100.5)
    expect(box?.min.y).toBeCloseTo(2)
    expect(box?.max.y).toBeCloseTo(33)
    expect(box?.min.z).toBeCloseTo(-50.5)
  })

  it("gives only a glowing model's emissive vertices the lit window uv", async () => {
    const merged = await mergeChunk(
      [at('streetlight', 0, 0), at('bench', 10, 0)],
      models,
      0,
      lit,
      noStep,
    )
    const uv = merged.geometry.getAttribute('uv')
    const lamp = 24
    let litCount = 0
    for (let i = 0; i < uv.count; i++) {
      const isLit = uv.getX(i) === lit.u && uv.getY(i) === lit.v
      if (isLit) {
        litCount++
        expect(i).toBeLessThan(lamp)
      } else {
        expect([uv.getX(i), uv.getY(i)]).toEqual([0, 0])
      }
    }
    // A box's top face: 4 vertices, plus the top edge of each of its 4 sides (2 each).
    expect(litCount).toBe(12)
    expect(merged.glowVertices).toBe(12)
  })

  it('keeps colours as linear bytes and normals unit length after a turn', async () => {
    const merged = await mergeChunk([at('bench', 0, 0, 1.1)], models, 0, lit, noStep)
    const color = merged.geometry.getAttribute('color')
    expect(color.array[0]).toBe(128)
    const normal = merged.geometry.getAttribute('normal')
    for (let i = 0; i < normal.count; i++) {
      expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 5)
    }
  })
})
