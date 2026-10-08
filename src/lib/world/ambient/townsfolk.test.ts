import { describe, expect, it } from 'vitest'
import ambientJson from '@data/config/ambient.json'
import townsfolkCopy from '@data/copy/townsfolk/base.json'
import { createTownsfolkSim, townsfolkProfile, type TownsfolkVenue } from './townsfolk'
import type { AmbientConfig } from './types'

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

const sim = (tier: 'low' | 'mid' | 'high' = 'mid', venues = VENUES) =>
  createTownsfolkSim({ venues, seed: config.seed, config: tf, tier, palette })

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
    const n1 = one.collect(300, 0, 2000, 12_345.5, 40, 1)
    const n2 = two.collect(300, 0, 2000, 12_345.5, 40, 1)
    expect(n1).toBe(n2)
    expect(one.samples.slice(0, n1)).toEqual(two.samples.slice(0, n2))
  })

  it('only simulates places near the camera target, and thins with the step-down share', () => {
    const s = sim()
    const near = s.collect(300, 0, 1000, 100, 40, 1)
    expect(near).toBe(3 * tf.perVenue.mid)
    const thinned = s.collect(300, 0, 1000, 100, 40, 0.3)
    expect(thinned).toBeLessThan(near)
  })

  it('visits only nearby places, walking between them over time', () => {
    const s = sim()
    const visited = new Set<number>()
    let walked = 0
    for (let t = 0; t < tf.epochS * 40; t += 2) {
      const n = s.collect(300, 0, 1000, t, 40, 1)
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

  it('stands locals on a ring in front of their place that grows with them', () => {
    const s = sim('mid', [{ id: 'solo', x: 0, y: 0 }])
    const at = (h: number) => {
      const n = s.collect(0, 0, 1000, 0, h, 1)
      return s.samples.slice(0, n).map((p) => ({ x: p.x, y: p.y, pose: p.pose }))
    }
    const small = at(10)
    const big = at(40)
    for (const p of small) expect(p.pose).not.toBe('walk')
    const spread = (list: { x: number; y: number }[]) =>
      Math.max(...list.map((p) => Math.hypot(p.x, p.y + tf.frontM)))
    expect(spread(big)).toBeCloseTo(spread(small) * 4, 5)
  })

  it('uses only the poses the tier bakes', () => {
    const s = sim('low')
    const poses = new Set<string>()
    for (let t = 0; t < tf.epochS * 20; t += 3) {
      const n = s.collect(300, 0, 1000, t, 40, 1)
      for (let i = 0; i < n; i++) poses.add(s.samples[i]?.pose ?? '')
    }
    for (const pose of poses) expect(tf.poses.low).toContain(pose)
  })
})
