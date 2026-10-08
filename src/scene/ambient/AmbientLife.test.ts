import { describe, expect, it } from 'vitest'
import { lineColors } from '../geo/buildSubway'
import { ambientCaps, trainLineColors } from './AmbientLife'
import { perf } from '@/lib/data/config'

describe('AmbientLife helpers', () => {
  it('colours trains exactly as the subway ribbons', () => {
    const lines = ['Q', 'A', '7', 'L', 'G'].map((id) => ({ id }))
    const palette = ['#111111', '#222222', '#333333']
    expect(trainLineColors(lines, palette)).toEqual(lineColors(lines, palette))
  })

  it('reads the tier caps from perf.json ambient', () => {
    for (const tier of ['low', 'mid', 'high'] as const) {
      expect(ambientCaps(tier)).toEqual({
        vehicle: perf.ambient.instancesMax.vehicle[tier],
        bus: perf.ambient.instancesMax.bus[tier],
        pedestrian: perf.ambient.instancesMax.pedestrian[tier],
        trainCar: perf.ambient.instancesMax.trainCar[tier],
        triangles: perf.ambient.trianglesMax[tier],
        drawCalls: perf.ambient.drawCallsMax[tier],
      })
    }
  })
})
