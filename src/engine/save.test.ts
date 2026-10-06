import { describe, expect, it } from 'vitest'
import { engineConfig as config } from './config'
import { emptyInventory } from './items'
import { SAVE_VERSION, createSaveSchema, initialSave, loadSave, migrateSave } from './save'

const schema = createSaveSchema(config)

describe('save schema', () => {
  it('accepts a fresh save', () => {
    expect(SAVE_VERSION).toBe(4)
    expect(schema.safeParse(initialSave(config)).success).toBe(true)
  })

  it('round-trips through JSON', () => {
    const save = {
      ...initialSave(config),
      clock: { minute: 12_345, remainderMs: 1234.5 },
      speed: 2,
    }
    const parsed = schema.safeParse(JSON.parse(JSON.stringify(save)))
    expect(parsed.success && parsed.data).toEqual(save)
  })

  it.each([
    ['a remainder of a whole game minute', { clock: { minute: 0, remainderMs: 6000 } }],
    ['a negative minute', { clock: { minute: -1, remainderMs: 0 } }],
    ['speed 0', { speed: 0 }],
  ])('rejects %s', (_label, patch) => {
    expect(schema.safeParse({ ...initialSave(config), ...patch }).success).toBe(false)
  })
})

describe('save migration', () => {
  it('v1 -> v2 keeps cash and starts the clock and stats fresh', () => {
    const migrated = migrateSave({ player: { cash: 420 } }, 1, config)
    expect(migrated.outcome).toBe('carried')
    expect(migrated.save).toEqual({
      ...initialSave(config),
      player: { ...initialSave(config).player, cash: 420 },
    })
    expect(schema.safeParse(migrated.save).success).toBe(true)
  })

  it.each([
    ['a malformed v1 save', { player: { cash: -3 } }, 1],
    ['a v1 save with unknown keys', { player: { cash: 3 }, admin: true }, 1],
    ['a pre-release v0 save', { money: 5 }, 0],
  ])('starts %s fresh', (_label, persisted, version) => {
    expect(migrateSave(persisted, version, config)).toEqual({
      save: initialSave(config),
      outcome: 'fresh',
    })
  })

  it('refuses a save from a newer build', () => {
    expect(() => migrateSave(initialSave(config), SAVE_VERSION + 1, config)).toThrow(/newer/)
  })
})

describe('save edge cases', () => {
  it.each([
    ['a negative remainder', { clock: { minute: 0, remainderMs: -0.5 } }],
    ['a remainder above one game minute', { clock: { minute: 0, remainderMs: 6000.5 } }],
    ['a fractional stat', { player: { cash: 1, stats: { energy: 1.5, hunger: 1, mood: 1 } } }],
    ['a missing stats object', { player: { cash: 1 } }],
  ])('rejects %s', (_label, patch) => {
    expect(schema.safeParse({ ...initialSave(config), ...patch }).success).toBe(false)
  })

  it('accepts a remainder just under one game minute', () => {
    const save = { ...initialSave(config), clock: { minute: 0, remainderMs: 5999.999 } }
    expect(schema.safeParse(save).success).toBe(true)
  })

  it('a speed the current config no longer offers fails validation', () => {
    const only1x = { ...config, time: { ...config.time, speeds: [1] } }
    expect(createSaveSchema(only1x).safeParse({ ...initialSave(config), speed: 2 }).success).toBe(
      false,
    )
  })

  it('starts a v1 save with an extra key inside player fresh', () => {
    expect(migrateSave({ player: { cash: 3, name: 'x' } }, 1, config).outcome).toBe('fresh')
  })

  it('v1 -> v2 round-trips through JSON with cash intact', () => {
    const { save } = migrateSave(JSON.parse('{"player":{"cash":9999}}'), 1, config)
    const parsed = schema.safeParse(JSON.parse(JSON.stringify(save)))
    expect(parsed.success && parsed.data.player.cash).toBe(9999)
  })

  it.each([null, undefined, 'junk', 42, []])('starts a v1 save of %j fresh', (persisted) => {
    expect(migrateSave(persisted, 1, config).outcome).toBe('fresh')
  })
})

describe('loading repairs individual fields', () => {
  const base = initialSave(config)

  it('loads a valid save unchanged', () => {
    expect(loadSave(base, config)).toEqual({ ok: true, save: base, repaired: [] })
  })

  it.each([
    ['a negative remainder', { clock: { minute: 900, remainderMs: -1 } }, 'clock.remainderMs'],
    [
      'a whole-minute remainder',
      { clock: { minute: 900, remainderMs: 6000 } },
      'clock.remainderMs',
    ],
    ['a non-numeric remainder', { clock: { minute: 900, remainderMs: null } }, 'clock.remainderMs'],
    ['an unsupported speed', { speed: 3 }, 'speed'],
    ['a speed of the wrong type', { speed: '2' }, 'speed'],
  ])('repairs %s and keeps the rest', (_label, patch, field) => {
    const result = loadSave({ ...base, player: { ...base.player, cash: 321 }, ...patch }, config)
    if (!result.ok) throw new Error('expected a repaired save')
    expect(result.repaired).toEqual([field])
    expect(result.save.player.cash).toBe(321)
    expect(result.save.speed).toBe(field === 'speed' ? 1 : base.speed)
    expect(result.save.clock.remainderMs).toBe(0)
    expect(schema.safeParse(result.save).success).toBe(true)
  })

  it('clamps out-of-range stats and rounds fractional ones', () => {
    const stats = { energy: 250, hunger: -4, mood: 49.5 }
    const result = loadSave({ ...base, player: { ...base.player, cash: 1, stats } }, config)
    expect(result.ok && result.save.player.stats).toEqual({ energy: 100, hunger: 0, mood: 50 })
    expect(result.ok && result.repaired).toEqual([
      'player.stats.energy',
      'player.stats.hunger',
      'player.stats.mood',
    ])
  })

  it.each([
    ['negative cash', { player: { ...base.player, cash: -1 } }],
    ['fractional cash', { player: { ...base.player, cash: 1.5 } }],
    ['cash of the wrong type', { player: { ...base.player, cash: '5' } }],
    ['a fractional minute', { clock: { minute: 1.5, remainderMs: 0 } }],
    ['a missing clock', { clock: undefined }],
    ['a missing stats object', { player: { cash: 1 } }],
    [
      'a stat of the wrong type',
      { player: { cash: 1, stats: { energy: 'x', hunger: 1, mood: 1 } } },
    ],
    ['an unknown key', { admin: true }],
  ])('refuses a structurally unusable save: %s', (_label, patch) => {
    expect(loadSave({ ...base, ...patch }, config).ok).toBe(false)
  })

  it.each([null, 'junk', 42, []])('refuses %j', (persisted) => {
    expect(loadSave(persisted, config).ok).toBe(false)
  })
})

describe('save v3: clout, home and rent', () => {
  const base = initialSave(config)

  it('a fresh save starts with no clout, the start home and nothing owed', () => {
    expect(base.player).toMatchObject({
      clout: 0,
      home: config.startHome,
      rent: { owed: 0, missed: 0 },
    })
  })

  it('v2 -> v3 keeps the clock, cash, stats and speed and adds the new fields', () => {
    const v2 = {
      clock: { minute: 9000, remainderMs: 12 },
      player: { cash: 420, stats: { energy: 50, hunger: 40, mood: 30 } },
      speed: 2,
    }
    const migrated = migrateSave(v2, 2, config)
    expect(migrated).toEqual({
      outcome: 'carried',
      save: {
        ...v2,
        player: {
          ...v2.player,
          clout: 0,
          home: config.startHome,
          rent: { owed: 0, missed: 0 },
          inventory: emptyInventory,
        },
      },
    })
    expect(schema.safeParse(migrated.save).success).toBe(true)
  })

  it('v2 -> v3 repairs out-of-range v2 fields on the way', () => {
    const v2 = {
      clock: { minute: 9000, remainderMs: -4 },
      player: { cash: 5, stats: { energy: 500, hunger: 40, mood: 30 } },
      speed: 7,
    }
    const { save, outcome } = migrateSave(v2, 2, config)
    expect(outcome).toBe('carried')
    expect(save.clock.remainderMs).toBe(0)
    expect(save.player.stats.energy).toBe(config.stats.max)
    expect(save.speed).toBe(1)
  })

  it.each([
    ['a malformed v2 save', { clock: { minute: -1, remainderMs: 0 }, player: {}, speed: 1 }],
    ['a v2 save that already has v3 keys', base],
    ['junk', 'junk'],
  ])('starts %s fresh', (_label, persisted) => {
    expect(migrateSave(persisted, 2, config)).toEqual({ save: base, outcome: 'fresh' })
  })

  it.each([
    ['an unknown home', { ...base.player, home: 'penthouse' }],
    ['negative clout', { ...base.player, clout: -1 }],
    ['negative rent owed', { ...base.player, rent: { owed: -1, missed: 0 } }],
    ['a missed count at the eviction step', { ...base.player, rent: { owed: 0, missed: 3 } }],
  ])('the schema rejects %s', (_label, player) => {
    const evictAt3 = { ...config, rent: { lateFees: [0, 30], evictAfterMissed: 3 } }
    expect(createSaveSchema(evictAt3).safeParse({ ...base, player }).success).toBe(false)
  })

  it('repairs an unknown home and an out-of-range missed count', () => {
    const player = { ...base.player, home: 'penthouse', rent: { owed: 90, missed: 99 } }
    const result = loadSave({ ...base, player }, config)
    if (!result.ok) throw new Error('expected a repaired save')
    expect(result.repaired).toEqual(['player.home', 'player.rent.missed'])
    expect(result.save.player.home).toBe(config.startHome)
    expect(result.save.player.rent).toEqual({ owed: 90, missed: config.rent.evictAfterMissed - 1 })
    expect(schema.safeParse(result.save).success).toBe(true)
  })

  it.each([
    ['fractional clout', { ...base.player, clout: 1.5 }],
    ['a missing rent object', { cash: 1, stats: base.player.stats, clout: 0, home: 'queens-room' }],
    ['fractional rent owed', { ...base.player, rent: { owed: 1.5, missed: 0 } }],
  ])('refuses a structurally unusable save: %s', (_label, player) => {
    expect(loadSave({ ...base, player }, config).ok).toBe(false)
  })
})

describe('save v3: tampered and edge saves', () => {
  const base = initialSave(config)
  const fromJson = (player: string) =>
    JSON.parse(`{"clock":{"minute":900,"remainderMs":0},"player":${player},"speed":1}`) as unknown

  it.each(['__proto__', 'constructor', 'hasOwnProperty', ''])(
    'a home of %j is repaired to the start home',
    (home) => {
      const persisted = fromJson(
        `{"cash":9,"stats":{"energy":1,"hunger":2,"mood":3},"clout":4,"home":${JSON.stringify(home)},"rent":{"owed":5,"missed":1},"inventory":{"wearables":[],"gifts":[],"outfit":{}}}`,
      )
      const result = loadSave(persisted, config)
      if (!result.ok) throw new Error('expected a repaired save')
      expect(result.repaired).toEqual(['player.home'])
      expect(result.save.player).toEqual({
        cash: 9,
        stats: { energy: 1, hunger: 2, mood: 3 },
        clout: 4,
        home: config.startHome,
        rent: { owed: 5, missed: 1 },
        inventory: emptyInventory,
      })
      expect(schema.safeParse(result.save).success).toBe(true)
    },
  )

  it.each([
    ['a string', '2', 0],
    ['null', null, 0],
    ['negative', -3, 0],
    ['fractional', 0.6, 1],
  ])('a missed count that is %s is repaired', (_label, missed, expected) => {
    const result = loadSave(
      { ...base, player: { ...base.player, rent: { owed: 0, missed } } },
      config,
    )
    if (!result.ok) throw new Error('expected a repaired save')
    expect(result.repaired).toEqual(['player.rent.missed'])
    expect(result.save.player.rent.missed).toBe(expected)
  })

  it('a missed count saved before evictAfterMissed was lowered is clamped below it', () => {
    const tightened = { ...config, rent: { lateFees: [], evictAfterMissed: 1 } }
    const player = { ...base.player, rent: { owed: 280, missed: 2 } }
    const result = loadSave({ ...base, player }, tightened)
    if (!result.ok) throw new Error('expected a repaired save')
    expect(result.save.player.rent).toEqual({ owed: 280, missed: 0 })
    expect(createSaveSchema(tightened).safeParse(result.save).success).toBe(true)
  })

  it.each([
    ['negative owed', { ...base.player, rent: { owed: -1, missed: 0 } }],
    ['owed as a string', { ...base.player, rent: { owed: '5', missed: 0 } }],
    ['a rent object with an extra key', { ...base.player, rent: { owed: 0, missed: 0, x: 1 } }],
    ['rent as null', { ...base.player, rent: null }],
  ])('refuses a structurally unusable save: %s', (_label, player) => {
    expect(loadSave({ ...base, player }, config).ok).toBe(false)
  })

  it('v2 -> v3 with a damaged remainder, fractional stats and an unknown speed is carried', () => {
    const v2 = {
      clock: { minute: 4321, remainderMs: 'later' },
      player: { cash: 77, stats: { energy: 12.4, hunger: -8, mood: 1e9 } },
      speed: '2',
    }
    const { save, outcome } = migrateSave(v2, 2, config)
    expect(outcome).toBe('carried')
    expect(save).toEqual({
      clock: { minute: 4321, remainderMs: 0 },
      player: {
        cash: 77,
        stats: { energy: 12, hunger: 0, mood: config.stats.max },
        clout: 0,
        home: config.startHome,
        rent: { owed: 0, missed: 0 },
        inventory: emptyInventory,
      },
      speed: 1,
    })
  })

  it.each([
    ['negative cash', { cash: -1, stats: { energy: 1, hunger: 1, mood: 1 } }],
    ['a missing stats object', { cash: 1 }],
  ])('v2 -> v3 with %s starts fresh', (_label, player) => {
    const v2 = { clock: { minute: 10, remainderMs: 0 }, player, speed: 1 }
    expect(migrateSave(v2, 2, config)).toEqual({ save: base, outcome: 'fresh' })
  })
})
