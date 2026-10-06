import { describe, expect, it } from 'vitest'
import { engineConfig as config } from './config'
import { SAVE_VERSION, createSaveSchema, initialSave, loadSave, migrateSave } from './save'

const schema = createSaveSchema(config)

describe('save schema', () => {
  it('accepts a fresh save', () => {
    expect(SAVE_VERSION).toBe(2)
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
    const result = loadSave({ ...base, player: { cash: 1, stats } }, config)
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
