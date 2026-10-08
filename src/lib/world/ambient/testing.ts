/**
 * Test fixtures for the ambient sim (S04l): a small street grid in the streets file's columns,
 * and the config as ambient.json holds it. Imported by tests only.
 */
import ambientJson from '@data/config/ambient.json'
import { encodePath } from '@/lib/geo/codec'
import { decodeStreets, type StreetsColumns, type StreetsData } from '../streetProps'
import { buildStreetGraph } from './graph'
import type { AmbientConfig, Circle, StreetGraph } from './types'

export const ambientConfig = ambientJson as unknown as AmbientConfig

/** A street of the grid fixture: its points, half-width and flags. */
interface FixtureStreet {
  readonly points: readonly { x: number; y: number }[]
  readonly halfWidthM: number
  readonly flags: number
}

/** Streets as the file's columns; junctions are the vertices other streets share. */
export function streetsColumns(streets: readonly FixtureStreet[]): StreetsColumns {
  const p: number[] = []
  const n: number[] = []
  const w: number[] = []
  const e: number[] = []
  const counts = new Map<string, number>()
  for (const street of streets) {
    for (const q of street.points)
      counts.set(`${q.x},${q.y}`, (counts.get(`${q.x},${q.y}`) ?? 0) + 1)
  }
  const junctions: number[] = []
  let vertex = 0
  for (const street of streets) {
    n.push(street.points.length)
    w.push(street.halfWidthM)
    e.push(street.flags)
    for (const q of street.points) {
      if ((counts.get(`${q.x},${q.y}`) ?? 0) > 1) junctions.push(vertex)
      vertex++
    }
  }
  const all = streets.flatMap((street) => street.points)
  p.push(...encodePath(all))
  const j = junctions.map((v, i) => v - (junctions[i - 1] ?? 0))
  return {
    zones: [{ id: 'midtown', x: 100, y: 100, r: 400 }],
    clear: [],
    chains: { n, p, w, j, e },
  }
}

/**
 * A 3 × 3 grid, 100 m blocks, crossings at 0, 100 and 200 on both axes, each street running 50 m
 * past the last crossing to a dead end. The middle east-west street (y = 100) is wide.
 */
export function gridStreets(): StreetsData {
  const streets: FixtureStreet[] = []
  for (const y of [0, 100, 200]) {
    streets.push({
      points: [-50, 0, 100, 200, 250].map((x) => ({ x, y })),
      halfWidthM: y === 100 ? 8 : 5,
      flags: y === 100 ? 4 : 0,
    })
  }
  for (const x of [0, 100, 200]) {
    streets.push({
      points: [-50, 0, 100, 200, 250].map((y) => ({ x, y })),
      halfWidthM: 5,
      flags: 0,
    })
  }
  return decodeStreets(streetsColumns(streets), ambientConfig.seed)
}

export function gridGraph(options: { pedestrianAvoid?: readonly Circle[] } = {}): StreetGraph {
  return buildStreetGraph(gridStreets(), {
    seed: ambientConfig.seed,
    cellM: ambientConfig.cellM,
    lights: ambientConfig.lights,
    vehicleAvoid: [],
    pedestrianAvoid: options.pedestrianAvoid ?? [],
  })
}
