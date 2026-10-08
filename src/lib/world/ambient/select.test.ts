import { describe, expect, it } from 'vitest'
import { densityShare, maxDensityLevel, slotActive } from './density'
import { selectDrawn } from './select'
import { ambientConfig } from './testing'
import type { AmbientConfig } from './types'
import type { AmbientConfigFile } from '@/lib/data/schemas/scene'

describe('selectDrawn', () => {
  const distances = [50, 10, 30, 10, 99, 5, 70]
  const candidates = (visible: (i: number) => boolean) => ({
    count: distances.length,
    distanceSq: (i: number) => (distances[i] ?? 0) ** 2,
    visible,
  })

  it('keeps the nearest visible candidates, ties by index, up to the cap', () => {
    const out = new Int32Array(8)
    const n = selectDrawn(
      candidates((i) => i !== 5),
      3,
      out,
    )
    expect([...out.subarray(0, n)]).toEqual([1, 3, 2])
  })

  it('takes them all under the cap, and none at cap 0', () => {
    const out = new Int32Array(16)
    expect(
      selectDrawn(
        candidates(() => true),
        99,
        out,
      ),
    ).toBe(distances.length)
    expect([...out.subarray(0, distances.length)]).toEqual([5, 1, 3, 2, 0, 6, 4])
    expect(
      selectDrawn(
        candidates(() => true),
        0,
        out,
      ),
    ).toBe(0)
  })

  it('never writes past the buffer', () => {
    const out = new Int32Array(2)
    expect(
      selectDrawn(
        candidates(() => true),
        10,
        out,
      ),
    ).toBe(2)
    expect([...out]).toEqual([5, 1])
  })

  it('draws nothing when nothing is in view', () => {
    expect(
      selectDrawn(
        candidates(() => false),
        5,
        new Int32Array(5),
      ),
    ).toBe(0)
  })
})

describe('ambient density', () => {
  const density = ambientConfig.density

  it('follows the step-down levels, clamped', () => {
    expect(densityShare(density, 0, 0)).toBe(density.steps[0])
    expect(densityShare(density, 1, 0)).toBe(density.steps[1])
    expect(densityShare(density, 99, 0)).toBe(density.steps[density.steps.length - 1])
    expect(densityShare(density, -1, 0)).toBe(density.steps[0])
    expect(maxDensityLevel(density)).toBe(density.steps.length - 1)
  })

  it('thins at night', () => {
    expect(densityShare(density, 0, 1)).toBeCloseTo((density.steps[0] ?? 1) * density.night)
    expect(densityShare(density, 0, 0.5)).toBeGreaterThan(densityShare(density, 0, 1))
  })

  it('keeps a nested active set', () => {
    for (const h of [0, 0.1, 0.29, 0.5, 0.59, 0.9]) {
      if (slotActive(h, 0.3)) expect(slotActive(h, 0.6)).toBe(true)
    }
  })

  it('reads the committed config through its schema type', () => {
    // The zod schema's output must satisfy the sim's config type.
    const file: AmbientConfigFile = ambientConfig as unknown as AmbientConfigFile
    const asSim: AmbientConfig = file
    expect(asSim.seed).toBe(ambientConfig.seed)
  })
})
