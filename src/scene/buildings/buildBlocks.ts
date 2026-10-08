/**
 * Procedural low blocks outside the districts (S04d): one InstancedMesh per borough of a unit
 * box without a floor (10 triangles), each instance moved to its block, turned to the borough's
 * street grid and stretched to its size and height. Only the blocks in view are drawn: on every
 * view change the visible ones (inside the camera frustum and within the tier's draw distance)
 * are packed to the front of the instance buffers, so a borough costs one draw call and the
 * triangle count follows the view, not the city (TUNE-7). three only, no React.
 *
 * Fill-lite (S04i): on tiers with lots, a block becomes a low plate plus a row of lots of
 * seeded widths and heights, all instances of the same box in the same borough mesh, so the
 * empty land reads as city blocks without a new draw call or shader program. Street trees (an
 * eight-triangle crown) stand beside the blocks in two more instanced meshes (normal and dimmed
 * land) with the blocks' materials. One sphere per block covers its plate, lots and trees, so
 * culling still costs one test per block.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Frustum,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Sphere,
  Vector3,
  type Camera,
  type Material,
} from 'three'
import { decodePath } from '@/lib/geo/codec'
import type { BoroughId } from '../geo/schema'
import { massNoise, pick } from './buildDistrict'
import type { Blocks } from './schema'

export const BLOCK_TRIANGLES = 10
/** Triangles of one fill tree crown (an octahedron). */
export const TREE_TRIANGLES = 8

/** A unit box (x and z from -0.5 to 0.5, y from 0 to 1) without its floor, flat-shaded. */
export function buildBlockGeometry(): BufferGeometry {
  // Each face: four corners counter-clockwise seen from outside, and its outward normal.
  const faces: [number[][], number[]][] = [
    [
      [
        [-0.5, 0, 0.5],
        [0.5, 0, 0.5],
        [0.5, 1, 0.5],
        [-0.5, 1, 0.5],
      ],
      [0, 0, 1],
    ],
    [
      [
        [0.5, 0, -0.5],
        [-0.5, 0, -0.5],
        [-0.5, 1, -0.5],
        [0.5, 1, -0.5],
      ],
      [0, 0, -1],
    ],
    [
      [
        [0.5, 0, 0.5],
        [0.5, 0, -0.5],
        [0.5, 1, -0.5],
        [0.5, 1, 0.5],
      ],
      [1, 0, 0],
    ],
    [
      [
        [-0.5, 0, -0.5],
        [-0.5, 0, 0.5],
        [-0.5, 1, 0.5],
        [-0.5, 1, -0.5],
      ],
      [-1, 0, 0],
    ],
    [
      [
        [-0.5, 1, 0.5],
        [0.5, 1, 0.5],
        [0.5, 1, -0.5],
        [-0.5, 1, -0.5],
      ],
      [0, 1, 0],
    ],
  ]
  const positions: number[] = []
  const normals: number[] = []
  const index: number[] = []
  faces.forEach(([corners, normal], face) => {
    for (const corner of corners) {
      positions.push(...corner)
      normals.push(...normal)
    }
    const v = face * 4
    index.push(v, v + 1, v + 2, v, v + 2, v + 3)
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  geometry.setIndex(index)
  return geometry
}

/**
 * A tree crown: an octahedron from y 0 to 1, widest (0.5 from the axis) at half height,
 * flat-shaded with position and normal only, like the block box, so both share one program.
 */
export function buildTreeGeometry(): BufferGeometry {
  type P = readonly [number, number, number]
  const top: P = [0, 1, 0]
  const bottom: P = [0, 0, 0]
  const ring: readonly P[] = [
    [0.5, 0.5, 0],
    [0, 0.5, -0.5],
    [-0.5, 0.5, 0],
    [0, 0.5, 0.5],
  ]
  const positions: number[] = []
  const normals: number[] = []
  const face = (a: P, b: P, c: P) => {
    const normal = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
      .cross(new Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]))
      .normalize()
    for (const p of [a, b, c]) {
      positions.push(...p)
      normals.push(normal.x, normal.y, normal.z)
    }
  }
  ring.forEach((corner, i) => {
    const next = ring[(i + 1) % ring.length] ?? corner
    face(corner, next, top)
    face(next, corner, bottom)
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  return geometry
}

interface BoroughBlocks {
  readonly borough: BoroughId
  readonly mesh: InstancedMesh
  /** Instance matrices, 16 floats each: `perBlock` consecutive instances per block. */
  readonly matrices: Float32Array
  readonly colors: Float32Array
  /** Bounding sphere of each block (plate, lots and trees): centre x, y, z and radius. */
  readonly spheres: Float32Array
  readonly count: number
  readonly dimmed: boolean
  /** Tree matrices and colours, `treesPerBlock` consecutive trees per block. */
  readonly treeMatrices: Float32Array
  readonly treeColors: Float32Array
}

export interface BlocksView {
  /** Blocks in the file. */
  readonly total: number
  /** Blocks drawn for the current view. */
  readonly drawn: number
  /** Triangles of the drawn blocks (plates and lots included) and trees. */
  readonly triangles: number
  /** Fill-lite instances drawn: lots, plates and street trees (S04i). */
  readonly lots: number
  readonly plates: number
  readonly trees: number
}

export interface BlocksObjects {
  readonly group: Group
  /**
   * Packs the blocks in view (frustum and `maxDistanceM` from the camera) and the trees of those
   * within `treeDistanceM` (default: the fill's `treeViewM`), and returns them.
   */
  cull(camera: Camera, maxDistanceM: number, treeDistanceM?: number): BlocksView
  view(): BlocksView
  dispose(): void
}

export interface BlockColors {
  /** Block colours, one picked per block (repeat a colour to weight it). */
  readonly blocks: readonly string[]
  /** Blocks on dimmed land ("expanding soon"), already mixed towards the background. */
  readonly dimmed: string
  readonly jitter: number
  /** Fill-lite plate colour (S04i); dimmed land uses `dimmed`. */
  readonly lot?: string
  /** Fill-lite tree crown colour (S04i); dimmed land uses `dimmed`. */
  readonly tree?: string
}

/** How a tier dresses its blocks (scene.json `buildings.fill` for the tier, perf caps). */
export interface BlockFill {
  /** Lots per block; 0 draws each block as one box (the low tier). */
  readonly lots: number
  readonly plate: boolean
  readonly plateHeightM: number
  readonly lotGapM: number
  readonly lotHeightJitter: number
  readonly treesPerBlock: number
  /** Most trees drawn at once (perf.json fillTreesMax); 0 turns trees off. */
  readonly treesMax: number
  /** Trees draw only within this distance of the camera (unless `cull` is given another). */
  readonly treeViewM: number
  readonly treeSizeM: number
  readonly treeWidthRatio: number
}

/** One box per block and no trees: the S04d look, kept by the low tier. */
export const NO_FILL: BlockFill = {
  lots: 0,
  plate: false,
  plateHeightM: 1,
  lotGapM: 0,
  lotHeightJitter: 0,
  treesPerBlock: 0,
  treesMax: 0,
  treeViewM: 0,
  treeSizeM: 1,
  treeWidthRatio: 1,
}

/** Offsets the colour pick's noise from the shade's (any constant far from the block count). */
const BLOCK_COLOR_SEED = 0x51ed
/** Seeds of the fill-lite noise streams (lot axis, widths, heights, colours; trees). */
const LOT_SEED = 0x2c1b3
const TREE_SEED = 0x7f4a7
/** Noise draws reserved per block in each fill stream. */
const NOISE_STRIDE = 32
/** A lot is never lower than this (metres), so no lot sinks into its plate. */
const MIN_LOT_HEIGHT_M = 3

const _matrix = new Matrix4()
const _position = new Vector3()
const _offset = new Vector3()
const _rotation = new Quaternion()
const _scale = new Vector3()
const _up = new Vector3(0, 1, 0)
const _frustum = new Frustum()
const _projection = new Matrix4()
const _sphere = new Sphere()
const _camera = new Vector3()

/**
 * Marks only the first `instances` of an instanced attribute for upload: the buffers hold
 * every block (several instances each with fill-lite), but only the packed front is drawn, and
 * re-uploading whole multi-megabyte buffers on every camera change stalls slow GPUs.
 */
function uploadFront(attribute: InstancedBufferAttribute, instances: number) {
  attribute.clearUpdateRanges()
  if (instances === 0) return
  attribute.addUpdateRange(0, instances * attribute.itemSize)
  attribute.needsUpdate = true
}

/** Instances per block: the plate, then the lots (or the block itself when there are none). */
export const instancesPerBlock = (fill: BlockFill) => (fill.plate ? 1 : 0) + Math.max(1, fill.lots)

export function buildBlocks(
  file: Blocks,
  groundY: number,
  colors: BlockColors,
  dimmedBoroughs: ReadonlySet<BoroughId>,
  materials: { readonly normal: Material; readonly dimmed: Material },
  fill: BlockFill = NO_FILL,
): BlocksObjects {
  const group = new Group()
  group.name = 'blocks'
  const geometry = buildBlockGeometry()
  const bases = colors.blocks.map((hex) => new Color(hex))
  const dim = new Color(colors.dimmed)
  const lot = new Color(colors.lot ?? colors.blocks[0] ?? colors.dimmed)
  const leaf = new Color(colors.tree ?? colors.dimmed)
  const color = new Color()
  const perBlock = instancesPerBlock(fill)
  const lots = Math.max(1, fill.lots)
  const treesPerBlock = fill.treesMax > 0 ? fill.treesPerBlock : 0
  const treeWidth = fill.treeSizeM * fill.treeWidthRatio
  // Trees stand on the sidewalk just outside the block's edge.
  const treeOffset = file.sizeM / 2 + treeWidth / 2 + 1
  const half = (file.sizeM * Math.SQRT2) / 2
  const reach = treesPerBlock > 0 ? Math.hypot(treeOffset + treeWidth / 2, file.sizeM / 2) : half
  let serial = 0

  /** Writes one box instance: local offset (x, z) from the block centre, size and colour. */
  const box = (
    out: { matrices: Float32Array; colors: Float32Array },
    slot: number,
    centre: Vector3,
    x: number,
    z: number,
    size: { w: number; h: number; d: number },
    tint: Color,
  ) => {
    _offset.set(x, 0, z).applyQuaternion(_rotation).add(centre)
    _scale.set(size.w, size.h, size.d)
    _matrix.compose(_offset, _rotation, _scale).toArray(out.matrices, slot * 16)
    tint.toArray(out.colors, slot * 3)
  }

  const boroughs: BoroughBlocks[] = file.groups.map((entry) => {
    const points = decodePath(entry.p)
    const count = entry.h.length
    const matrices = new Float32Array(count * perBlock * 16)
    const instanceColors = new Float32Array(count * perBlock * 3)
    const spheres = new Float32Array(count * 4)
    const treeMatrices = new Float32Array(count * treesPerBlock * 16)
    const treeColors = new Float32Array(count * treesPerBlock * 3)
    const out = { matrices, colors: instanceColors }
    const trees = { matrices: treeMatrices, colors: treeColors }
    const dimmed = dimmedBoroughs.has(entry.borough)
    _rotation.setFromAxisAngle(_up, (entry.angleDeg * Math.PI) / 180)
    points.forEach((point, i) => {
      const h = entry.h[i] ?? 1
      _position.set(point.x, groundY, -point.y)
      const shade = 1 + colors.jitter * (2 * massNoise(serial) - 1)
      // A second, independent noise picks the colour, so shade and colour don't correlate.
      const base = pick(bases, massNoise(serial + BLOCK_COLOR_SEED))
      const noise = (seed: number, k: number) => massNoise(seed + serial * NOISE_STRIDE + k)
      let slot = i * perBlock
      if (fill.plate) {
        color.copy(dimmed ? dim : lot).multiplyScalar(1 + (shade - 1) / 3)
        box(
          out,
          slot++,
          _position,
          0,
          0,
          { w: file.sizeM, h: fill.plateHeightM, d: file.sizeM },
          color,
        )
      }
      if (fill.lots <= 0) {
        color.copy(dimmed ? dim : base).multiplyScalar(shade)
        box(out, slot++, _position, 0, 0, { w: file.sizeM, h, d: file.sizeM }, color)
      } else {
        // Lots in a row along one of the block's axes, with seeded widths and heights.
        const alongX = noise(LOT_SEED, 0) < 0.5
        const inner = Math.max(1, file.sizeM - 2 * fill.lotGapM)
        const free = Math.max(lots, inner - (lots - 1) * fill.lotGapM)
        const weights = Array.from({ length: lots }, (_, k) => 0.7 + 0.6 * noise(LOT_SEED, 1 + k))
        const total = weights.reduce((sum, w) => sum + w, 0)
        let cursor = -inner / 2
        weights.forEach((weight, k) => {
          const width = (free * weight) / total
          const along = cursor + width / 2
          cursor += width + fill.lotGapM
          const height = Math.max(
            MIN_LOT_HEIGHT_M,
            h * (1 + fill.lotHeightJitter * (2 * noise(LOT_SEED, 10 + k) - 1)),
          )
          const tint = dimmed ? dim : pick(bases, noise(LOT_SEED, 20 + k))
          color.copy(tint).multiplyScalar(1 + colors.jitter * (2 * noise(BLOCK_COLOR_SEED, k) - 1))
          box(
            out,
            slot++,
            _position,
            alongX ? along : 0,
            alongX ? 0 : along,
            alongX ? { w: width, h: height, d: inner } : { w: inner, h: height, d: width },
            color,
          )
        })
      }
      for (let t = 0; t < treesPerBlock; t++) {
        // Spread the block's trees over its four sides, at a seeded point along each.
        const side = (t + Math.floor(noise(TREE_SEED, 0) * 4)) % 4
        const along = (noise(TREE_SEED, 1 + t) - 0.5) * file.sizeM * 0.8
        const across = side < 2 ? treeOffset : -treeOffset
        const x = side % 2 === 0 ? along : across
        const z = side % 2 === 0 ? across : along
        color
          .copy(dimmed ? dim : leaf)
          .multiplyScalar(1 + colors.jitter * (2 * noise(TREE_SEED, 10 + t) - 1))
        const size = fill.treeSizeM * (0.8 + 0.4 * noise(TREE_SEED, 20 + t))
        box(
          trees,
          i * treesPerBlock + t,
          _position,
          x,
          z,
          { w: size * fill.treeWidthRatio, h: size, d: size * fill.treeWidthRatio },
          color,
        )
      }
      serial++
      const lotsTop = fill.lots > 0 ? h * (1 + fill.lotHeightJitter) : h
      const top = treesPerBlock > 0 ? Math.max(lotsTop, fill.treeSizeM * 1.2) : lotsTop
      spheres.set([point.x, groundY + top / 2, -point.y, Math.hypot(reach, top / 2)], i * 4)
    })
    const mesh = new InstancedMesh(
      geometry,
      dimmed ? materials.dimmed : materials.normal,
      count * perBlock,
    )
    mesh.name = `blocks-${entry.borough}`
    // Culled per block in `cull`, so three's per-mesh test (on stale bounds) is skipped.
    mesh.frustumCulled = false
    mesh.raycast = () => {}
    mesh.count = 0
    mesh.visible = false
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(count * perBlock * 3), 3)
    group.add(mesh)
    return {
      borough: entry.borough,
      mesh,
      matrices,
      colors: instanceColors,
      spheres,
      count,
      dimmed,
      treeMatrices,
      treeColors,
    }
  })

  const total = boroughs.reduce((sum, b) => sum + b.count, 0)
  const treeGeometry = treesPerBlock > 0 ? buildTreeGeometry() : null
  const treeMesh = (dimmed: boolean): InstancedMesh | null => {
    if (treeGeometry === null) return null
    const capacity = Math.min(
      fill.treesMax,
      boroughs.filter((b) => b.dimmed === dimmed).reduce((n, b) => n + b.count, 0) * treesPerBlock,
    )
    if (capacity === 0) return null
    const mesh = new InstancedMesh(
      treeGeometry,
      dimmed ? materials.dimmed : materials.normal,
      capacity,
    )
    mesh.name = dimmed ? 'fill-trees-dimmed' : 'fill-trees'
    mesh.frustumCulled = false
    mesh.raycast = () => {}
    mesh.count = 0
    mesh.visible = false
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
    group.add(mesh)
    return mesh
  }
  const treeMeshes = { normal: treeMesh(false), dimmed: treeMesh(true) }
  const plateShare = fill.plate ? 1 : 0
  const empty: BlocksView = { total, drawn: 0, triangles: 0, lots: 0, plates: 0, trees: 0 }
  let current = empty

  /** Blocks near enough for trees this frame: borough, block index, distance. */
  const treeBlocks: { borough: BoroughBlocks; index: number; distance: number }[] = []

  return {
    group,
    cull(camera, maxDistanceM, treeDistanceM = fill.treeViewM) {
      camera.updateMatrixWorld()
      _projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      _frustum.setFromProjectionMatrix(_projection)
      camera.getWorldPosition(_camera)
      let drawn = 0
      treeBlocks.length = 0
      for (const borough of boroughs) {
        const matrixArray = borough.mesh.instanceMatrix.array as Float32Array
        const colorArray = borough.mesh.instanceColor?.array as Float32Array | undefined
        let n = 0
        for (let i = 0; i < borough.count; i++) {
          const s = i * 4
          _sphere.center.set(
            borough.spheres[s] ?? 0,
            borough.spheres[s + 1] ?? 0,
            borough.spheres[s + 2] ?? 0,
          )
          _sphere.radius = borough.spheres[s + 3] ?? 0
          const distance = _sphere.center.distanceTo(_camera) - _sphere.radius
          if (distance > maxDistanceM) continue
          if (!_frustum.intersectsSphere(_sphere)) continue
          const from = i * perBlock
          matrixArray.set(
            borough.matrices.subarray(from * 16, (from + perBlock) * 16),
            n * perBlock * 16,
          )
          colorArray?.set(
            borough.colors.subarray(from * 3, (from + perBlock) * 3),
            n * perBlock * 3,
          )
          n++
          if (treesPerBlock > 0 && distance <= treeDistanceM) {
            treeBlocks.push({ borough, index: i, distance })
          }
        }
        borough.mesh.count = n * perBlock
        borough.mesh.visible = n > 0
        uploadFront(borough.mesh.instanceMatrix, n * perBlock)
        if (borough.mesh.instanceColor !== null)
          uploadFront(borough.mesh.instanceColor, n * perBlock)
        drawn += n
      }
      // Over the cap, the nearest blocks keep their trees.
      if (treeBlocks.length * treesPerBlock > fill.treesMax) {
        treeBlocks.sort((a, b) => a.distance - b.distance)
      }
      const placed = { normal: 0, dimmed: 0 }
      for (const { borough, index } of treeBlocks) {
        const key = borough.dimmed ? 'dimmed' : 'normal'
        const mesh = treeMeshes[key]
        if (mesh === null || placed[key] + treesPerBlock > mesh.instanceMatrix.count) continue
        const from = index * treesPerBlock
        ;(mesh.instanceMatrix.array as Float32Array).set(
          borough.treeMatrices.subarray(from * 16, (from + treesPerBlock) * 16),
          placed[key] * 16,
        )
        ;(mesh.instanceColor?.array as Float32Array | undefined)?.set(
          borough.treeColors.subarray(from * 3, (from + treesPerBlock) * 3),
          placed[key] * 3,
        )
        placed[key] += treesPerBlock
      }
      for (const key of ['normal', 'dimmed'] as const) {
        const mesh = treeMeshes[key]
        if (mesh === null) continue
        mesh.count = placed[key]
        mesh.visible = placed[key] > 0
        uploadFront(mesh.instanceMatrix, placed[key])
        if (mesh.instanceColor !== null) uploadFront(mesh.instanceColor, placed[key])
      }
      const trees = placed.normal + placed.dimmed
      current = {
        total,
        drawn,
        triangles: drawn * perBlock * BLOCK_TRIANGLES + trees * TREE_TRIANGLES,
        lots: fill.lots > 0 ? drawn * fill.lots : 0,
        plates: drawn * plateShare,
        trees,
      }
      return current
    },
    view: () => current,
    dispose() {
      geometry.dispose()
      treeGeometry?.dispose()
      for (const borough of boroughs) borough.mesh.dispose()
      treeMeshes.normal?.dispose()
      treeMeshes.dimmed?.dispose()
    },
  }
}
