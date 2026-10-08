/**
 * What the room's Sim knows about the floor (S40c), as pure maths with no three import: which
 * grid cells furniture stands on, where each piece's interaction points are in the room, and a
 * walking route between two floor points that keeps clear of furniture and walls.
 *
 * Room metres as the scene uses them (src/scene/apartment/buildApartment.ts): x right, z toward
 * the open front, the floor's centre at 0; cell (c, r) spans column c from the left wall and
 * row r from the back wall. An item at turn t is turned t quarter turns about the vertical, so a
 * point (x, z) in its own frame lands at its footprint's centre plus that point turned.
 */
import { footprintSize, parseSlot, type GridFootprint, type Turn } from '@/engine/homeGrid'
import type { SimAnchor, SimSpot, Vec3 } from './simData'

export interface P2 {
  readonly x: number
  readonly z: number
}

/** One placed item or fixture as the Sim sees it. */
export interface WorldItem {
  readonly id: string
  /** The furniture model it is drawn with (scene.json `models.decor`), or null for none. */
  readonly model: string | null
  readonly center: P2
  readonly turn: Turn
  /** Floor cells it covers (column, row). */
  readonly cells: readonly (readonly [number, number])[]
}

export interface SimWorld {
  readonly cols: number
  readonly rows: number
  readonly cellM: number
  readonly widthM: number
  readonly depthM: number
  /** 1 where furniture stands (row-major, cols × rows). */
  readonly blocked: Uint8Array
  readonly items: readonly WorldItem[]
}

/** What the world is built from: the home's grid and fixtures, and the items placed now. */
export interface WorldInput {
  readonly grid: { readonly cols: number; readonly rows: number; readonly cellM: number }
  readonly fixtures: readonly {
    readonly kind: 'model' | 'counter'
    readonly model?: string
    readonly slotId: string
    readonly turn: Turn
  }[]
  readonly placed: readonly {
    readonly itemId: string
    readonly slotId: string
    readonly turn: Turn
    readonly mount: 'wall' | 'floor' | 'surface'
    readonly footprint: GridFootprint
  }[]
  /** The model an item is drawn with, or null. */
  readonly modelOf: (itemId: string) => string | null
  /** Models the Sim walks over (rugs). */
  readonly walkable: ReadonlySet<string>
}

export function buildWorld(input: WorldInput): SimWorld {
  const { cols, rows, cellM } = input.grid
  const widthM = cols * cellM
  const depthM = rows * cellM
  const blocked = new Uint8Array(cols * rows)
  const items: WorldItem[] = []
  const size = { cols, rows }
  const add = (
    id: string,
    model: string | null,
    slotId: string,
    footprint: GridFootprint,
    turn: Turn,
    blocks: boolean,
  ) => {
    const slot = parseSlot(slotId, size)
    if (slot?.kind !== 'floor') return
    const { w, d } = footprintSize(footprint, turn)
    const cells: [number, number][] = []
    for (let dr = 0; dr < d; dr++) {
      for (let dc = 0; dc < w; dc++) {
        const c = slot.c + dc
        const r = slot.r + dr
        if (c >= cols || r >= rows) continue
        cells.push([c, r])
        if (blocks) blocked[r * cols + c] = 1
      }
    }
    items.push({
      id,
      model,
      turn,
      cells,
      center: {
        x: -widthM / 2 + (slot.c + w / 2) * cellM,
        z: -depthM / 2 + (slot.r + d / 2) * cellM,
      },
    })
  }
  input.fixtures.forEach((fixture, i) => {
    add(`fixture-${i}`, fixture.model ?? null, fixture.slotId, '1x1', fixture.turn, true)
  })
  for (const entry of input.placed) {
    if (entry.mount === 'wall') continue
    const model = input.modelOf(entry.itemId)
    const walkable = model !== null && input.walkable.has(model)
    add(entry.itemId, model, entry.slotId, entry.footprint, entry.turn, !walkable)
  }
  return { cols, rows, cellM, widthM, depthM, blocked, items }
}

/** A point of an item's own frame (turn 0) in room metres; y passes through. */
export function itemPoint(item: WorldItem, local: Vec3): Vec3 {
  const angle = (item.turn * Math.PI) / 2
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [
    item.center.x + local[0] * cos + local[2] * sin,
    local[1],
    item.center.z - local[0] * sin + local[2] * cos,
  ]
}

/** An anchor placed in the room: where the body rests, its heading, the floor points to it. */
export interface PlacedAnchor {
  readonly itemId: string
  readonly pose: string
  readonly at: Vec3
  readonly headingRad: number
  readonly approach: readonly P2[]
  readonly prop: Vec3 | null
}

export function placeAnchor(item: WorldItem, anchor: SimAnchor): PlacedAnchor {
  return {
    itemId: item.id,
    pose: anchor.pose,
    at: itemPoint(item, anchor.at),
    headingRad: anchor.headingRad + (item.turn * Math.PI) / 2,
    approach: anchor.approach.map((point) => {
      const [x, , z] = itemPoint(item, point)
      return { x, z }
    }),
    prop: anchor.prop === null ? null : itemPoint(item, anchor.prop),
  }
}

/** A home's fallback spot as an anchor the Sim walks to and takes its pose on. */
export function placeSpot(world: SimWorld, spot: SimSpot): PlacedAnchor | null {
  const slot = parseSlot(spot.slot, world)
  if (slot?.kind !== 'floor') return null
  const free = nearestFree(world, cellCenter(world, slot.c, slot.r))
  return {
    itemId: `spot-${spot.slot}`,
    pose: spot.pose,
    at: [free.x, spot.heightM, free.z],
    headingRad: spot.headingRad,
    approach: [free],
    prop: null,
  }
}

export function cellCenter(world: SimWorld, c: number, r: number): P2 {
  return {
    x: -world.widthM / 2 + (c + 0.5) * world.cellM,
    z: -world.depthM / 2 + (r + 0.5) * world.cellM,
  }
}

/** The cell a floor point is in, or null outside the room. */
export function cellOf(world: SimWorld, p: P2): readonly [number, number] | null {
  const c = Math.floor((p.x + world.widthM / 2) / world.cellM)
  const r = Math.floor((p.z + world.depthM / 2) / world.cellM)
  return c >= 0 && r >= 0 && c < world.cols && r < world.rows ? [c, r] : null
}

export function isFree(world: SimWorld, c: number, r: number): boolean {
  return (
    c >= 0 && r >= 0 && c < world.cols && r < world.rows && world.blocked[r * world.cols + c] === 0
  )
}

/** Whether a point is on free floor at least `clearance` from walls and furniture. */
export function pointClear(world: SimWorld, p: P2, clearance: number): boolean {
  const halfW = world.widthM / 2
  const halfD = world.depthM / 2
  if (p.x < -halfW + clearance || p.x > halfW - clearance) return false
  if (p.z < -halfD + clearance || p.z > halfD - clearance) return false
  for (const dx of [-clearance, clearance]) {
    for (const dz of [-clearance, clearance]) {
      const cell = cellOf(world, { x: p.x + dx, z: p.z + dz })
      if (cell === null || !isFree(world, cell[0], cell[1])) return false
    }
  }
  return true
}

const SAMPLE_M = 0.08

function segmentClear(world: SimWorld, a: P2, b: P2, clearance: number): boolean {
  const length = Math.hypot(b.x - a.x, b.z - a.z)
  const steps = Math.max(1, Math.ceil(length / SAMPLE_M))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    if (!pointClear(world, { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, clearance)) {
      return false
    }
  }
  return true
}

/** The free point nearest `p`: `p` itself on free floor, else the closest free cell's centre. */
export function nearestFree(world: SimWorld, p: P2): P2 {
  const cell = cellOf(world, p)
  if (cell !== null && isFree(world, cell[0], cell[1])) return p
  let best: P2 | null = null
  let bestDistance = Infinity
  for (let r = 0; r < world.rows; r++) {
    for (let c = 0; c < world.cols; c++) {
      if (!isFree(world, c, r)) continue
      const center = cellCenter(world, c, r)
      const distance = Math.hypot(center.x - p.x, center.z - p.z)
      if (distance < bestDistance) {
        bestDistance = distance
        best = center
      }
    }
  }
  return best ?? p
}

/** A floor tap pulled inside the room by `edge` (the open front included). */
export function insideRoom(world: SimWorld, p: P2, edge: number): P2 {
  const halfW = world.widthM / 2 - edge
  const halfD = world.depthM / 2 - edge
  return { x: Math.min(halfW, Math.max(-halfW, p.x)), z: Math.min(halfD, Math.max(-halfD, p.z)) }
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

/**
 * Where a walk toward `target` can end: `target` itself when its cell is free and connected to
 * the Sim's, else the centre of the connected free cell nearest it (a corner boxed in by
 * furniture is never reached through the furniture).
 */
export function reachableNear(world: SimWorld, from: P2, target: P2): P2 {
  const start = cellOf(world, from)
  if (start === null) return nearestFree(world, target)
  const { cols, rows } = world
  const seen = new Uint8Array(cols * rows)
  const queue: (readonly [number, number])[] = [start]
  seen[start[1] * cols + start[0]] = 1
  const free = (c: number, r: number) => isFree(world, c, r)
  for (let i = 0; i < queue.length; i++) {
    const [c, r] = queue[i] ?? start
    for (const [dc, dr] of NEIGHBOURS) {
      const nc = c + dc
      const nr = r + dr
      if (!free(nc, nr) || seen[nr * cols + nc] === 1) continue
      if (dc !== 0 && dr !== 0 && (!free(c + dc, r) || !free(c, r + dr))) continue
      seen[nr * cols + nc] = 1
      queue.push([nc, nr])
    }
  }
  const goal = cellOf(world, target)
  if (goal !== null && free(goal[0], goal[1]) && seen[goal[1] * cols + goal[0]] === 1) return target
  let best: P2 = from
  let bestDistance = Infinity
  for (const [c, r] of queue) {
    if (!free(c, r)) continue
    const center = cellCenter(world, c, r)
    const distance = Math.hypot(center.x - target.x, center.z - target.z)
    if (distance < bestDistance) {
      bestDistance = distance
      best = center
    }
  }
  return best
}

/**
 * A walking route from `from` to `to`: A* over the floor cells (8 ways, no corner cutting past
 * furniture), then pulled tight wherever a straight line keeps `clearance` from everything, so
 * the Sim walks in natural lines rather than cell by cell. The start and end cells may hold
 * furniture (the Sim gets up beside a sofa); null when nothing connects them.
 */
export function findPath(world: SimWorld, from: P2, to: P2, clearance: number): P2[] | null {
  const start = cellOf(world, from)
  const goal = cellOf(world, to)
  if (start === null || goal === null) return null
  const { cols, rows } = world
  const index = (c: number, r: number) => r * cols + c
  const startIndex = index(start[0], start[1])
  const goalIndex = index(goal[0], goal[1])
  const passable = (c: number, r: number) =>
    c >= 0 &&
    r >= 0 &&
    c < cols &&
    r < rows &&
    (world.blocked[index(c, r)] === 0 || index(c, r) === startIndex || index(c, r) === goalIndex)
  const cost = new Float64Array(cols * rows).fill(Infinity)
  const cameFrom = new Int32Array(cols * rows).fill(-1)
  const closed = new Uint8Array(cols * rows)
  const heuristic = (i: number) => {
    const dc = Math.abs((i % cols) - goal[0])
    const dr = Math.abs(Math.floor(i / cols) - goal[1])
    return Math.max(dc, dr) + (Math.SQRT2 - 1) * Math.min(dc, dr)
  }
  const open: number[] = [startIndex]
  cost[startIndex] = 0
  while (open.length > 0) {
    let at = 0
    for (let i = 1; i < open.length; i++) {
      const a = open[i] ?? 0
      const b = open[at] ?? 0
      if ((cost[a] ?? 0) + heuristic(a) < (cost[b] ?? 0) + heuristic(b)) at = i
    }
    const current = open.splice(at, 1)[0] ?? startIndex
    if (current === goalIndex) break
    if (closed[current] === 1) continue
    closed[current] = 1
    const c = current % cols
    const r = Math.floor(current / cols)
    for (const [dc, dr] of NEIGHBOURS) {
      const nc = c + dc
      const nr = r + dr
      if (!passable(nc, nr)) continue
      if (dc !== 0 && dr !== 0 && (!passable(c + dc, r) || !passable(c, r + dr))) continue
      const next = index(nc, nr)
      const step = dc !== 0 && dr !== 0 ? Math.SQRT2 : 1
      const total = (cost[current] ?? 0) + step
      if (total < (cost[next] ?? Infinity)) {
        cost[next] = total
        cameFrom[next] = current
        open.push(next)
      }
    }
  }
  if (startIndex !== goalIndex && cameFrom[goalIndex] === -1) return null
  const cells: number[] = []
  for (let i = goalIndex; i !== startIndex && i !== -1; i = cameFrom[i] ?? -1) cells.unshift(i)
  // The route through the cells' centres; the goal's own cell gives way to the exact point.
  const raw: P2[] = [from]
  for (const i of cells.slice(0, -1)) raw.push(cellCenter(world, i % cols, Math.floor(i / cols)))
  raw.push(to)
  const route: P2[] = [from]
  let i = 0
  while (i < raw.length - 1) {
    let j = raw.length - 1
    const here = raw[i] ?? from
    while (j > i + 1 && !segmentClear(world, here, raw[j] ?? to, clearance)) j--
    route.push(raw[j] ?? to)
    i = j
  }
  return route
}
