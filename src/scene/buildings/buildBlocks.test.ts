import {
  Color,
  type InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Vector3,
} from 'three'
import { describe, expect, it } from 'vitest'
import { encodePath } from '@/lib/geo/codec'
import { ORIGIN, PROJECTION_ID } from '@/lib/geo/projection'
import {
  BLOCK_TRIANGLES,
  NO_FILL,
  TREE_TRIANGLES,
  buildBlockGeometry,
  buildBlocks,
  buildTreeGeometry,
  instancesPerBlock,
  type BlockFill,
} from './buildBlocks'
import { BlocksMiniSchema } from './schema'

const materials = { normal: new MeshBasicMaterial(), dimmed: new MeshBasicMaterial() }
const COLORS = { blocks: ['#9a9286', '#b5654a'], dimmed: '#5a5852', jitter: 0 }

/** Queens blocks in a row along x every 500 m, plus one Bronx block. */
const file = BlocksMiniSchema.parse({
  format: 'cc-blocks-v1',
  derived: true,
  notice: 'test',
  sources: ['dcp-mappluto-density'],
  projection: { id: PROJECTION_ID, originLat: ORIGIN.lat, originLng: ORIGIN.lng },
  tier: 'low',
  sizeM: 60,
  groups: [
    {
      borough: 'queens',
      angleDeg: 0,
      p: encodePath(Array.from({ length: 20 }, (_, i) => ({ x: i * 500, y: 0 }))),
      h: Array.from({ length: 20 }, () => 12),
    },
    { borough: 'bronx', angleDeg: 29, p: encodePath([{ x: 0, y: 3000 }]), h: [9] },
  ],
})

/** Camera 1500 m up over x = 0, looking down at the origin. */
function camera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(45, 1, 1, 100_000)
  cam.position.set(0, 1500, 1)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld()
  return cam
}

describe('block geometry', () => {
  it('is a floorless unit box of ten triangles', () => {
    const geometry = buildBlockGeometry()
    expect((geometry.index?.count ?? 0) / 3).toBe(BLOCK_TRIANGLES)
    geometry.computeBoundingBox()
    expect(geometry.boundingBox?.min.toArray()).toEqual([-0.5, 0, -0.5])
    expect(geometry.boundingBox?.max.toArray()).toEqual([0.5, 1, 0.5])
  })
})

describe('buildBlocks', () => {
  it('makes one instanced mesh per borough, dimmed land with the dimmed material, unpickable', () => {
    const blocks = buildBlocks(file, 30, COLORS, new Set(['bronx']), materials)
    const meshes = blocks.group.children
    expect(meshes.map((m) => m.name)).toEqual(['blocks-queens', 'blocks-bronx'])
    expect((meshes[1] as unknown as { material: unknown }).material).toBe(materials.dimmed)
    expect(blocks.view()).toEqual({
      total: 21,
      drawn: 0,
      triangles: 0,
      lots: 0,
      plates: 0,
      trees: 0,
    })
    blocks.dispose()
  })

  it('colours each block from the palette, and blocks on dimmed land with the dimmed colour', () => {
    const blocks = buildBlocks(file, 30, COLORS, new Set(['bronx']), materials)
    const above = new PerspectiveCamera(90, 1, 1, 100_000)
    above.position.set(5000, 8000, -1500)
    above.lookAt(5000, 0, -1500)
    above.updateMatrixWorld()
    blocks.cull(above, 100_000)
    const hexes = (name: string) => {
      const mesh = blocks.group.getObjectByName(name) as unknown as {
        count: number
        instanceColor: { array: Float32Array }
      }
      return new Set(
        Array.from(
          { length: mesh.count },
          (_, i) => `#${new Color().fromArray(mesh.instanceColor.array, i * 3).getHexString()}`,
        ),
      )
    }
    const queens = hexes('blocks-queens')
    // Twenty blocks in view: both palette colours appear, and nothing else.
    expect(queens).toEqual(new Set(COLORS.blocks))
    expect([...hexes('blocks-bronx')]).toEqual([COLORS.dimmed])
    blocks.dispose()
  })

  it('draws only blocks in the frustum and within the draw distance', () => {
    const blocks = buildBlocks(file, 30, COLORS, new Set(), materials)
    const near = blocks.cull(camera(), 100_000)
    expect(near.drawn).toBeGreaterThan(0)
    expect(near.drawn).toBeLessThan(near.total)
    expect(near.triangles).toBe(near.drawn * BLOCK_TRIANGLES)
    const close = blocks.cull(camera(), 1480)
    expect(close.drawn).toBeLessThan(near.drawn)
    expect(blocks.cull(camera(), 10).drawn).toBe(0)
    const queens = blocks.group.getObjectByName('blocks-queens') as unknown as {
      count: number
      visible: boolean
    }
    expect(queens.visible).toBe(false)
    blocks.dispose()
  })
})

const FILL: BlockFill = {
  lots: 3,
  plate: true,
  plateHeightM: 0.4,
  lotGapM: 2,
  lotHeightJitter: 0.45,
  treesPerBlock: 2,
  treesMax: 30,
  treeViewM: 100_000,
  treeSizeM: 7,
  treeWidthRatio: 0.8,
}
const FILL_COLORS = { ...COLORS, lot: '#cbc6bb', tree: '#5f9446' }

/** Instance matrices of a mesh's drawn instances, as world-space boxes. */
function boxes(mesh: { count: number; instanceMatrix: { array: ArrayLike<number> } }) {
  return Array.from({ length: mesh.count }, (_, i) => {
    const m = new Matrix4().fromArray(mesh.instanceMatrix.array, i * 16)
    const position = new Vector3()
    const scale = new Vector3()
    m.decompose(position, new Quaternion(), scale)
    return { position, scale }
  })
}

describe('tree geometry', () => {
  it('is an eight-triangle crown from the ground up, position and normal only', () => {
    const geometry = buildTreeGeometry()
    expect(geometry.getAttribute('position').count / 3).toBe(TREE_TRIANGLES)
    expect(Object.keys(geometry.attributes).sort()).toEqual(['normal', 'position'])
    geometry.computeBoundingBox()
    expect(geometry.boundingBox?.min.y).toBe(0)
    expect(geometry.boundingBox?.max.y).toBe(1)
    // Every face points away from the crown's axis (outward winding: front faces render).
    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')
    for (let i = 0; i < position.count; i += 3) {
      const centre = new Vector3()
      for (let k = 0; k < 3; k++) centre.add(new Vector3().fromBufferAttribute(position, i + k))
      centre.divideScalar(3).sub(new Vector3(0, 0.5, 0))
      expect(centre.dot(new Vector3().fromBufferAttribute(normal, i))).toBeGreaterThan(0)
    }
  })
})

describe('fill-lite (S04i)', () => {
  it('the low tier keeps one box per block, exactly as before', () => {
    expect(instancesPerBlock(NO_FILL)).toBe(1)
    const plain = buildBlocks(file, 30, COLORS, new Set(), materials)
    const filled = buildBlocks(file, 30, FILL_COLORS, new Set(), materials, NO_FILL)
    const a = plain.cull(camera(), 100_000)
    const b = filled.cull(camera(), 100_000)
    expect(b).toEqual(a)
    expect(b.triangles).toBe(b.drawn * BLOCK_TRIANGLES)
    const meshA = plain.group.getObjectByName('blocks-queens') as unknown as InstancedMesh
    const meshB = filled.group.getObjectByName('blocks-queens') as unknown as InstancedMesh
    expect(Array.from(meshB.instanceMatrix.array)).toEqual(Array.from(meshA.instanceMatrix.array))
    expect(filled.group.getObjectByName('fill-trees')).toBeUndefined()
    plain.dispose()
    filled.dispose()
  })

  it('splits each block into a plate and lots inside its footprint, in the same meshes', () => {
    const blocks = buildBlocks(file, 30, FILL_COLORS, new Set(['bronx']), materials, FILL)
    expect(blocks.group.children.map((m) => m.name)).toEqual([
      'blocks-queens',
      'blocks-bronx',
      'fill-trees',
      'fill-trees-dimmed',
    ])
    const view = blocks.cull(camera(), 100_000)
    expect(view.drawn).toBeGreaterThan(0)
    expect(view.plates).toBe(view.drawn)
    expect(view.lots).toBe(view.drawn * 3)
    expect(view.triangles).toBe(view.drawn * 4 * BLOCK_TRIANGLES + view.trees * TREE_TRIANGLES)
    const queens = blocks.group.getObjectByName('blocks-queens') as unknown as InstancedMesh
    const drawn = boxes(queens)
    expect(drawn).toHaveLength(view.drawn * 4)
    for (let b = 0; b < drawn.length; b += 4) {
      const [plate, ...lots] = drawn.slice(b, b + 4)
      if (plate === undefined) throw new Error('no plate')
      expect(plate.scale.y).toBeCloseTo(0.4)
      expect(plate.scale.x).toBeCloseTo(60)
      // Lots stay inside the plate with the gap around them, and none is lower than 3 m.
      let width = 0
      for (const lot of lots) {
        expect(lot.scale.y).toBeGreaterThanOrEqual(3)
        expect(lot.scale.y).toBeLessThanOrEqual(12 * 1.45 + 1e-6)
        expect(Math.abs(lot.position.x - plate.position.x) + lot.scale.x / 2).toBeLessThanOrEqual(
          28 + 1e-3,
        )
        expect(Math.abs(lot.position.z - plate.position.z) + lot.scale.z / 2).toBeLessThanOrEqual(
          28 + 1e-3,
        )
        width += Math.min(lot.scale.x, lot.scale.z)
      }
      // Three lots and two 2 m gaps fill the 56 m inside the plate's 2 m border.
      expect(width + 2 * 2).toBeCloseTo(56)
    }
    blocks.dispose()
  })

  it('stands street trees just outside their block, within the view distance and the cap', () => {
    const blocks = buildBlocks(file, 30, FILL_COLORS, new Set(['bronx']), materials, FILL)
    const view = blocks.cull(camera(), 100_000)
    expect(view.trees).toBeGreaterThan(0)
    expect(view.trees).toBeLessThanOrEqual(FILL.treesMax)
    const trees = blocks.group.getObjectByName('fill-trees') as unknown as InstancedMesh
    for (const tree of boxes(trees)) {
      // The nearest block centre lies on the row y = 0 every 500 m (z = -y in the scene).
      const along = ((tree.position.x % 500) + 500) % 500
      const dx = Math.min(along, 500 - along)
      const offset = Math.max(dx, Math.abs(tree.position.z))
      expect(offset).toBeGreaterThan(30)
      expect(offset).toBeLessThan(30 + 7 * 1.2)
      expect(tree.position.y).toBe(30)
    }
    // Out of the tree distance, no trees; past the cap, only the nearest blocks keep theirs.
    expect(blocks.cull(camera(), 100_000, 10).trees).toBe(0)
    const capped = buildBlocks(file, 30, FILL_COLORS, new Set(), materials, {
      ...FILL,
      treesMax: 4,
    })
    expect(capped.cull(camera(), 100_000).trees).toBe(4)
    capped.dispose()
    blocks.dispose()
  })

  it('is deterministic', () => {
    const a = buildBlocks(file, 30, FILL_COLORS, new Set(), materials, FILL)
    const b = buildBlocks(file, 30, FILL_COLORS, new Set(), materials, FILL)
    a.cull(camera(), 100_000)
    b.cull(camera(), 100_000)
    for (const name of ['blocks-queens', 'fill-trees']) {
      const ma = a.group.getObjectByName(name) as unknown as InstancedMesh
      const mb = b.group.getObjectByName(name) as unknown as InstancedMesh
      expect(Array.from(mb.instanceMatrix.array)).toEqual(Array.from(ma.instanceMatrix.array))
      expect(Array.from(mb.instanceColor?.array ?? [])).toEqual(
        Array.from(ma.instanceColor?.array ?? []),
      )
    }
    a.dispose()
    b.dispose()
  })

  it('every fill mesh uses the blocks materials and is never pickable', () => {
    const blocks = buildBlocks(file, 30, FILL_COLORS, new Set(['bronx']), materials, FILL)
    for (const child of blocks.group.children) {
      const mesh = child as unknown as InstancedMesh
      expect([materials.normal, materials.dimmed]).toContain(mesh.material)
      const hits: unknown[] = []
      mesh.raycast(new Raycaster(), hits as never)
      expect(hits).toEqual([])
    }
    blocks.dispose()
  })
})
