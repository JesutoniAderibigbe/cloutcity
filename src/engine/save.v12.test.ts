/**
 * Save v12 (S16a): the look, traits, career, neighborhood, creator state and rolls; the v11
 * migration (a look seeded from the save's own facts, S18c's action count kept) and every older
 * version; repairs. S16a merged after S18c took v11 (INT-12/13), so it renumbered to v12.
 */
import { describe, expect, it } from 'vitest'
import { lookProblem, publicAvatar } from './appearance'
import { engineConfig as config } from './config'
import { initialCreatorState } from './creator'
import { HOME_LOCATION } from './game'
import {
  SAVE_VERSION,
  createSaveSchema,
  initialSave,
  loadSave,
  migrateSave,
  type SaveState,
} from './save'
import { V12_PLAYER_KEYS } from './test-support'

const schema = createSaveSchema(config)
const NOW = 30_000
const base: SaveState = { ...initialSave(config), clock: { minute: NOW, remainderMs: 0 } }

/** A v12 save that has been through the creator. */
const chosen: SaveState = {
  ...base,
  player: {
    ...base.player,
    look: { ...base.player.look, hairStyle: 'box-braids', headwear: 'durag', height: 'short' },
    traits: ['early-bird', 'thrifty'],
    traitsChangedAt: 20_000,
    careerPath: 'artist-dj',
    careerChangedAt: 20_100,
    neighborhood: 'elmhurst',
  },
  creator: { actions: 1, offeredAt: 600, dismissedAt: null, completedAt: 20_200, skippedSteps: [] },
  rolls: { neighborhood: { result: 'elmhurst', at: 20_150, run: 1 } },
}

const roundTrip = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown

function load(save: unknown) {
  const result = loadSave(roundTrip(save), config)
  if (!result.ok) throw new Error(`unusable: ${result.issues.join(', ')}`)
  return result
}

/** `save` as v11 wrote it (S18c): the action count, none of the v12 fields. */
function v11Of(save: SaveState = base): Record<string, unknown> & {
  player: Record<string, unknown>
} {
  const player: Record<string, unknown> = { ...save.player }
  for (const key of V12_PLAYER_KEYS) delete player[key]
  const out: Record<string, unknown> = { ...save, player }
  delete out.creator
  delete out.rolls
  return out as Record<string, unknown> & { player: Record<string, unknown> }
}

describe('save v12', () => {
  it('is version 12; a fresh save has the default look, no choices, a fresh creator, no rolls', () => {
    expect(SAVE_VERSION).toBe(12)
    const fresh = initialSave(config)
    expect(fresh.player.look).toEqual(config.avatar.defaults)
    expect(fresh.player).toMatchObject({
      traits: [],
      traitsChangedAt: null,
      careerPath: null,
      careerChangedAt: null,
      neighborhood: null,
    })
    expect(fresh.creator).toEqual(initialCreatorState)
    expect(fresh.rolls).toEqual({})
    expect(schema.safeParse(fresh).success).toBe(true)
  })

  it('a new game with a seed gets that seed’s random look (src/state draws it from crypto)', () => {
    const a = initialSave(config, { lookSeed: 1 })
    const b = initialSave(config, { lookSeed: 2 })
    expect(initialSave(config, { lookSeed: 1 })).toEqual(a)
    expect(a.player.look).not.toEqual(b.player.look)
    expect(schema.safeParse(a).success).toBe(true)
  })

  it('round-trips a save that has been through the creator untouched', () => {
    expect(schema.safeParse(chosen).success).toBe(true)
    expect(loadSave(roundTrip(chosen), config)).toEqual({ ok: true, save: chosen, repaired: [] })
  })

  it('the schema refuses an unknown option, a third trait and an unrolled neighborhood', () => {
    const p = chosen.player
    const bad = (player: object) => ({ ...chosen, player: { ...p, ...player } })
    expect(schema.safeParse(bad({ look: { ...p.look, skin: 'tone-99' } })).success).toBe(false)
    expect(schema.safeParse(bad({ traits: ['early-bird', 'thrifty', 'hustler'] })).success).toBe(
      false,
    )
    expect(schema.safeParse(bad({ neighborhood: 'flushing' })).success).toBe(false)
    expect(schema.safeParse(bad({ careerPath: 'astronaut' })).success).toBe(false)
    expect(schema.safeParse(bad({ careerChangedAt: null })).success).toBe(false)
  })
})

describe('v11 -> v12', () => {
  it('keeps everything; the look is seeded from the save (not a repair), the rest starts fresh', () => {
    const v11 = { ...v11Of(), actions: 9, player: { ...v11Of().player, cash: 1011 } }
    const migrated = migrateSave(roundTrip(v11), 11, config)
    expect(migrated.outcome).toBe('carried')
    expect(migrated.save.player.cash).toBe(1011)
    expect(migrated.save.actions).toBe(9)
    expect(lookProblem(migrated.save.player.look, config)).toBeNull()
    expect(migrated.save.player.traits).toEqual([])
    expect(migrated.save.player.careerPath).toBeNull()
    expect(migrated.save.player.neighborhood).toBeNull()
    expect(migrated.save.creator).toEqual(initialCreatorState)
    expect(migrated.save.rolls).toEqual({})
    expect(schema.safeParse(migrated.save).success).toBe(true)
    expect(load(v11).repaired).toEqual([])
  })

  it('the same old save always gets the same look; different saves get different looks', () => {
    const v11 = v11Of()
    const once = migrateSave(roundTrip(v11), 11, config).save.player.look
    expect(migrateSave(roundTrip(v11), 11, config).save.player.look).toEqual(once)
    const looks = new Set(
      Array.from({ length: 40 }, (_, i) => {
        const other = { ...v11, player: { ...v11.player, cash: 100 + i } }
        return JSON.stringify(migrateSave(roundTrip(other), 11, config).save.player.look)
      }),
    )
    expect(looks.size).toBeGreaterThan(20)
  })

  it('every version v1 to v12 loads, carrying its progress (INT-12/13)', () => {
    const player = v11Of().player
    const legacy = (version: number): Record<string, unknown> => {
      const save: Record<string, unknown> = { ...v11Of(), actions: 7 }
      const p: Record<string, unknown> = { ...player, cash: 500 + version }
      if (version < 11) delete save.actions
      if (version < 10) {
        delete p.location
        delete p.transit
      }
      if (version < 9) {
        delete p.apartment
        const inventory: Record<string, unknown> = { ...base.player.inventory }
        delete inventory.decor
        p.inventory = inventory
      }
      if (version < 8) {
        delete p.visited
        delete save.goals
        delete save.grants
        delete save.prestige
      }
      if (version < 7) {
        p.clout = 0
        delete p.flex
      }
      if (version < 6) delete p.clubNights
      if (version < 5) delete save.events
      if (version < 4) delete p.inventory
      return { ...save, player: p }
    }
    const saves: Record<number, unknown> = {
      1: { player: { cash: 501 } },
      2: { clock: base.clock, player: { cash: 502, stats: base.player.stats }, speed: 1 },
    }
    for (let version = 3; version <= 11; version++) saves[version] = legacy(version)
    for (const [version, persisted] of Object.entries(saves)) {
      const migrated = migrateSave(roundTrip(persisted), Number(version), config)
      expect(migrated.outcome, `v${version}`).toBe('carried')
      expect(migrated.save.player.cash, `v${version}`).toBe(500 + Number(version))
      expect(migrated.save.player.location, `v${version}`).toEqual(HOME_LOCATION)
      expect(lookProblem(migrated.save.player.look, config), `v${version}`).toBeNull()
      expect(migrated.save.actions, `v${version}`).toBe(version === '11' ? 7 : 0)
      expect(schema.safeParse(migrated.save).success, `v${version}`).toBe(true)
    }
    const v12 = load({ ...chosen, actions: 12, player: { ...chosen.player, cash: 512 } })
    expect(v12.save.player.cash).toBe(512)
    expect(v12.save.player.look).toEqual(chosen.player.look)
    expect(v12.save.actions).toBe(12)
    expect(v12.repaired).toEqual([])
  })
})

describe('v12 repairs', () => {
  const withPlayer = (patch: Record<string, unknown>) => ({
    ...chosen,
    player: { ...chosen.player, ...patch },
  })

  it('a tampered look keeps its good fields and gets the default for the rest', () => {
    const result = load(withPlayer({ look: { ...chosen.player.look, skin: 'gold', top: 3 } }))
    expect(result.repaired).toEqual(['player.look'])
    expect(result.save.player.look).toEqual({
      ...chosen.player.look,
      skin: config.avatar.defaults.skin,
      top: config.avatar.defaults.top,
    })
  })

  it.each([
    [
      'unknown traits',
      { traits: ['psychic', 'thrifty'] },
      ['player.traits', 'player.traitsChangedAt'],
      { traits: [], traitsChangedAt: null },
    ],
    [
      'a trait minute in the future',
      { traitsChangedAt: NOW + 1 },
      ['player.traitsChangedAt'],
      { traitsChangedAt: NOW },
    ],
    [
      'an unknown career',
      { careerPath: 'astronaut' },
      ['player.careerPath', 'player.careerChangedAt'],
      { careerPath: null, careerChangedAt: null },
    ],
    [
      'a career with no minute',
      { careerChangedAt: 'soon' },
      ['player.careerChangedAt'],
      { careerChangedAt: NOW },
    ],
    [
      'a neighborhood that was not rolled',
      { neighborhood: 'flushing' },
      ['player.neighborhood'],
      { neighborhood: null },
    ],
  ])('repairs %s', (_label, patch, repaired, expected) => {
    const result = load(withPlayer(patch))
    expect(result.repaired).toEqual(repaired)
    expect(result.save.player).toMatchObject(expected)
    expect(schema.safeParse(result.save).success).toBe(true)
  })

  it('drops a roll outside the pool or in the future, and the neighborhood that rested on it', () => {
    const result = load({
      ...chosen,
      rolls: { neighborhood: { result: 'hoboken', at: 1, run: 1 } },
    })
    expect(result.save.rolls).toEqual({})
    expect(result.save.player.neighborhood).toBeNull()
    expect(result.repaired).toEqual(['rolls', 'player.neighborhood'])
    const future = load({
      ...chosen,
      rolls: { neighborhood: { result: 'elmhurst', at: NOW + 5, run: 1 } },
    })
    expect(future.save.rolls).toEqual({})
  })

  it('repairs a damaged creator state field by field', () => {
    const result = load({
      ...chosen,
      creator: {
        actions: 99,
        offeredAt: NOW + 9,
        dismissedAt: -1,
        completedAt: 20_200,
        skippedSteps: ['traits', 'traits', 'boss'],
      },
    })
    expect(result.repaired).toEqual(['creator'])
    expect(result.save.creator).toEqual({
      actions: config.creator.offerAfterActions,
      offeredAt: null,
      dismissedAt: null,
      completedAt: 20_200,
      skippedSteps: ['traits'],
    })
  })

  it('what other players see stays enums only after any repair', () => {
    const result = load(withPlayer({ look: { skin: '<b>hi</b>' } }))
    const shown = publicAvatar(result.save.player)
    for (const value of Object.values(shown.look)) expect(value).toMatch(/^[a-z0-9-]+$/)
  })
})
