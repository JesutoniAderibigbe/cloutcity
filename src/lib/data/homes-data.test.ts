/**
 * S16/S40 home data: data/homes/interiors.json (grids, openings, fixtures, starter pieces),
 * data/homes/finishes.json, the balance `home` block and HOME_BOROUGHS.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { engineConfig } from '@/engine/config'
import { slotsFor } from '@/engine/home'
import { parseSlot } from '@/engine/homeGrid'
import { findItem, isDecor } from '@/engine/items'
import { createSaveSchema, initialSave } from '@/engine/save'
import { baseCopy } from '@/lib/copy/all'
import { HOME_BOROUGHS, HOME_IDS } from './homes'
import { BalanceConfigSchema, type BalanceConfig } from './schemas/config'
import { BOROUGHS, FinishesFileSchema, HomeInteriorsFileSchema } from './schemas/content'
import { balance } from './config'
import { homeInteriors, homes } from './content'

const DATA = join(import.meta.dirname, '../../../data')
const rawInteriors = JSON.parse(readFileSync(join(DATA, 'homes/interiors.json'), 'utf8')) as {
  homes: Record<string, Record<string, unknown>>
}
const validBalance = JSON.parse(
  readFileSync(join(DATA, 'config/balance.json'), 'utf8'),
) as BalanceConfig

const finishesFile = JSON.parse(readFileSync(join(DATA, 'homes/finishes.json'), 'utf8')) as {
  finishes: { id: string; kind: string; tokens: string[]; nameKey: string }[]
}
const theme = JSON.parse(readFileSync(join(DATA, 'config/theme.json'), 'utf8')) as {
  world: Record<string, string>
  models: Record<string, string>
}

const cells = (home: (typeof HOME_IDS)[number]) => {
  const { grid } = homeInteriors[home]
  return grid.cols * grid.rows
}

describe('data/homes/interiors.json (S40 grid)', () => {
  it('each tier has a bigger grid and a taller or equal ceiling than the one below', () => {
    expect(cells('brooklyn-1br')).toBeGreaterThan(cells('queens-room'))
    expect(cells('manhattan-loft')).toBeGreaterThan(cells('brooklyn-1br'))
    expect(homeInteriors['brooklyn-1br'].heightM).toBeGreaterThanOrEqual(
      homeInteriors['queens-room'].heightM,
    )
    expect(homeInteriors['manhattan-loft'].heightM).toBeGreaterThan(
      homeInteriors['brooklyn-1br'].heightM,
    )
  })

  it('every home has a door and a window, each inside its wall and none overlapping', () => {
    for (const home of HOME_IDS) {
      const { openings, grid } = homeInteriors[home]
      expect(
        openings.filter((o) => o.kind === 'door'),
        home,
      ).toHaveLength(1)
      expect(
        openings.some((o) => o.kind === 'window'),
        home,
      ).toBe(true)
      const used = new Set<string>()
      for (const opening of openings) {
        const length = opening.wall === 'back' ? grid.cols : grid.rows
        expect(opening.at + opening.span, `${home} ${opening.wall}`).toBeLessThanOrEqual(length)
        expect(opening.sillM + opening.heightM, home).toBeLessThan(homeInteriors[home].heightM)
        for (let i = opening.at; i < opening.at + opening.span; i++) {
          const id = `${opening.wall}-${i}`
          expect(used.has(id), `${home} ${id}`).toBe(false)
          used.add(id)
        }
      }
    }
  })

  it('fixtures and the avatar stand on distinct floor cells of the grid', () => {
    for (const home of HOME_IDS) {
      const { fixtures, avatar, grid } = homeInteriors[home]
      const spots = [...fixtures.map((f) => f.slot), avatar.slot]
      expect(new Set(spots).size, home).toBe(spots.length)
      for (const slot of spots) expect(parseSlot(slot, grid)?.kind, `${home} ${slot}`).toBe('floor')
    }
  })

  it('the start home is furnished with starter pieces only, every one fitting where it stands', () => {
    const fresh = initialSave(engineConfig)
    const starter = homeInteriors[engineConfig.startHome].starter
    expect(starter.length).toBeGreaterThanOrEqual(8)
    for (const entry of starter) {
      const item = findItem(entry.itemId, engineConfig)
      expect(item !== undefined && isDecor(item) && item.decor.starter, entry.itemId).toBe(true)
      expect(fresh.player.apartment.placed[entry.slot], entry.itemId).toBe(entry.itemId)
    }
    // The save schema re-checks every placement against the grid.
    expect(createSaveSchema(engineConfig).safeParse(fresh).success).toBe(true)
  })

  it("names finishes the data has, of the right kind, for each home's shell", () => {
    const kinds = new Map(finishesFile.finishes.map((finish) => [finish.id, finish.kind]))
    for (const home of HOME_IDS) {
      const { shell } = homeInteriors[home]
      expect(kinds.get(shell.wallPaint), home).toBe('wall')
      expect(kinds.get(shell.floorFinish), home).toBe('floor')
      if (shell.accentBack !== null) expect(kinds.get(shell.accentBack), home).toBe('wall')
    }
  })

  it('the engine reads the same grids, with blocked cells and walkways from the data', () => {
    for (const home of HOME_IDS) {
      const layout = engineConfig.home.layouts[home]
      const { grid, fixtures, avatar } = homeInteriors[home]
      expect(layout.size).toEqual({ cols: grid.cols, rows: grid.rows })
      expect(slotsFor(home, engineConfig)).toHaveLength(
        grid.cols * grid.rows + grid.cols + 2 * grid.rows,
      )
      for (const fixture of fixtures) expect(layout.blocked.has(fixture.slot), home).toBe(true)
      expect(layout.walkway.has(avatar.slot), home).toBe(true)
    }
  })
})

describe('data/homes/finishes.json (S40)', () => {
  it('parses, sells wall paints and floors, names each in copy and colours it from the world palette', () => {
    expect(FinishesFileSchema.safeParse(finishesFile).success).toBe(true)
    const keys = new Set(Object.keys(baseCopy.strings))
    expect(finishesFile.finishes.filter((f) => f.kind === 'wall').length).toBeGreaterThanOrEqual(6)
    expect(finishesFile.finishes.filter((f) => f.kind === 'floor').length).toBeGreaterThanOrEqual(6)
    for (const finish of finishesFile.finishes) {
      expect(keys.has(finish.nameKey), finish.nameKey).toBe(true)
      for (const token of finish.tokens) {
        expect(token in theme.world || token in theme.models, `${finish.id} ${token}`).toBe(true)
      }
    }
    expect(engineConfig.home.finishes.map((finish) => finish.id)).toEqual(
      finishesFile.finishes.map((finish) => finish.id),
    )
  })

  it('rejects a patterned finish with one colour, a free finish and a duplicate id', () => {
    const [first] = finishesFile.finishes
    const parse = (finishes: unknown[]) => FinishesFileSchema.safeParse({ finishes }).success
    expect(
      parse([
        ...finishesFile.finishes,
        { ...first, id: 'x', pattern: 'checker', tokens: ['butter-200'] },
      ]),
    ).toBe(false)
    expect(parse([...finishesFile.finishes, { ...first, id: 'y', price: 0 }])).toBe(false)
    expect(parse([...finishesFile.finishes, first])).toBe(false)
  })
})

describe('HomeInteriorsFileSchema', () => {
  const queens = rawInteriors.homes['queens-room'] as Record<string, unknown> & {
    fixtures: Record<string, unknown>[]
  }
  const withQueens = (patch: Record<string, unknown>) =>
    HomeInteriorsFileSchema.safeParse({
      homes: { ...rawInteriors.homes, 'queens-room': { ...queens, ...patch } },
    }).success

  it('accepts the shipped file and rejects a missing or extra home', () => {
    expect(HomeInteriorsFileSchema.safeParse(rawInteriors).success).toBe(true)
    const rest = Object.fromEntries(
      Object.entries(rawInteriors.homes).filter(([id]) => id !== 'manhattan-loft'),
    )
    expect(HomeInteriorsFileSchema.safeParse({ homes: rest }).success).toBe(false)
    expect(
      HomeInteriorsFileSchema.safeParse({ homes: { ...rawInteriors.homes, penthouse: queens } })
        .success,
    ).toBe(false)
  })

  it.each([
    ['a cell id in the old slot form', { avatar: { slot: 'floor-1', rotationDeg: 0 } }],
    ['a grid of two columns', { grid: { cols: 2, rows: 4, cellM: 1 } }],
    ['no openings', { openings: [] }],
    ['an unknown fixture kind', { fixtures: [{ kind: 'oven', slot: 'f0-0', turn: 0 }] }],
    [
      'a turn that is not a quarter turn',
      { starter: [{ itemId: 'starter-bed', slot: 'f3-0', turn: 5 }] },
    ],
    ['an extra key', { price: 5 }],
  ])('rejects %s', (_label, patch) => {
    expect(withQueens(patch)).toBe(false)
  })
})

describe('balance.json home (S16)', () => {
  const parses = (patch: Partial<BalanceConfig['home']>) =>
    BalanceConfigSchema.safeParse({ ...validBalance, home: { ...validBalance.home, ...patch } })
      .success

  it('ships the TUNE-8 placeholders: base scores 0/10/25, clout cap 60, 20 moves kept, 4% upkeep', () => {
    expect(balance.home).toEqual({
      baseScore: { 'queens-room': 0, 'brooklyn-1br': 10, 'manhattan-loft': 25 },
      maxClout: 60,
      moveLogMax: 20,
      upkeepPctPerWeek: 4,
    })
    expect(engineConfig.home).toMatchObject(balance.home)
  })

  it('rejects a start home that adds clout, a base above the cap, a cap at the top level and bad numbers', () => {
    const base = validBalance.home.baseScore
    expect(parses({ baseScore: { ...base, 'queens-room': 1 } })).toBe(false)
    expect(parses({ baseScore: { ...base, 'manhattan-loft': 61 } })).toBe(false)
    expect(parses({ maxClout: 5000 })).toBe(false)
    expect(parses({ maxClout: 0 })).toBe(false)
    expect(parses({ moveLogMax: 0 })).toBe(false)
    expect(parses({ upkeepPctPerWeek: 0 })).toBe(false)
    expect(parses({ baseScore: { ...base, 'brooklyn-1br': 2.5 } })).toBe(false)
    expect(parses({})).toBe(true)
  })
})

describe('HOME_BOROUGHS', () => {
  it('places every home in a borough', () => {
    expect(Object.keys(HOME_BOROUGHS).sort()).toEqual([...HOME_IDS].sort())
    for (const borough of Object.values(HOME_BOROUGHS)) {
      expect(BOROUGHS as readonly string[]).toContain(borough)
    }
  })

  // INT-11: the engine's lock rule (HOME_BOROUGHS) and S05's map placement (homes.json) must agree.
  it('matches the borough each home sits in on the map (data/homes/homes.json)', () => {
    for (const id of HOME_IDS) expect(homes[id].borough).toBe(HOME_BOROUGHS[id])
  })
})
