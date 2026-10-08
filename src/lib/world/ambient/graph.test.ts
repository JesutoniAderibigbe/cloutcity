import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StreetsFileSchema } from '@/lib/data/schemas/world'
import { decodeStreets } from '../streetProps'
import { buildStreetGraph, cellKey } from './graph'
import { approachAxis, isGreen, nextGreen } from './lights'
import { segmentDistance } from './path'
import { ambientConfig, gridGraph } from './testing'

const ROOT = join(import.meta.dirname, '../../../..')
const realStreets = () =>
  decodeStreets(
    StreetsFileSchema.parse(
      JSON.parse(readFileSync(join(ROOT, 'data/geo/streets.derived.json'), 'utf8')),
    ),
    ambientConfig.seed,
  )

describe('street graph', () => {
  it('splits the grid into edges between junctions and ends', () => {
    const graph = gridGraph()
    // 6 streets × 4 stretches each.
    expect(graph.edges).toHaveLength(24)
    // 9 crossings + 12 dead ends.
    expect(graph.nodes).toHaveLength(21)
    const crossings = graph.nodes.filter((node) => node.ends.length === 4)
    expect(crossings).toHaveLength(9)
    expect(graph.nodes.filter((node) => node.ends.length === 1)).toHaveLength(12)
    for (const node of crossings) expect(node.signal).not.toBeNull()
    for (const node of graph.nodes.filter((n) => n.ends.length === 1)) {
      expect(node.signal).toBeNull()
    }
  })

  it('is deterministic and seeds the signal offsets', () => {
    const a = gridGraph()
    const b = gridGraph()
    expect(a.nodes.map((n) => n.signal?.offsetS)).toEqual(b.nodes.map((n) => n.signal?.offsetS))
    const offsets = new Set(a.nodes.flatMap((n) => (n.signal ? [n.signal.offsetS] : [])))
    expect(offsets.size).toBeGreaterThan(1)
  })

  it('files every edge under the cell of its midpoint', () => {
    const graph = gridGraph()
    const filed = [...graph.cells.values()].flat().sort((a, b) => a - b)
    expect(filed).toEqual(graph.edges.map((_, i) => i))
    expect(graph.cells.has(cellKey(0, 0))).toBe(true)
  })

  it('flags edges in a pedestrian clearance and drops edges in a vehicle one', () => {
    const flagged = gridGraph({ pedestrianAvoid: [{ x: 100, y: 100, r: 20 }] })
    expect(flagged.edges.filter((edge) => edge.nearMemorial)).toHaveLength(4)
    const real = realStreets()
    const graph = buildStreetGraph(real, {
      seed: 1,
      cellM: 250,
      lights: ambientConfig.lights,
      vehicleAvoid: real.clear,
      pedestrianAvoid: [],
    })
    for (const edge of graph.edges) {
      for (const c of real.clear) {
        for (let k = 1; k < edge.points.length; k++) {
          const a = edge.points[k - 1]
          const b = edge.points[k]
          if (a && b) expect(segmentDistance(c, a, b)).toBeGreaterThanOrEqual(c.r)
        }
      }
    }
  })

  it('connects the real streets: most junction nodes join several edges', () => {
    const real = realStreets()
    const graph = buildStreetGraph(real, {
      seed: ambientConfig.seed,
      cellM: ambientConfig.cellM,
      lights: ambientConfig.lights,
      vehicleAvoid: real.clear,
      pedestrianAvoid: [],
    })
    expect(graph.edges.length).toBeGreaterThan(3000)
    const signals = graph.nodes.filter((node) => node.signal !== null).length
    expect(signals).toBeGreaterThan(1000)
    const deadEnds = graph.nodes.filter((node) => node.ends.length === 1).length
    expect(deadEnds / graph.nodes.length).toBeLessThan(0.35)
  })
})

describe('traffic lights', () => {
  const signal = { offsetS: 7, axisX: 1, axisY: 0 }
  const lights = ambientConfig.lights

  it('never shows green to both axes at once and has all-red gaps', () => {
    let allRed = 0
    for (let t = 0; t < lights.cycleS * 3; t += 0.25) {
      const a = isGreen(signal, 0, t, lights)
      const b = isGreen(signal, 1, t, lights)
      expect(a && b).toBe(false)
      if (!a && !b) allRed++
    }
    expect(allRed).toBeGreaterThan(0)
  })

  it('gives each axis its green share of the cycle', () => {
    for (const axis of [0, 1] as const) {
      let green = 0
      const steps = 4000
      for (let i = 0; i < steps; i++) {
        if (isGreen(signal, axis, (i / steps) * lights.cycleS, lights)) green++
      }
      expect(green / steps).toBeCloseTo(lights.greenShare, 2)
    }
  })

  it('finds the next green', () => {
    for (let t = 0; t < 100; t += 0.7) {
      for (const axis of [0, 1] as const) {
        const g = nextGreen(signal, axis, t, lights)
        expect(g).toBeGreaterThanOrEqual(t)
        expect(isGreen(signal, axis, g + 1e-6, lights)).toBe(true)
        if (g > t) expect(isGreen(signal, axis, (t + g) / 2, lights)).toBe(false)
      }
    }
  })

  it('puts approaches along the axis on axis 0, crossing ones on axis 1', () => {
    expect(approachAxis(signal, -1, 0.1, lights)).toBe(0)
    expect(approachAxis(signal, 0.1, 1, lights)).toBe(1)
  })
})
