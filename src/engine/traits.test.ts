/**
 * Traits (S16a, D16): summed and capped modifiers, applied where the engine charges energy,
 * lands mood, prices the shop and times a trip, and shown the same way they land (GR-11).
 */
import { describe, expect, it } from 'vitest'
import { findAction, performAction } from './actions'
import { minutesPerDay } from './clock'
import { engineConfig as config } from './config'
import { initialSnapshot, type GameSnapshot } from './game'
import { buyItem, shopPrice } from './items'
import { shiftAction, workShift } from './jobs'
import { chooseTraits } from './creatorFlow'
import { homeActions, performHomeAction, placeActions } from './placeActions'
import { atPlace } from './test-support'
import {
  scaleByPct,
  traitAdjustedAction,
  traitAdjustedTrip,
  traitPct,
  traitPickCount,
} from './traits'
import { NOON, TEST_TRANSIT, testWorld } from './transit/test-fixtures'
import { takeTrip, tripOptions } from './transit/trip'
import { tripEnd } from '@/lib/world/tripEnds'
import { HOME_LOCATION } from './game'
import { venues } from '@/lib/data/content'

const start = initialSnapshot(config)
const DAY = minutesPerDay(config)

function withTraits(traits: readonly string[], snapshot: GameSnapshot = start): GameSnapshot {
  return {
    ...snapshot,
    player: { ...snapshot.player, traits, traitsChangedAt: traits.length === 0 ? null : 0 },
  }
}

describe('traitPct', () => {
  it('sums the chosen traits per kind and caps the sum at ±maxModifierPct', () => {
    expect(traitPct({ traits: [] }, 'energy-cost', config)).toBe(0)
    expect(traitPct({ traits: ['early-bird'] }, 'energy-cost', config)).toBe(-10)
    expect(traitPct({ traits: ['early-bird'] }, 'mood-gain', config)).toBe(-5)
    // early-bird −10 and hustler −5 make −15: capped at −10.
    expect(traitPct({ traits: ['early-bird', 'hustler'] }, 'energy-cost', config)).toBe(-10)
    // early-bird −5 and easygoing +10 make +5.
    expect(traitPct({ traits: ['early-bird', 'easygoing'] }, 'mood-gain', config)).toBe(5)
    expect(traitPct({ traits: ['gone-trait'] }, 'mood-gain', config)).toBe(0)
  })

  it('scales whole values, never dropping a cost or a duration to 0', () => {
    expect(scaleByPct(15, -10)).toBe(14)
    expect(scaleByPct(40, -10)).toBe(36)
    expect(scaleByPct(1, -10)).toBe(1)
    expect(scaleByPct(0, 10)).toBe(0)
    expect(scaleByPct(30, 5)).toBe(32)
  })
})

describe('applied where the engine charges', () => {
  it('a shift costs less energy for an early bird', () => {
    const plain = workShift(start, 'retail', config)
    const early = workShift(withTraits(['early-bird']), 'retail', config)
    if (!plain.ok || !early.ok) throw new Error('shift failed')
    const cost = config.jobs.energyCostPerShift.retail
    const spent = (result: typeof plain) =>
      start.player.stats.energy - result.snapshot.player.stats.energy
    expect(spent(early)).toBe(spent(plain) - (cost - scaleByPct(cost, -10)))
  })

  it('positive mood effects are stronger for an easygoing player, losses untouched', () => {
    const walk = findAction('walk-in-the-park', config)
    if (walk === undefined) throw new Error('no walk')
    const adjusted = traitAdjustedAction(walk, { traits: ['easygoing'] }, config)
    expect(adjusted.statEffects.mood).toBe(scaleByPct(walk.statEffects.mood ?? 0, 10))
    const lowMood = {
      ...start,
      player: { ...start.player, stats: { ...start.player.stats, mood: 10 } },
    }
    const plain = performAction(lowMood, 'walk-in-the-park', config)
    const easy = performAction(withTraits(['easygoing'], lowMood), 'walk-in-the-park', config)
    if (!plain.ok || !easy.ok) throw new Error('walk failed')
    expect(easy.snapshot.player.stats.mood - plain.snapshot.player.stats.mood).toBe(
      scaleByPct(walk.statEffects.mood ?? 0, 10) - (walk.statEffects.mood ?? 0),
    )
    const drain = { durationMin: 10, cashCost: 0, energyCost: 0, statEffects: { mood: -4 } }
    expect(traitAdjustedAction(drain, { traits: ['easygoing'] }, config)).toBe(drain)
  })

  it('home actions (sleep, nap, a home meal) carry the traits too, shown as they land', () => {
    const tired = {
      ...start,
      player: { ...start.player, stats: { energy: 10, hunger: 50, mood: 10 } },
    }
    const easy = withTraits(['easygoing'], tired)
    const sleep = homeActions(easy, config).find((action) => action.id === 'sleep')
    const raw = findAction('sleep', config)
    if (sleep === undefined || raw === undefined) throw new Error('no home sleep')
    expect(sleep.def).toEqual(traitAdjustedAction(raw, easy.player, config))
    const plain = performHomeAction(tired, 'sleep', config)
    const done = performHomeAction(easy, 'sleep', config)
    if (!plain.ok || !done.ok) throw new Error('sleep failed')
    expect(done.statEffects.mood).toBe(scaleByPct(raw.statEffects.mood ?? 0, 10))
    expect(plain.statEffects.mood).toBe(raw.statEffects.mood)
  })

  it('the place sheet shows the energy that a shift will charge (GR-11)', () => {
    const site = venues.find((venue) => venue.id === 'rerun-racks')
    if (site === undefined) throw new Error('no thrift job site')
    const player = withTraits(['early-bird'], atPlace(start, site.id))
    const view = placeActions(site, player, config)
    if (view.kind !== 'actions') throw new Error('look-only')
    const shift = view.actions.find((action) => action.kind === 'shift')
    expect(shift?.def.energyCost).toBe(
      traitAdjustedAction(shiftAction('retail', config), player.player, config).energyCost,
    )
  })

  it('shop prices follow the shop-price trait, and buying charges that price', () => {
    const rich = { ...start, player: { ...start.player, cash: 1000 } }
    const item = config.items.catalog.find((entry) => entry.id === 'designer-puffer')
    if (item === undefined) throw new Error('no puffer')
    const thrifty = withTraits(['thrifty'], rich)
    expect(shopPrice(item, thrifty.player, config)).toBe(scaleByPct(item.price, -10))
    const bought = buyItem(thrifty, item.id, config)
    if (!bought.ok) throw new Error(bought.error.code)
    expect(bought.price).toBe(scaleByPct(item.price, -10))
    expect(bought.snapshot.player.cash).toBe(1000 - bought.price)
    const showy = withTraits(['main-character'], rich)
    expect(shopPrice(item, showy.player, config)).toBe(scaleByPct(item.price, 5))
  })

  it('a trip takes the travel-time trait, in the options and the trip alike', () => {
    const world = testWorld()
    const before: GameSnapshot = { ...start, clock: { minute: DAY + NOON, remainderMs: 0 } }
    const deli = tripEnd({ kind: 'place', placeId: 'late-lantern-deli' }, start.player.home)
    const home = tripEnd(HOME_LOCATION, start.player.home)
    if (deli === undefined || home === undefined) throw new Error('no ends')
    const request = { from: home.stop.point, to: deli.stop, mode: 'walk' as const }
    const plain = takeTrip(before, request, { world }, config, TEST_TRANSIT)
    const fast = takeTrip(
      withTraits(['speed-walker'], before),
      request,
      { world },
      config,
      TEST_TRANSIT,
    )
    if (!plain.ok || !fast.ok) throw new Error('trip failed')
    expect(fast.durationMin).toBe(scaleByPct(plain.durationMin, -10))
    const shown = tripOptions(
      withTraits(['speed-walker'], before),
      home.stop.point,
      deli.stop,
      { world },
      config,
      TEST_TRANSIT,
    ).find((option) => option.mode === 'walk')
    expect(shown?.durationMin).toBe(fast.durationMin)
    expect(
      traitAdjustedTrip(
        { durationMin: 20, cashCost: 3, energyCost: 0, statEffects: {} },
        { traits: ['homebody'] },
        config,
      ).durationMin,
    ).toBe(21)
  })
})

describe('chooseTraits', () => {
  const at = (minute: number, snapshot: GameSnapshot = start): GameSnapshot => ({
    ...snapshot,
    clock: { ...snapshot.clock, minute },
  })

  it('picks exactly two known, different traits', () => {
    expect(traitPickCount(config)).toBe(2)
    expect(chooseTraits(start, ['thrifty'], config)).toEqual({
      ok: false,
      error: { code: 'WRONG_TRAIT_COUNT', required: 2, given: 1 },
    })
    expect(chooseTraits(start, ['thrifty', 'thrifty'], config)).toEqual({
      ok: false,
      error: { code: 'REPEATED_TRAIT', traitId: 'thrifty' },
    })
    expect(chooseTraits(start, ['thrifty', 'psychic'], config)).toEqual({
      ok: false,
      error: { code: 'UNKNOWN_TRAIT', traitId: 'psychic' },
    })
    const ok = chooseTraits(at(700), ['thrifty', 'hustler'], config)
    if (!ok.ok) throw new Error(ok.error.code)
    expect(ok.snapshot.player.traits).toEqual(['thrifty', 'hustler'])
    expect(ok.snapshot.player.traitsChangedAt).toBe(700)
  })

  it('a different pair waits for the 7-day cooldown; the same pair in any order changes nothing', () => {
    const first = chooseTraits(at(700), ['thrifty', 'hustler'], config)
    if (!first.ok) throw new Error(first.error.code)
    const again = chooseTraits(at(701, first.snapshot), ['hustler', 'thrifty'], config)
    expect(again.ok && again.changed).toBe(false)
    expect(
      chooseTraits(at(700 + 7 * DAY - 1, first.snapshot), ['easygoing', 'hustler'], config),
    ).toEqual({ ok: false, error: { code: 'CHANGE_COOLDOWN', availableAt: 700 + 7 * DAY } })
    const later = chooseTraits(at(700 + 7 * DAY, first.snapshot), ['easygoing', 'hustler'], config)
    expect(later.ok && later.changed).toBe(true)
  })
})
