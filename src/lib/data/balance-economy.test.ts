/** Balance config for the economy: jobs, rent escalation and clout levels (S11), housing (S12). */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { engineConfig } from '@/engine/config'
import { cheapestHome } from '@/engine/rent'
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

describe('housing config', () => {
  const moveIn = (moveInCost: Record<string, number>) =>
    parses({ housing: { moveInCost } } as Partial<BalanceConfig>)

  it('prices every home but the lowest-rent one, and the engine reads the same numbers', () => {
    expect(Object.keys(balance.housing.moveInCost).sort()).toEqual([
      'brooklyn-1br',
      'manhattan-loft',
    ])
    expect(engineConfig.housing).toEqual(balance.housing)
    expect(engineConfig.costs).toEqual(balance.costs)
  })

  it.each([
    [
      'a cost for the lowest-rent home',
      { 'queens-room': 0, 'brooklyn-1br': 400, 'manhattan-loft': 1000 },
    ],
    ['a missing home', { 'brooklyn-1br': 400 }],
    ['an unknown home', { 'brooklyn-1br': 400, 'manhattan-loft': 1000, 'bronx-studio': 300 }],
    ['a negative cost', { 'brooklyn-1br': -1, 'manhattan-loft': 1000 }],
    ['a fractional cost', { 'brooklyn-1br': 400.5, 'manhattan-loft': 1000 }],
  ])('rejects %s', (_label, moveInCost) => {
    expect(moveIn(moveInCost)).toBe(false)
  })

  it('follows the lowest rent when it moves', () => {
    const rentPerWeek = { 'queens-room': 600, 'brooklyn-1br': 520, 'manhattan-loft': 1100 }
    const housing = { moveInCost: { 'queens-room': 300, 'manhattan-loft': 1000 } }
    expect(parses({ rentPerWeek, housing })).toBe(true)
    expect(parses({ rentPerWeek })).toBe(false)
  })

  it('on a tie for the lowest rent, exempts the same home the engine evicts to', () => {
    const rentPerWeek = { 'queens-room': 520, 'brooklyn-1br': 280, 'manhattan-loft': 280 }
    const evictTo = cheapestHome({ ...engineConfig, rentPerWeek })
    expect(evictTo).toBe('brooklyn-1br')
    const others = { 'queens-room': 300, 'manhattan-loft': 1000 }
    expect(parses({ rentPerWeek, housing: { moveInCost: others } })).toBe(true)
    const wrongOne = { 'queens-room': 300, 'brooklyn-1br': 400 }
    expect(parses({ rentPerWeek, housing: { moveInCost: wrongOne } })).toBe(false)
  })
})
