/**
 * The street graph the living city drives and walks on (S04l), built once from the decoded LION
 * chains (src/lib/world/streetProps.ts decodeStreets). Nodes are the chains' junction vertices
 * and ends, merged by their integer point (chains that meet share the exact vertex, as
 * `placeJunctions` relies on); edges are the stretches of a chain between consecutive nodes.
 *
 * Vehicles never use an edge that reaches into a `vehicleAvoid` circle (the streets file's
 * memorial clearances, already cut away by the build: this is the belt to its braces).
 * Pedestrians never use one that reaches into a `pedestrianAvoid` circle (memorial clearance
 * plus `pedestrians.memorialMarginM`).
 *
 * Pure and deterministic: the same chains and seed give the same graph, signals included.
 */
import type { StreetsData } from '../streetProps'
import { hash01, segmentDistance, type XY } from './path'
import type {
  Circle,
  LightsConfig,
  NodeEnd,
  Signal,
  StreetEdge,
  StreetGraph,
  StreetNode,
} from './types'

/** Numeric key of a `cellM` square (cells stay within ±2^15 of the origin). */
export const cellKey = (cx: number, cy: number) => (cx + 32768) * 65536 + (cy + 32768)

export interface GraphOptions {
  readonly seed: number
  readonly cellM: number
  readonly lights: Pick<LightsConfig, 'cycleS' | 'minEnds'>
  readonly vehicleAvoid: readonly Circle[]
  readonly pedestrianAvoid: readonly Circle[]
}

function touches(points: readonly XY[], circles: readonly Circle[]): boolean {
  for (const c of circles) {
    for (let i = 0; i < points.length; i++) {
      const a = points[i]
      const b = points[i + 1] ?? a
      if (a === undefined || b === undefined) continue
      if (segmentDistance(c, a, b) < c.r) return true
    }
  }
  return false
}

/** Unit direction leaving a node along an edge end. */
export function endDirection(edge: StreetEdge, atStart: boolean): { x: number; y: number } {
  const pts = edge.points
  const a = atStart ? pts[0] : pts[pts.length - 1]
  const b = atStart ? pts[1] : pts[pts.length - 2]
  if (a === undefined || b === undefined) return { x: 0, y: 1 }
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }
}

export function buildStreetGraph(data: StreetsData, options: GraphOptions): StreetGraph {
  const nodeIndex = new Map<string, number>()
  const nodePoints: XY[] = []
  const nodeEnds: NodeEnd[][] = []
  const edges: StreetEdge[] = []

  const nodeAt = (p: XY): number => {
    const key = `${p.x},${p.y}`
    let i = nodeIndex.get(key)
    if (i === undefined) {
      i = nodePoints.length
      nodeIndex.set(key, i)
      nodePoints.push({ x: p.x, y: p.y })
      nodeEnds.push([])
    }
    return i
  }

  data.chains.forEach((chain, c) => {
    const stops = new Set<number>(chain.junctions)
    stops.add(0)
    stops.add(chain.points.length - 1)
    const ks = [...stops].sort((a, b) => a - b)
    for (let s = 1; s < ks.length; s++) {
      const k0 = ks[s - 1] ?? 0
      const k1 = ks[s] ?? 0
      const points = chain.points.slice(k0, k1 + 1)
      const lengthM = (chain.along[k1] ?? 0) - (chain.along[k0] ?? 0)
      const first = points[0]
      const last = points[points.length - 1]
      if (first === undefined || last === undefined || lengthM < 1) continue
      if (touches(points, options.vehicleAvoid)) continue
      const from = nodeAt(first)
      const to = nodeAt(last)
      const e = edges.length
      edges.push({
        chain: c,
        from,
        to,
        points,
        lengthM,
        halfWidthM: chain.halfWidthM,
        flags: chain.flags,
        nearMemorial: touches(points, options.pedestrianAvoid),
      })
      nodeEnds[from]?.push({ edge: e, atStart: true })
      nodeEnds[to]?.push({ edge: e, atStart: false })
    }
  })

  const nodes: StreetNode[] = nodePoints.map((p, i) => {
    const ends = nodeEnds[i] ?? []
    let signal: Signal | null = null
    const first = ends[0]
    const firstEdge = first === undefined ? undefined : edges[first.edge]
    if (ends.length >= options.lights.minEnds && first !== undefined && firstEdge !== undefined) {
      const d = endDirection(firstEdge, first.atStart)
      signal = {
        offsetS: hash01(options.seed, p.x, p.y, 0x5167) * options.lights.cycleS,
        axisX: d.x,
        axisY: d.y,
      }
    }
    return { key: `${p.x},${p.y}`, x: p.x, y: p.y, ends, signal }
  })

  const cells = new Map<number, number[]>()
  edges.forEach((edge, e) => {
    const a = edge.points[0] ?? { x: 0, y: 0 }
    const b = edge.points[edge.points.length - 1] ?? a
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    const key = cellKey(Math.floor(mx / options.cellM), Math.floor(my / options.cellM))
    const list = cells.get(key)
    if (list === undefined) cells.set(key, [e])
    else list.push(e)
  })

  return { nodes, edges, cells, cellM: options.cellM }
}
