/**
 * Save v9 (S16) and v13 (S40): owned decor and the apartment on its grid; migration from every
 * older version (legacy slot names go to the movers, starter pieces are added); repairs.
 */
import { describe, expect, it } from 'vitest'
import { V12_PLAYER_KEYS, unfurnished } from './test-support'
import { engineConfig as config } from './config'
import { initialApartment, type ApartmentState } from './home'
import { emptyInventory, type Inventory } from './items'
import {
  SAVE_VERSION,
  createSaveSchema,
  initialSave,
  loadSave,
  migrateSave,
  type SaveState,
} from './save'

const schema = createSaveSchema(config)
const NOW = 30_000
const base: SaveState = {
  ...unfurnished(initialSave(config)),
  clock: { minute: NOW, remainderMs: 0 },
}
const starterIds = initialSave(config).player.inventory.decor.map((owned) => owned.itemId)

const neon = 'custom-neon-sign' // wall
const lights = 'fairy-string-lights' // wall
const rug = 'thrift-flatweave-rug' // floor, 2×2, on the rug layer
const chair = 'cloud-lounge-chair' // floor, 1×1

const inventory: Inventory = {
  ...emptyInventory,
  decor: [
    { itemId: neon, acquiredMinute: 100, variant: 'mint' },
    { itemId: lights, acquiredMinute: 200, variant: 'warm-white', prestigeKept: true },
    { itemId: rug, acquiredMinute: 300, variant: 'teal' },
  ],
}
const apartment: ApartmentState = {
  ...initialApartment,
  placed: { 'w-back-0': neon, 'w-left-0': lights, 'f1-2': rug },
  moveLog: [
    { from: 'queens-room', to: 'brooklyn-1br', at: 1000, cost: 400 },
    { from: 'brooklyn-1br', to: 'queens-room', at: 2000, cost: 0 },
    { from: 'queens-room', to: 'brooklyn-1br', at: 3000, cost: 400 },
  ],
}
/** A save in Brooklyn with three decor items placed and three moves logged. */
const decorated: SaveState = {
  ...base,
  player: { ...base.player, home: 'brooklyn-1br', inventory, apartment },
}

const roundTrip = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown

/** `save` as an older version would have written it: no decor list and no apartment. */
function preV9(save: SaveState = base): Record<string, unknown> & {
  player: Record<string, unknown>
} {
  const oldInventory: Record<string, unknown> = { ...save.player.inventory }
  delete oldInventory.decor
  const player: Record<string, unknown> = { ...save.player, inventory: oldInventory }
  delete player.apartment
  delete player.location
  delete player.transit
  for (const key of V12_PLAYER_KEYS) delete player[key]
  // Nor the S18c (v11) action count.
  const out: Record<string, unknown> = { ...save, player }
  delete out.actions
  delete out.creator
  delete out.rolls
  return out as Record<string, unknown> & { player: Record<string, unknown> }
}

/** `save` as v12 wrote it: an apartment without finishes (its placements are given per test). */
function preV13(save: SaveState): Record<string, unknown> & { player: Record<string, unknown> } {
  return { ...save, player: { ...save.player } } as Record<string, unknown> & {
    player: Record<string, unknown>
  }
}

function load(save: unknown) {
  const result = loadSave(roundTrip(save), config)
  if (!result.ok) throw new Error(`unusable: ${result.issues.join(', ')}`)
  return result
}

const withPlayer = (patch: Record<string, unknown>) => ({
  ...decorated,
  player: { ...decorated.player, ...patch },
})

describe('save v13', () => {
  it('is version 13; a fresh save comes furnished with its starter pieces and has moved nowhere', () => {
    expect(SAVE_VERSION).toBe(13)
    const fresh = initialSave(config)
    expect(starterIds.length).toBeGreaterThanOrEqual(8)
    expect(Object.values(fresh.player.apartment.placed).sort()).toEqual([...starterIds].sort())
    expect(fresh.player.apartment).toMatchObject({
      moveLog: [],
      wallPaint: null,
      floorFinish: null,
      finishes: [],
    })
    expect(schema.safeParse(fresh).success).toBe(true)
  })

  it('round-trips turns, finishes and bought finishes untouched', () => {
    const save = {
      ...decorated,
      player: {
        ...decorated.player,
        inventory: {
          ...inventory,
          decor: inventory.decor.map((owned) =>
            owned.itemId === rug ? { ...owned, turn: 1 as const } : owned,
          ),
        },
        apartment: {
          ...apartment,
          wallPaint: 'mint-fresh',
          floorFinish: 'marble-tile',
          finishes: ['mint-fresh', 'marble-tile'],
        },
      },
    }
    expect(schema.safeParse(save).success).toBe(true)
    expect(loadSave(roundTrip(save), config)).toEqual({ ok: true, save, repaired: [] })
  })

  it('round-trips owned decor, variants, kept marks, placements and the move log untouched', () => {
    expect(schema.safeParse(decorated).success).toBe(true)
    expect(loadSave(roundTrip(decorated), config)).toEqual({
      ok: true,
      save: decorated,
      repaired: [],
    })
  })
})

describe('older saves -> v13', () => {
  it('a v12 save keeps its decor: the movers set slot-named placements up on the grid, and the starter pieces arrive', () => {
    const v12 = roundTrip({
      ...preV13(decorated),
      player: {
        ...preV13(decorated).player,
        home: 'queens-room',
        apartment: { placed: { 'wall-1': neon, 'floor-1': rug }, moveLog: apartment.moveLog },
      },
    })
    const migrated = migrateSave(v12, 12, config)
    expect(migrated.outcome).toBe('carried')
    const { inventory: owned, apartment: home } = migrated.save.player
    expect(Object.values(home.placed)).toEqual(expect.arrayContaining([neon, rug]))
    expect(owned.decor.map((entry) => entry.itemId)).toEqual(
      expect.arrayContaining([neon, lights, rug, ...starterIds]),
    )
    expect(home.moveLog).toEqual(apartment.moveLog)
    expect(schema.safeParse(migrated.save).success).toBe(true)
  })

  it('a v8 save keeps everything and starts furnished with the starter pieces and no moves', () => {
    const v8 = { ...preV9(), player: { ...preV9().player, cash: 777 } }
    const migrated = migrateSave(roundTrip(v8), 8, config)
    expect(migrated.outcome).toBe('carried')
    expect(migrated.save.player.cash).toBe(777)
    expect(migrated.save.player.inventory.decor.map((entry) => entry.itemId)).toEqual(starterIds)
    expect(Object.values(migrated.save.player.apartment.placed).sort()).toEqual(
      [...starterIds].sort(),
    )
    expect(migrated.save.player.apartment.moveLog).toEqual([])
    expect(schema.safeParse(migrated.save).success).toBe(true)
    // The missing fields are filled in, not reported as repairs.
    expect(load(v8).repaired).toEqual([])
  })

  it('every version v1 to v9 loads, carrying its progress', () => {
    const player = preV9().player as Record<string, unknown>
    const legacy = (version: number): Record<string, unknown> => {
      const out: Record<string, unknown> = { ...preV9() }
      const p: Record<string, unknown> = { ...player, cash: 500 + version }
      if (version < 8) {
        delete p.visited
        delete out.goals
        delete out.grants
        delete out.prestige
        delete out.creator
        delete out.rolls
      }
      if (version < 7) {
        p.clout = 0
        delete p.flex
      }
      if (version < 6) delete p.clubNights
      if (version < 5) delete out.events
      if (version < 4) delete p.inventory
      return { ...out, player: p }
    }
    const saves: Record<number, unknown> = {
      1: { player: { cash: 501 } },
      2: { clock: base.clock, player: { cash: 502, stats: base.player.stats }, speed: 1 },
      3: legacy(3),
      4: legacy(4),
      5: legacy(5),
      6: legacy(6),
      7: legacy(7),
      8: legacy(8),
    }
    for (const [version, persisted] of Object.entries(saves)) {
      const migrated = migrateSave(roundTrip(persisted), Number(version), config)
      expect(migrated.outcome, `v${version}`).toBe('carried')
      expect(migrated.save.player.cash, `v${version}`).toBe(500 + Number(version))
      expect(Object.values(migrated.save.player.apartment.placed).sort(), `v${version}`).toEqual(
        [...starterIds].sort(),
      )
      expect(schema.safeParse(migrated.save).success, `v${version}`).toBe(true)
    }
    const v9 = load({ ...decorated, player: { ...decorated.player, cash: 509 } })
    expect(v9.save.player.cash).toBe(509)
    expect(v9.repaired).toEqual([])
  })

  it('a v8 save holding a v9 field it could not have written is still checked, not trusted', () => {
    const tampered = {
      ...preV9(),
      player: { ...preV9().player, apartment: { placed: { 'wall-1': neon }, moveLog: [] } },
    }
    const migrated = migrateSave(roundTrip(tampered), 8, config)
    expect(migrated.outcome).toBe('carried')
    expect(Object.values(migrated.save.player.apartment.placed)).not.toContain(neon)
  })
})

describe('v13 repairs', () => {
  it.each([
    [
      'a cell the home does not have',
      { 'w-back-0': neon, 'w-back-9': lights },
      { 'w-back-0': neon },
    ],
    ['an old slot name', { 'w-back-0': neon, 'wall-2': lights }, { 'w-back-0': neon }],
    ['decor not owned', { 'w-back-0': neon, 'f4-2': chair }, { 'w-back-0': neon }],
    ['an item that is not decor', { 'w-back-0': 'bodega-graphic-tee' }, {}],
    [
      'decor on the wrong kind of cell',
      { 'f4-2': neon, 'w-left-0': lights },
      { 'w-left-0': lights },
    ],
    ['one item on two cells', { 'w-back-0': neon, 'w-back-1': neon }, { 'w-back-0': neon }],
    ['a non-string item', { 'w-back-0': 5, 'f1-2': rug }, { 'f1-2': rug }],
    ['a wall item over a window', { 'w-left-1': neon, 'f1-2': rug }, { 'f1-2': rug }],
    ['a rug off the grid', { 'w-back-0': neon, 'f5-4': rug }, { 'w-back-0': neon }],
  ])('drops a placement of %s and keeps the rest', (_label, placed, kept) => {
    const result = load(withPlayer({ apartment: { ...apartment, placed } }))
    expect(result.repaired).toEqual(['player.apartment'])
    expect(result.save.player.apartment).toEqual({ ...apartment, placed: kept })
    expect(schema.safeParse(result.save).success).toBe(true)
  })

  it('prototype-named slot keys from JSON are dropped without polluting anything', () => {
    const raw = JSON.parse(
      JSON.stringify(decorated).replace('"w-back-0":', '"__proto__":'),
    ) as SaveState
    const result = loadSave(raw, config)
    if (!result.ok) throw new Error('unusable')
    expect(result.save.player.apartment.placed).toEqual({ 'w-left-0': lights, 'f1-2': rug })
    expect(Object.getPrototypeOf(result.save.player.apartment.placed)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>)[neon]).toBeUndefined()
  })

  it.each([
    ['a move in the future', { from: 'brooklyn-1br', to: 'queens-room', at: NOW + 1, cost: 0 }],
    ['a move to the same home', { from: 'queens-room', to: 'queens-room', at: 3500, cost: 0 }],
    ['a move out of order', { from: 'brooklyn-1br', to: 'queens-room', at: 500, cost: 0 }],
    ['an unknown home', { from: 'brooklyn-1br', to: 'penthouse', at: 3500, cost: 0 }],
    ['a negative cost', { from: 'brooklyn-1br', to: 'queens-room', at: 3500, cost: -1 }],
    ['a malformed entry', 'moved'],
  ])('drops %s from the move log and keeps the rest', (_label, entry) => {
    const moveLog = [...apartment.moveLog, entry]
    const result = load(withPlayer({ apartment: { ...apartment, moveLog } }))
    expect(result.repaired).toEqual(['player.apartment'])
    expect(result.save.player.apartment.moveLog).toEqual(apartment.moveLog)
  })

  it('a move log longer than home.moveLogMax keeps the newest entries', () => {
    const moveLog = Array.from({ length: config.home.moveLogMax + 4 }, (_, i) => ({
      from: i % 2 === 0 ? 'queens-room' : 'brooklyn-1br',
      to: i % 2 === 0 ? 'brooklyn-1br' : 'queens-room',
      at: 100 + i,
      cost: 0,
    }))
    const result = load(withPlayer({ apartment: { ...apartment, moveLog } }))
    expect(result.repaired).toEqual(['player.apartment'])
    expect(result.save.player.apartment.moveLog).toEqual(moveLog.slice(-config.home.moveLogMax))
  })

  it('an apartment that is not an object starts empty', () => {
    for (const value of [null, 'junk', 7, []]) {
      const result = load(withPlayer({ apartment: value }))
      expect(result.repaired).toEqual(['player.apartment'])
      expect(result.save.player.apartment).toEqual(initialApartment)
    }
  })

  it('an unknown home is repaired to the start home, and placements it lacks go to storage', () => {
    const placed = { ...apartment.placed, 'f5-0': chair }
    const owned = {
      ...inventory,
      decor: [...inventory.decor, { itemId: chair, acquiredMinute: 1, variant: 'lilac' }],
    }
    const result = load(
      withPlayer({ home: 'penthouse', inventory: owned, apartment: { ...apartment, placed } }),
    )
    expect(result.save.player.home).toBe(config.startHome)
    expect(result.repaired).toEqual(['player.home', 'player.apartment'])
    // The Queens room is five cells wide: the chair's column is not in it.
    expect(result.save.player.apartment.placed).toEqual(apartment.placed)
    expect(schema.safeParse(result.save).success).toBe(true)
  })

  it('an unknown or misfiled finish shows the original; unknown or repeated bought finishes are dropped', () => {
    const result = load(
      withPlayer({
        apartment: {
          ...apartment,
          wallPaint: 'marble-tile',
          floorFinish: 'plaid',
          finishes: ['mint-fresh', 'mint-fresh', 'plaid', 7],
        },
      }),
    )
    expect(result.repaired).toEqual(['player.apartment'])
    expect(result.save.player.apartment).toMatchObject({
      wallPaint: null,
      floorFinish: null,
      finishes: ['mint-fresh'],
    })
  })

  it('repairs owned decor: unknown and duplicate items dropped, a bad colour shows the first, minutes clamped', () => {
    const decor = [
      { itemId: neon, acquiredMinute: NOW + 500, variant: 'plaid' },
      { itemId: neon, acquiredMinute: 1, variant: 'mint' },
      { itemId: 'bodega-graphic-tee', acquiredMinute: 1, variant: 'pink' },
      { itemId: '__proto__', acquiredMinute: 1, variant: 'pink' },
      { itemId: lights, acquiredMinute: -5, variant: 'pink', prestigeKept: 'yes' },
      { itemId: rug, acquiredMinute: 'soon', variant: 7, turn: 9 },
      'junk',
    ]
    const result = load(withPlayer({ inventory: { ...inventory, decor } }))
    expect(result.repaired).toContain('player.inventory')
    expect(result.save.player.inventory.decor).toEqual([
      { itemId: neon, acquiredMinute: NOW, variant: 'pink' },
      { itemId: lights, acquiredMinute: 0, variant: 'pink', prestigeKept: true },
      { itemId: rug, acquiredMinute: NOW, variant: 'oatmeal' },
    ])
    expect(schema.safeParse(result.save).success).toBe(true)
  })

  it('placements of decor the inventory does not hold are dropped', () => {
    const result = load(withPlayer({ inventory: { ...inventory, decor: [] } }))
    expect(result.repaired).toEqual(['player.apartment'])
    expect(result.save.player.apartment).toEqual({ ...apartment, placed: {} })
  })

  it('the schema rejects every inconsistency the repairs fix', () => {
    const bad: unknown[] = [
      withPlayer({ apartment: { ...apartment, placed: { 'w-back-9': neon } } }),
      withPlayer({ apartment: { ...apartment, placed: { 'f4-2': neon } } }),
      withPlayer({ apartment: { ...apartment, placed: { 'w-back-0': neon, 'w-back-1': neon } } }),
      withPlayer({ apartment: { ...apartment, placed: { 'w-left-1': neon } } }),
      withPlayer({ apartment: { ...apartment, wallPaint: 'plaid' } }),
      withPlayer({ apartment: { ...apartment, finishes: ['mint-fresh', 'mint-fresh'] } }),
      withPlayer({ inventory: { ...inventory, decor: [...inventory.decor, inventory.decor[0]] } }),
      withPlayer({
        inventory: { ...inventory, decor: [{ itemId: neon, acquiredMinute: 1, variant: 'x' }] },
      }),
      withPlayer({ apartment: { ...apartment, moveLog: [...apartment.moveLog].reverse() } }),
      withPlayer({ apartment: { ...apartment, extra: true } }),
    ]
    for (const [i, save] of bad.entries()) {
      expect(schema.safeParse(save).success, `case ${i}`).toBe(false)
    }
  })
})
