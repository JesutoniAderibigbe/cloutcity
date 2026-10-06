/** S11 balance config: jobs, rent escalation and clout levels. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { engineConfig } from '@/engine/config'
import { BalanceConfigSchema, JOB_IDS, type BalanceConfig } from './schemas/config'
import { balance } from './config'

const valid = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../data/config/balance.json'), 'utf8'),
) as BalanceConfig

const parses = (patch: Partial<BalanceConfig>) =>
  BalanceConfigSchema.safeParse({ ...valid, ...patch }).success

describe('jobs config', () => {
  it('keeps the CLAUDE.md anchors: 4-hour shifts, delivery costs the most energy', () => {
    expect(balance.jobs.shiftHours).toBe(4)
    const delivery = balance.jobs.energyCostPerShift.delivery
    for (const id of JOB_IDS.filter((job) => job !== 'delivery')) {
      expect(delivery, id).toBeGreaterThan(balance.jobs.energyCostPerShift[id])
    }
  })

  it('gates junior dev, and only junior dev, behind a clout level above the first', () => {
    expect(Object.keys(balance.jobs.requiredCloutLevel)).toEqual(['junior-dev'])
    const level = balance.jobs.requiredCloutLevel['junior-dev']
    expect(balance.clout.levels.findIndex((entry) => entry.id === level)).toBeGreaterThan(0)
  })

  it('rejects an unknown required level, an energy cost above the max and a fractional shift', () => {
    const jobs = valid.jobs
    expect(parses({ jobs: { ...jobs, requiredCloutLevel: { 'junior-dev': 'mayor' } } })).toBe(false)
    expect(
      parses({
        jobs: { ...jobs, energyCostPerShift: { ...jobs.energyCostPerShift, retail: 101 } },
      }),
    ).toBe(false)
    expect(parses({ jobs: { ...jobs, shiftHours: 4.01 } })).toBe(false)
    expect(parses({ jobs: { ...jobs, shiftHours: 25 } })).toBe(false)
  })

  it('the engine reads the same numbers', () => {
    expect(engineConfig.jobs).toEqual(balance.jobs)
    expect(engineConfig.rentPerWeek).toEqual(balance.rentPerWeek)
    expect(engineConfig.startHome).toBe(balance.start.home)
  })
})

describe('rent config', () => {
  it('has one late fee for each miss before eviction', () => {
    expect(balance.rent.lateFees).toHaveLength(balance.rent.evictAfterMissed - 1)
    expect(parses({ rent: { lateFees: [0], evictAfterMissed: 3 } })).toBe(false)
    expect(parses({ rent: { lateFees: [], evictAfterMissed: 1 } })).toBe(true)
    expect(parses({ rent: { lateFees: [-5, 30], evictAfterMissed: 3 } })).toBe(false)
  })
})

describe('clout levels config', () => {
  it('has the six S13 levels, starting at Nobody with 0 clout', () => {
    expect(balance.clout.levels.map((level) => level.id)).toEqual([
      'nobody',
      'local',
      'scene-regular',
      'known',
      'famous',
      'icon',
    ])
    expect(balance.clout.levels[0]?.minClout).toBe(0)
  })

  it.each([
    ['a first level above 0', [{ id: 'nobody', minClout: 5 }]],
    [
      'thresholds that do not rise',
      [
        { id: 'nobody', minClout: 0 },
        { id: 'local', minClout: 0 },
      ],
    ],
    [
      'a repeated id',
      [
        { id: 'nobody', minClout: 0 },
        { id: 'nobody', minClout: 10 },
      ],
    ],
    ['no levels', []],
  ])('rejects %s', (_label, levels) => {
    const jobs = { ...valid.jobs, requiredCloutLevel: {} }
    expect(parses({ jobs, clout: { levels } })).toBe(false)
  })
})
