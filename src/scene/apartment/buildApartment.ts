/**
 * The apartment's scene graph (S16, S40), built imperatively once per home like the city
 * (src/scene/City.tsx) and updated in place. What things look like comes through the visuals seam
 * (visuals.ts, DEC-24); this module owns only where they go:
 * - the room shell for the home, tier and finishes (rebuilt when a finish changes or is tried on);
 * - the home's built-in fixtures and every placed item, each turned, scaled to its cells and
 *   moved there; a surface item stands on a small table drawn under it;
 * - hand-made model meshes sharing one material merged into one mesh (`mergeMeshes`), so a
 *   furnished room costs a handful of draw calls whatever it holds;
 * - buy mode's grid: every cell a tile in one InstancedMesh (one draw call), coloured by state;
 * - the mid tier's blob shadows under floor and surface items in one InstancedMesh.
 *
 * Renders state only: what sits where comes from the save through props. A tap is resolved to the
 * cell under it by intersecting the floor and wall planes (`cellAt`), never by raycasting meshes.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  Plane,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Raycaster,
  Vector2,
  Vector3,
  type Camera,
  type Material,
} from 'three'
import { footprintSize, gridSlots, parseSlot, type GridSlot, type Turn } from '@/engine/homeGrid'
import type { QualityTier } from '@/lib/data/schemas/config'
import type { ShellFinishes } from './buildRoom'
import type { ApartmentConfig, RoomInterior, RoomPalette } from './data'
import { boxAt, mergeParts, paintedPart } from './parts'
import type { CellState } from './types'
import type { ApartmentVisuals, DecorVisual, RoomVisual } from './visuals'

/** One placed item as the scene draws it: where, how turned and mounted, in a colour (hex). */
export interface PlacedFill {
  readonly itemId: string
  readonly slotId: string
  readonly turn: Turn
  readonly mount: 'wall' | 'floor' | 'surface'
  readonly footprint: '1x1' | '2x1' | '2x2'
  readonly color: string
}

export interface ApartmentObjects {
  readonly group: Group
  readonly slots: readonly GridSlot[]
  /** Shows exactly `placed` (item id → fill); unknown items draw a stand-in. */
  setPlaced(placed: Readonly<Record<string, PlacedFill>>): void
  /** Shows buy mode's grid with each cell's state, or hides it (null). */
  setCells(cells: Readonly<Record<string, CellState>> | null): void
  setFinishes(finishes: ShellFinishes): void
  /** Blob shadows on the mid tier, cast shadows on the high tier. */
  setTier(tier: QualityTier): void
  /** The cell under a point of the canvas (CSS pixels from its top left), or null. */
  cellAt(camera: Camera, x: number, y: number, width: number, height: number): string | null
  /** A cell's centre on screen, in CSS pixels from the canvas's top left, or null behind the camera. */
  cellScreen(camera: Camera, slotId: string, width: number, height: number): Vector2 | null
  /** Item ids drawn now (for the test hook). */
  drawnItems(): string[]
  /** Buy mode's grid cells shown now, by state (for the test hook). */
  gridCells(): Readonly<Record<string, CellState>>
  dispose(): void
}

const noRaycast: Object3D['raycast'] = () => {}
const UP = new Vector3(0, 1, 0)
const FLAT = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2)
const QUARTER = Math.PI / 2

/** Attributes a merged model mesh carries (the model material reads `_emissive` for night glow). */
const MERGED_ATTRIBUTES = ['position', 'normal', 'color', '_emissive'] as const

/**
 * Meshes that share one material, merged into one indexed geometry in the group's space: each
 * vertex moved by its mesh's full transform, attributes read through three's accessors so
 * quantized (normalized integer) models merge with float ones. A missing `_emissive` is zero.
 */
export function mergeMeshes(
  meshes: readonly { readonly geometry: BufferGeometry; readonly matrix: Matrix4 }[],
): BufferGeometry {
  let vertices = 0
  let indices = 0
  for (const { geometry } of meshes) {
    const count = geometry.getAttribute('position').count
    vertices += count
    indices += geometry.index === null ? count : geometry.index.count
  }
  const arrays = Object.fromEntries(
    MERGED_ATTRIBUTES.map((name) => [name, new Float32Array(vertices * 3)]),
  ) as Record<(typeof MERGED_ATTRIBUTES)[number], Float32Array>
  const index = new Uint32Array(indices)
  const point = new Vector3()
  const normalMatrix = new Matrix3()
  let vertexOffset = 0
  let indexOffset = 0
  for (const { geometry, matrix } of meshes) {
    normalMatrix.getNormalMatrix(matrix)
    const count = geometry.getAttribute('position').count
    for (const name of MERGED_ATTRIBUTES) {
      const source = geometry.getAttribute(name)
      const target = arrays[name]
      if (source === undefined) {
        if (name === 'color') target.fill(1, vertexOffset * 3, (vertexOffset + count) * 3)
        continue
      }
      for (let i = 0; i < count; i++) {
        point.set(source.getX(i), source.getY(i), source.getZ(i))
        if (name === 'position') point.applyMatrix4(matrix)
        else if (name === 'normal') point.applyMatrix3(normalMatrix).normalize()
        target.set([point.x, point.y, point.z], (vertexOffset + i) * 3)
      }
    }
    if (geometry.index === null) {
      for (let i = 0; i < count; i++) index[indexOffset + i] = vertexOffset + i
      indexOffset += count
    } else {
      const source = geometry.index
      for (let i = 0; i < source.count; i++) index[indexOffset + i] = vertexOffset + source.getX(i)
      indexOffset += source.count
    }
    vertexOffset += count
  }
  const merged = new BufferGeometry()
  for (const name of MERGED_ATTRIBUTES) {
    merged.setAttribute(name, new BufferAttribute(arrays[name], 3))
  }
  merged.setIndex(new BufferAttribute(index, 1))
  merged.computeBoundingSphere()
  return merged
}

interface Drawn {
  readonly fill: PlacedFill
  readonly visual: DecorVisual
}

/**
 * Builds the room for `interior` with `visuals` (which the caller owns and disposes); the grid and
 * blob shadows take their colours from `palette`.
 */
export function buildApartment(
  interior: RoomInterior,
  config: ApartmentConfig,
  palette: Pick<
    RoomPalette,
    'marker' | 'markerActive' | 'markerSelected' | 'markerRefused' | 'blob' | 'furniture' | 'cap'
  >,
  visuals: ApartmentVisuals,
  initialFinishes: ShellFinishes,
): ApartmentObjects {
  const group = new Group()
  group.name = 'apartment'
  group.raycast = noRaycast
  const { room, grid } = interior
  const cell = grid.cellM
  const slots = gridSlots(grid)
  let tier: QualityTier = 'mid'
  let finishes = initialFinishes
  let roomVisual: RoomVisual = visuals.buildRoom(interior, tier, finishes)
  group.add(roomVisual.object)

  // Where an item's footprint is centred, and the turn about y, for a floor or wall slot.
  const placeAt = (slotId: string, footprint: PlacedFill['footprint'], turn: Turn) => {
    const slot = parseSlot(slotId, grid)
    if (slot === null) return null
    if (slot.kind === 'wall') {
      const y = room.heightM * config.wallItemHeight
      const along = (slot.i + 0.5) * cell
      switch (slot.wall) {
        case 'back':
          return { x: -room.widthM / 2 + along, z: -room.depthM / 2, y, rotation: 0, wall: true }
        case 'left':
          return {
            x: -room.widthM / 2,
            z: -room.depthM / 2 + along,
            y,
            rotation: QUARTER,
            wall: true,
          }
        case 'right':
          return {
            x: room.widthM / 2,
            z: -room.depthM / 2 + along,
            y,
            rotation: -QUARTER,
            wall: true,
          }
      }
    }
    const { w, d } = footprintSize(footprint, turn)
    return {
      x: -room.widthM / 2 + (slot.c + w / 2) * cell,
      z: -room.depthM / 2 + (slot.r + d / 2) * cell,
      y: 0,
      rotation: turn * QUARTER,
      wall: false,
    }
  }

  /** Turns, scales (down only) and moves a visual onto its cells; returns its footprint size. */
  const layOut = (
    visual: DecorVisual,
    slotId: string,
    footprint: PlacedFill['footprint'],
    turn: Turn,
    lift: number,
    inset: number,
  ) => {
    const at = placeAt(slotId, footprint, turn)
    if (at === null) return null
    const own = footprintSize(footprint, 0)
    const fit = Math.min(
      1,
      (config.footprintFill * (own.w * cell - inset * 2)) / Math.max(visual.sizeM.w, 1e-3),
      (config.footprintFill * (own.d * cell - inset * 2)) / Math.max(visual.sizeM.d, 1e-3),
    )
    const { object } = visual
    object.scale.setScalar(fit)
    object.rotation.set(0, at.rotation, 0)
    if (at.wall) {
      // A wall item stands out from the wall by however far it reaches behind its origin.
      const out = new Vector3(0, 0, visual.backM * fit + config.insetM).applyAxisAngle(
        UP,
        at.rotation,
      )
      object.position.set(at.x + out.x, at.y, at.z + out.z)
    } else {
      object.position.set(at.x, at.y + lift, at.z)
    }
    object.updateMatrix()
    return at
  }

  const fixtures: DecorVisual[] = []
  for (const fixture of interior.fixtures) {
    if (fixture.kind !== 'model') continue
    const visual = visuals.buildFixture(fixture.model)
    if (visual === null) continue
    layOut(visual, fixture.slotId, '1x1', fixture.turn, 0, 0)
    fixtures.push(visual)
  }

  const drawn = new Map<string, Drawn>()
  const decorRoot = new Group()
  decorRoot.name = 'apartment-decor'
  group.add(decorRoot)
  let merged: Mesh[] = []
  let stands: Mesh | null = null
  const standMaterial = new MeshLambertMaterial({ vertexColors: true })

  const tiles = new InstancedMesh(
    new PlaneGeometry(cell * (1 - config.grid.gapShare * 2), cell * (1 - config.grid.gapShare * 2)),
    new MeshBasicMaterial({
      transparent: true,
      opacity: config.grid.opacity,
      depthWrite: false,
    }),
    slots.length,
  )
  tiles.name = 'apartment-grid'
  tiles.frustumCulled = false
  tiles.renderOrder = 5
  tiles.visible = false
  group.add(tiles)

  // The held item's cells (and the selection) as square frames drawn over everything, so the
  // footprint shows even where the item itself covers its tiles.
  const frameRadius = (cell * (1 - config.grid.gapShare * 2) * Math.SQRT2) / 2
  const frameGeometry = new RingGeometry(frameRadius * 0.86, frameRadius, 4, 1, Math.PI / 4)
  const frames = new InstancedMesh(
    frameGeometry,
    new MeshBasicMaterial({ depthTest: false, depthWrite: false, transparent: true, opacity: 0.9 }),
    slots.length,
  )
  frames.name = 'apartment-grid-frames'
  frames.frustumCulled = false
  frames.renderOrder = 10
  frames.visible = false
  group.add(frames)

  const blobs = new InstancedMesh(
    new CircleGeometry(config.blob.radiusM, 16),
    new MeshBasicMaterial({
      color: palette.blob,
      transparent: true,
      opacity: config.blob.opacity,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
    48,
  )
  blobs.name = 'apartment-blob-shadows'
  blobs.frustumCulled = false
  group.add(blobs)
  for (const mesh of [tiles, frames, blobs]) mesh.raycast = noRaycast

  const stateColors: Readonly<Record<CellState, Color>> = {
    free: new Color(palette.marker),
    taken: new Color(palette.cap),
    ghost: new Color(palette.markerActive),
    refused: new Color(palette.markerRefused),
    selected: new Color(palette.markerSelected),
  }
  const scratch = new Matrix4()
  const hidden = new Matrix4().makeScale(0, 0, 0)

  const tileMatrix = (slot: GridSlot): Matrix4 => {
    if (slot.kind === 'floor') {
      const x = -room.widthM / 2 + (slot.c + 0.5) * cell
      const z = -room.depthM / 2 + (slot.r + 0.5) * cell
      return scratch.compose(new Vector3(x, config.grid.liftM, z), FLAT, new Vector3(1, 1, 1))
    }
    const at = placeAt(slot.id, '1x1', 0)
    if (at === null) return hidden
    const turn = new Quaternion().setFromAxisAngle(UP, at.rotation)
    const out = new Vector3(0, 0, config.insetM * 4).applyAxisAngle(UP, at.rotation)
    return scratch.compose(
      new Vector3(at.x + out.x, at.y + cell / 2, at.z + out.z),
      turn,
      new Vector3(1, 1, 1),
    )
  }

  const layoutBlobs = () => {
    let i = 0
    for (const { fill, visual } of drawn.values()) {
      if (fill.mount === 'wall' || i >= blobs.count) continue
      const at = placeAt(fill.slotId, fill.footprint, fill.turn)
      if (at === null) continue
      const { w, d } = footprintSize(fill.footprint, fill.turn)
      const radius = Math.min(
        Math.max(w, d) * cell * 0.45,
        visual.footprintM * visual.object.scale.x * 1.1,
      )
      const scale = radius / config.blob.radiusM
      blobs.setMatrixAt(
        i,
        scratch.compose(
          new Vector3(at.x, config.blob.liftM, at.z),
          FLAT,
          new Vector3(scale, scale, scale),
        ),
      )
      i++
    }
    for (; i < blobs.count; i++) blobs.setMatrixAt(i, hidden)
    blobs.instanceMatrix.needsUpdate = true
    blobs.visible = tier === 'mid'
  }

  /** The small tables under surface items, as one vertex-coloured mesh. */
  const buildStands = () => {
    if (stands !== null) {
      group.remove(stands)
      stands.geometry.dispose()
      stands = null
    }
    const parts: BufferGeometry[] = []
    for (const { fill } of drawn.values()) {
      if (fill.mount !== 'surface') continue
      const at = placeAt(fill.slotId, fill.footprint, fill.turn)
      if (at === null) continue
      const { w, d } = footprintSize(fill.footprint, fill.turn)
      const top = config.standHeightM
      const sx = w * cell - config.standInsetM * 2
      const sz = Math.min(d * cell - config.standInsetM * 2, 0.6)
      parts.push(paintedPart(boxAt([sx, 0.06, sz], [at.x, top - 0.03, at.z]), palette.furniture))
      for (const [dx, dz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) {
        parts.push(
          paintedPart(
            boxAt(
              [0.05, top - 0.06, 0.05],
              [at.x + dx * (sx / 2 - 0.05), (top - 0.06) / 2, at.z + dz * (sz / 2 - 0.05)],
            ),
            palette.cap,
          ),
        )
      }
    }
    if (parts.length === 0) return
    const mesh = new Mesh(mergeParts(parts, 'stands'), standMaterial)
    mesh.name = 'apartment-stands'
    mesh.raycast = noRaycast
    mesh.receiveShadow = true
    mesh.castShadow = tier === 'high'
    stands = mesh
    group.add(mesh)
  }

  /** Merges the model meshes of fixtures and decor by material; the rest are drawn as they are. */
  const rebuildMerged = () => {
    for (const mesh of merged) {
      group.remove(mesh)
      mesh.geometry.dispose()
    }
    merged = []
    decorRoot.clear()
    const byMaterial = new Map<Material, { geometry: BufferGeometry; matrix: Matrix4 }[]>()
    const visualsNow = [...fixtures, ...[...drawn.values()].map((entry) => entry.visual)]
    for (const visual of visualsNow) {
      visual.object.updateMatrixWorld(true)
      let mergeable = true
      visual.object.traverse((child) => {
        if (child instanceof Mesh && Array.isArray(child.material)) mergeable = false
      })
      if (!mergeable) {
        decorRoot.add(visual.object)
        continue
      }
      visual.object.traverse((child) => {
        if (!(child instanceof Mesh)) return
        const material = child.material as Material
        const list = byMaterial.get(material) ?? []
        list.push({ geometry: child.geometry as BufferGeometry, matrix: child.matrixWorld.clone() })
        byMaterial.set(material, list)
      })
    }
    for (const [material, meshes] of byMaterial) {
      const mesh = new Mesh(mergeMeshes(meshes), material)
      mesh.name = 'apartment-decor-merged'
      mesh.raycast = noRaycast
      mesh.receiveShadow = true
      mesh.castShadow = tier === 'high'
      merged.push(mesh)
      group.add(mesh)
    }
  }

  const removeDrawn = (itemId: string) => {
    const entry = drawn.get(itemId)
    if (entry === undefined) return
    decorRoot.remove(entry.visual.object)
    entry.visual.dispose()
    drawn.delete(itemId)
  }

  const plane = {
    floor: new Plane(new Vector3(0, 1, 0), 0),
    back: new Plane(new Vector3(0, 0, 1), room.depthM / 2),
    left: new Plane(new Vector3(1, 0, 0), room.widthM / 2),
    right: new Plane(new Vector3(-1, 0, 0), room.widthM / 2),
  }
  let shownCells: Readonly<Record<string, CellState>> = {}
  const raycaster = new Raycaster()
  const hit = new Vector3()

  return {
    group,
    slots,
    setPlaced(placed) {
      for (const itemId of [...drawn.keys()]) {
        const next = placed[itemId]
        const current = drawn.get(itemId)?.fill
        if (next === undefined || current?.color !== next.color) removeDrawn(itemId)
      }
      for (const fill of Object.values(placed)) {
        let entry = drawn.get(fill.itemId)
        if (entry === undefined) {
          const visual = visuals.buildDecor(fill.itemId, fill.color)
          if (visual === null) continue
          visual.object.name = `apartment-decor-${fill.itemId}`
          visual.object.raycast = noRaycast
          entry = { fill, visual }
        }
        const lift = fill.mount === 'surface' ? config.standHeightM : 0
        const inset = fill.mount === 'surface' ? config.standInsetM : 0
        layOut(entry.visual, fill.slotId, fill.footprint, fill.turn, lift, inset)
        drawn.set(fill.itemId, { fill, visual: entry.visual })
      }
      buildStands()
      rebuildMerged()
      layoutBlobs()
    },
    setCells(cells) {
      tiles.visible = cells !== null
      frames.visible = cells !== null
      shownCells = cells ?? {}
      if (cells === null) return
      slots.forEach((slot, i) => {
        const state = cells[slot.id]
        const framed = state === 'ghost' || state === 'refused' || state === 'selected'
        if (state === undefined) {
          tiles.setMatrixAt(i, hidden)
          frames.setMatrixAt(i, hidden)
          return
        }
        const matrix = tileMatrix(slot)
        tiles.setMatrixAt(i, matrix)
        tiles.setColorAt(i, stateColors[state])
        frames.setMatrixAt(i, framed ? matrix : hidden)
        frames.setColorAt(i, stateColors[state])
      })
      for (const mesh of [tiles, frames]) {
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true
      }
    },
    setFinishes(next) {
      if (next.wall === finishes.wall && next.floor === finishes.floor) return
      finishes = next
      group.remove(roomVisual.object)
      roomVisual.dispose()
      roomVisual = visuals.buildRoom(interior, tier, finishes)
      group.add(roomVisual.object)
    },
    setTier(next) {
      if (next === tier) return
      tier = next
      // A visual may differ by tier (S04h models can), so the room is rebuilt for it.
      group.remove(roomVisual.object)
      roomVisual.dispose()
      roomVisual = visuals.buildRoom(interior, tier, finishes)
      group.add(roomVisual.object)
      for (const { visual } of drawn.values()) visual.setCastShadow(tier === 'high')
      for (const mesh of merged) mesh.castShadow = tier === 'high'
      if (stands !== null) stands.castShadow = tier === 'high'
      layoutBlobs()
    },
    cellAt(camera, x, y, width, height) {
      raycaster.setFromCamera(new Vector2((x / width) * 2 - 1, 1 - (y / height) * 2), camera)
      const { ray } = raycaster
      let best: { distance: number; slotId: string } | null = null
      const consider = (distance: number, slotId: string | null) => {
        if (slotId !== null && (best === null || distance < best.distance)) {
          best = { distance, slotId }
        }
      }
      const halfW = room.widthM / 2
      const halfD = room.depthM / 2
      const index = (value: number, length: number) =>
        value >= 0 && value < length ? Math.floor(value / cell) : -1
      if (ray.intersectPlane(plane.floor, hit) !== null) {
        const c = index(hit.x + halfW, room.widthM)
        const r = index(hit.z + halfD, room.depthM)
        consider(ray.origin.distanceTo(hit), c >= 0 && r >= 0 ? `f${c}-${r}` : null)
      }
      const wallHit = (wall: 'back' | 'left' | 'right') => {
        if (ray.intersectPlane(plane[wall], hit) === null || hit.y < 0 || hit.y > room.heightM) {
          return
        }
        const along = wall === 'back' ? hit.x + halfW : hit.z + halfD
        const i = index(along, wall === 'back' ? room.widthM : room.depthM)
        // A wall is only hit from inside the room.
        const inside = wall === 'back' ? hit.z >= -halfD - 1e-3 : Math.abs(hit.x) <= halfW + 1e-3
        consider(ray.origin.distanceTo(hit), i >= 0 && inside ? `w-${wall}-${i}` : null)
      }
      wallHit('back')
      wallHit('left')
      wallHit('right')
      return (best as { distance: number; slotId: string } | null)?.slotId ?? null
    },
    cellScreen(camera, slotId, width, height) {
      const slot = parseSlot(slotId, grid)
      if (slot === null) return null
      const point =
        slot.kind === 'floor'
          ? new Vector3(
              -room.widthM / 2 + (slot.c + 0.5) * cell,
              0,
              -room.depthM / 2 + (slot.r + 0.5) * cell,
            )
          : (() => {
              const at = placeAt(slotId, '1x1', 0)
              return at === null ? null : new Vector3(at.x, at.y + cell / 2, at.z)
            })()
      if (point === null) return null
      const ndc = point.project(camera)
      if (ndc.z > 1) return null
      return new Vector2(((ndc.x + 1) / 2) * width, ((1 - ndc.y) / 2) * height)
    },
    drawnItems: () => [...drawn.keys()].sort(),
    gridCells: () => shownCells,
    dispose() {
      for (const itemId of [...drawn.keys()]) removeDrawn(itemId)
      for (const visual of fixtures) visual.dispose()
      for (const mesh of merged) mesh.geometry.dispose()
      stands?.geometry.dispose()
      standMaterial.dispose()
      roomVisual.dispose()
      for (const mesh of [tiles, frames, blobs]) {
        mesh.geometry.dispose()
        ;(mesh.material as Material).dispose()
        mesh.dispose()
      }
    },
  }
}
