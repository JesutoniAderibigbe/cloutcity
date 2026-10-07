import { describe, expect, it } from 'vitest'
import { createSeededRng, rollInt } from './random'

describe('seeded random source', () => {
  it('replays the same sequence for the same seed', () => {
    const a = createSeededRng(42)
    const b = createSeededRng(42)
    const seqA = Array.from({ length: 20 }, () => a())
    const seqB = Array.from({ length: 20 }, () => b())
    expect(seqA).toEqual(seqB)
  })

  it('gives different sequences for different seeds', () => {
    expect(createSeededRng(1)()).not.toBe(createSeededRng(2)())
  })

  it('stays in [0, 1)', () => {
    const rng = createSeededRng(7)
    for (let i = 0; i < 10_000; i++) {
      const value = rng()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('rolls whole numbers inside the inclusive range, reaching both ends', () => {
    const rng = createSeededRng(3)
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) {
      const value = rollInt(rng, 5, 8)
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(5)
      expect(value).toBeLessThanOrEqual(8)
      seen.add(value)
    }
    expect([...seen].sort()).toEqual([5, 6, 7, 8])
  })
})
