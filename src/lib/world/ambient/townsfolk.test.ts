import { describe, expect, it } from 'vitest'
import ambientJson from '@data/config/ambient.json'
import townsfolkCopy from '@data/copy/townsfolk/base.json'
import { cellKey } from './graph'
import {
  createTownsfolkSim,
  easedArc,
  smoothPolyline,
  townsfolkProfile,
  type TownsfolkVenue,
} from './townsfolk'
import type { AmbientConfig, NodeEnd, StreetEdge, StreetGraph } from './types'

const config = ambientJson as unknown as AmbientConfig
const tf = config.townsfolk
const palette = { skin: 12, tops: 8, bottoms: 6 }

/** Three places in a row 300 m apart, one far away. */
const VENUES: TownsfolkVenue[] = [
  { id: 'a', x: 0, y: 0 },
  { id: 'b', x: 300, y: 0 },
  { id: 'c', x: 600, y: 0 },
  { id: 'far', x: 50_000, y: 0 },
]

/** What the game map plans walks for: its tallest person × heightOfPlayer. */
const H = 19

/** A square street grid of `n` × `n` nodes `stepM` apart, from (x0, y0). */
function grid(n: number, stepM: number, x0: number, y0: number): StreetGraph {
  const nodes: { key: string; x: number; y: number; ends: NodeEnd[]; signal: null }[] = []
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + i * stepM
      const y = y0 + j * stepM
      nodes.push({ key: `${x},${y}`, x, y, ends: [], signal: null })
    }
  }
  const edges: StreetEdge[] = []
  const link = (a: number, b: number) => {
    const p = nodes[a]
    const q = nodes[b]
    if (p === undefined || q === undefined) return
    const e = edges.length
    edges.push({
      chain: e,
      from: a,
      to: b,
      points: [p, q],
      lengthM: Math.hypot(q.x - p.x, q.y - p.y),
      halfWidthM: 5,
      flags: 0,
      nearMemorial: false,
    })
    p.ends.push({ edge: e, atStart: true })
    q.ends.push({ edge: e, atStart: false })
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (i + 1 < n) link(j * n + i, j * n + i + 1)
      if (j + 1 < n) link(j * n + i, (j + 1) * n + i)
    }
  }
  const cellM = 250
  const cells = new Map<number, number[]>()
  edges.forEach((edge, e) => {
    const a = edge.points[0] ?? { x: 0, y: 0 }
    const b = edge.points[1] ?? a
    const key = cellKey(Math.floor((a.x + b.x) / 2 / cellM), Math.floor((a.y + b.y) / 2 / cellM))
    cells.set(key, [...(cells.get(key) ?? []), e])
  })
  return { nodes, edges, cells, cellM }
}

const sim = (
  tier: 'low' | 'mid' | 'high' = 'mid',
  venues = VENUES,
  graph: StreetGraph | null = null,
) =>
  createTownsfolkSim({
    venues,
    seed: config.seed,
    config: tf,
    tier,
    palette,
    heightM: H,
    graph,
  })

describe('townsfolk (S04o)', () => {
  it('gives every place its locals, with stable ids, names and both bodies', () => {
    const s = sim('mid')
    expect(s.residents).toHaveLength(VENUES.length * tf.perVenue.mid)
    const again = sim('mid')
    expect(again.residents.map((r) => r.profile)).toEqual(s.residents.map((r) => r.profile))
    expect(new Set(s.residents.map((r) => r.profile.id)).size).toBe(s.residents.length)
    const many = sim(
      'high',
      Array.from({ length: 40 }, (_, i) => ({ id: `v${i}`, x: i * 200, y: 0 })),
    )
    const bodies = new Set(many.residents.map((r) => r.profile.body))
    expect(bodies).toEqual(new Set(['woman', 'man']))
    for (const r of many.residents) {
      expect(tf.names[r.profile.body]).toContain(r.profile.name.split(' ')[0])
      expect(r.skin).toBeLessThan(palette.skin)
      expect(r.hair).toBeLessThan(tf.hair.length)
    }
    // Varied looks: more than a handful of skin tones and outfits across a city.
    expect(new Set(many.residents.map((r) => r.skin)).size).toBeGreaterThan(6)
    expect(new Set(many.residents.map((r) => `${r.top}-${r.bottom}`)).size).toBeGreaterThan(10)
  })

  it('has a copy line for every vibe', () => {
    const keys = Object.keys(townsfolkCopy.strings)
    for (const vibe of tf.vibes) expect(keys).toContain(`townsfolk.vibe.${vibe}`)
    expect(townsfolkProfile(1, 'x', 0, tf).profile.vibe).toMatch(/^[a-z]/)
  })

  it('is a pure function of the clock: the same time draws the same spots', () => {
    const one = sim()
    const two = sim()
    const n1 = one.collect(300, 0, 2000, 12_345.5, 1)
    const n2 = two.collect(300, 0, 2000, 12_345.5, 1)
    expect(n1).toBe(n2)
    expect(one.samples.slice(0, n1)).toEqual(two.samples.slice(0, n2))
  })

  it('only simulates places near the camera target, and thins with the step-down share', () => {
    const s = sim()
    const near = s.collect(300, 0, 1000, 100, 1)
    expect(near).toBe(3 * tf.perVenue.mid)
    const thinned = s.collect(300, 0, 1000, 100, 0.3)
    expect(thinned).toBeLessThan(near)
  })

  it('visits only nearby places, walking between them over time', () => {
    const s = sim()
    const visited = new Set<number>()
    let walked = 0
    for (let t = 0; t < tf.epochS * 40; t += 2) {
      const n = s.collect(300, 0, 1000, t, 1)
      for (let i = 0; i < n; i++) {
        const sample = s.samples[i]
        if (sample === undefined) continue
        if (sample.pose === 'walk') walked++
        const r = s.residents[sample.resident]
        if (r !== undefined && r.home === 0) visited.add(s.venueAt(sample.resident, t))
      }
    }
    expect(walked).toBeGreaterThan(0)
    expect(visited.has(0)).toBe(true)
    // "far" is beyond a walk of maxWalkShare of a cycle: never visited.
    expect(visited.has(3)).toBe(false)
  })

  it('stands locals on a ring in front of their place, spaced for their height', () => {
    const s = sim('mid', [{ id: 'solo', x: 0, y: 0 }])
    const n = s.collect(0, 0, 1000, 0, 1)
    const spots = s.samples.slice(0, n)
    for (const p of spots) expect(p.pose).not.toBe('walk')
    const radii = spots.map((p) => Math.hypot(p.x, p.y + tf.frontM))
    for (const r of radii) expect(r).toBeCloseTo(radii[0] ?? 0, 6)
    expect(radii[0]).toBeGreaterThanOrEqual(tf.minRingOfHeight * H)
  })

  it('uses only the poses the tier bakes', () => {
    const s = sim('low')
    const poses = new Set<string>()
    for (let t = 0; t < tf.epochS * 20; t += 3) {
      const n = s.collect(300, 0, 1000, t, 1)
      for (let i = 0; i < n; i++) poses.add(s.samples[i]?.pose ?? '')
    }
    for (const pose of poses) expect(tf.poses.low).toContain(pose)
  })

  it('never teleports: every step is within the walking pace, across stays and walks', () => {
    for (const graph of [null, grid(9, 120, -300, -400)]) {
      const s = sim('high', VENUES.slice(0, 3), graph)
      const last = new Map<number, { x: number; y: number }>()
      const dt = 0.1
      let fastest = 0
      for (let t = 0; t < tf.epochS * 12; t += dt) {
        const n = s.collect(300, 0, 1000, t, 1)
        for (let i = 0; i < n; i++) {
          const p = s.samples[i]
          if (p === undefined) continue
          const before = last.get(p.resident)
          if (before !== undefined) {
            fastest = Math.max(fastest, Math.hypot(p.x - before.x, p.y - before.y) / dt)
          }
          last.set(p.resident, { x: p.x, y: p.y })
        }
      }
      // Never faster than the pace a long walk may need to fit its cycle, and never a jump.
      expect(fastest).toBeGreaterThan(0)
      expect(fastest).toBeLessThan(tf.walkHeightsPerS * H * 2.5)
    }
  })

  it('walks the sidewalks of the street graph between places, easing in and out', () => {
    const venues = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 360, y: 240 },
    ]
    const graph = grid(9, 120, -240, -480)
    const s = sim('mid', venues, graph)
    let walk = null
    let resident = -1
    let start = 0
    for (let t = 0; t < tf.epochS * 30 && walk === null; t += 5) {
      for (let r = 0; r < s.residents.length; r++) {
        const w = s.walkOf(r, t)
        if (w !== null && w.streets) {
          walk = w
          resident = r
          start = t
          break
        }
      }
    }
    expect(walk).not.toBeNull()
    if (walk === null) return
    // Kept beside the streets (the grid lines), never down the middle of one.
    const side = 5 + tf.sidewalkOfHeight * H
    const { path } = walk
    let beside = 0
    for (let k = 0; k < path.xs.length; k++) {
      const x = path.xs[k] ?? 0
      const y = path.ys[k] ?? 0
      const dx = Math.abs((((x + 240) % 120) + 120) % 120)
      const dy = Math.abs((((y + 480) % 120) + 120) % 120)
      const toLine = Math.min(dx, 120 - dx, dy, 120 - dy)
      if (toLine > 1) beside++
      expect(toLine).toBeLessThan(side + 25)
    }
    expect(beside).toBeGreaterThan(path.xs.length * 0.8)
    // Speeds ramp: the first moving sample is slower than the cruise.
    const r = s.residents[resident]
    expect(r).toBeDefined()
    const speeds: number[] = []
    for (let t = start; t < start + tf.epochS; t += 0.1) {
      const n = s.collect(0, 0, 1000, t, 1)
      for (let i = 0; i < n; i++) {
        const p = s.samples[i]
        if (p?.resident === resident && p.pose === 'walk') speeds.push(p.speed)
      }
    }
    const moving = speeds.filter((v) => v > 0)
    expect(moving.length).toBeGreaterThan(10)
    expect(moving[0]).toBeLessThan(Math.max(...moving) * 0.5)
  })
})

describe('townsfolk motion helpers (S04q)', () => {
  it('eases a walk in and out and covers exactly its length', () => {
    const L = 300
    const v = 10
    const ease = 1
    const total = L / v + ease
    expect(easedArc(0, L, v, ease)).toEqual({ s: 0, v: 0 })
    expect(easedArc(total, L, v, ease).s).toBeCloseTo(L)
    expect(easedArc(total / 2, L, v, ease).v).toBe(v)
    let last = 0
    for (let t = 0; t <= total; t += 0.05) {
      const { s } = easedArc(t, L, v, ease)
      expect(s).toBeGreaterThanOrEqual(last - 1e-9)
      expect(s - last).toBeLessThanOrEqual(v * 0.05 + 1e-9)
      last = s
    }
  })

  it('smooths corners but keeps both ends', () => {
    const out = smoothPolyline(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      3,
    )
    expect(out[0]).toEqual({ x: 0, y: 0 })
    expect(out[out.length - 1]).toEqual({ x: 100, y: 100 })
    expect(out.some((p) => p.x === 100 && p.y === 0)).toBe(false)
  })
})
