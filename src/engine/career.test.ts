/** Career paths (S16a): each path's bonus, what it never touches, and the change cooldown. */
import { describe, expect, it } from 'vitest'
import { careerPct, changeAvailableAt, type CareerPathId } from './career'
import { chooseCareer } from './creatorFlow'
import { minutesPerDay } from './clock'
import { cloutCeilings, recordClout, type CloutChange } from './clout'
import { engineConfig as config } from './config'
import { initialSnapshot, type GameSnapshot } from './game'
import { homeClout, homeScore } from './home'
import { buyItem, resaleValue, sellItem } from './items'

const start = initialSnapshot(config)

function as(careerPath: CareerPathId | null, snapshot: GameSnapshot = start): GameSnapshot {
  return {
    ...snapshot,
    player: { ...snapshot.player, careerPath, careerChangedAt: careerPath === null ? null : 0 },
  }
}

/** Clout `change` adds for a player on `path`. */
function gain(path: CareerPathId | null, change: CloutChange): number {
  return recordClout(as(path), change, config).entry?.amount ?? 0
}

const flex = (base: number): CloutChange => ({
  source: 'flex',
  amount: base,
  ref: { placeId: 'queens-ballpark', viral: false, placeMultiplier: 1, styleScore: 0, base },
})
const event = (eventId: string, amount: number): CloutChange => ({
  source: 'event',
  amount,
  ref: { eventId, choiceId: 'post' },
})

describe('clout bonuses (balance.json career, TUNE-11)', () => {
  it('an influencer gets +20% on flex clout, nobody else does', () => {
    expect(gain(null, flex(10))).toBe(10)
    expect(gain('influencer', flex(10))).toBe(12)
    for (const path of ['streamer', 'artist-dj', 'founder-hustler'] as const) {
      expect(gain(path, flex(10)), path).toBe(10)
    }
  })

  it('a streamer gets +20% on event clout, except nightlife events', () => {
    expect(gain('streamer', event('viral-moment', 10))).toBe(12)
    expect(gain(null, event('viral-moment', 10))).toBe(10)
    // club-promoter is tagged nightlife: flavour only (DEC-12).
    expect(gain('streamer', event('club-promoter', 10))).toBe(10)
    // An event the catalog does not know cannot be checked, so it gets no bonus.
    expect(gain('streamer', event('not-an-event', 10))).toBe(10)
  })

  it('never touches club, grant, premium, item or paycheck clout, nor a loss', () => {
    const others: CloutChange[] = [
      { source: 'club', amount: 10, ref: { venueId: 'glowmatic', night: 0 } },
      { source: 'grant', amount: 10, ref: { grantKey: 'goal:first-paycheck:1' } },
      { source: 'premium', amount: 10, ref: { itemId: 'x', op: 'grant' } },
      { source: 'paycheck', amount: 10, ref: { jobId: 'barista' } },
    ]
    for (const path of ['influencer', 'streamer', 'artist-dj', 'founder-hustler'] as const) {
      for (const change of others) expect(gain(path, change), `${path} ${change.source}`).toBe(10)
      expect(careerPct({ careerPath: path }, { source: 'item' }, config)).toBe(100)
    }
    const earned = recordClout(as('influencer'), flex(20), config)
    const lost = recordClout({ ...as('influencer'), player: earned.player }, flex(-5), config)
    expect(lost.entry?.amount).toBe(-5)
  })

  it('an artist/DJ counts the home score at +25% before the home clout cap', () => {
    const decorated: GameSnapshot = {
      ...start,
      player: {
        ...start.player,
        cash: 10_000,
      },
    }
    const bought = buyItem(decorated, 'crate-record-player', config)
    if (!bought.ok) throw new Error(bought.error.code)
    const placed = {
      ...bought.snapshot.player,
      apartment: {
        ...bought.snapshot.player.apartment,
        placed: { 'surface-1': 'crate-record-player' },
      },
    }
    const score = homeScore(placed, config)
    expect(score).toBeGreaterThan(0)
    expect(homeClout({ ...placed, careerPath: null }, config)).toBe(score)
    expect(homeClout({ ...placed, careerPath: 'artist-dj' }, config)).toBe(
      Math.floor((score * 125) / 100),
    )
    expect(homeClout({ ...placed, careerPath: 'influencer' }, config)).toBe(score)
    // The cap still holds.
    const huge = { ...placed, home: 'manhattan-loft' as const, careerPath: 'artist-dj' as const }
    expect(homeClout(huge, config)).toBeLessThanOrEqual(config.home.maxClout)
  })

  it('a founder/hustler sells for 10 more points of the price, still below what they paid', () => {
    const rich: GameSnapshot = { ...start, player: { ...start.player, cash: 1000 } }
    const plain = buyItem(rich, 'thrifted-denim-jacket', config)
    if (!plain.ok) throw new Error(plain.error.code)
    const asFounder = as('founder-hustler', plain.snapshot)
    const sold = sellItem(asFounder, 'thrifted-denim-jacket', config)
    const soldPlain = sellItem(plain.snapshot, 'thrifted-denim-jacket', config)
    if (!sold.ok || !soldPlain.ok) throw new Error('sell failed')
    const item = config.items.catalog.find((entry) => entry.id === 'thrifted-denim-jacket')
    if (item === undefined) throw new Error('no jacket')
    expect(sold.amount).toBe(soldPlain.amount + Math.floor((item.price * 10) / 100))
    expect(sold.amount).toBe(resaleValue(item, 0, 0, config, 10))
    expect(sold.amount).toBeLessThan(item.price)
  })

  it('the clout ceilings S18c falls back on include the best career bonus', () => {
    const ceilings = cloutCeilings(config)
    const noCareer = {
      ...config,
      career: {
        paths: Object.fromEntries(
          Object.entries(config.career.paths).map(([id, path]) => [
            id,
            { ...path, bonus: { kind: 'resale-pts' as const, pts: 1 } },
          ]),
        ) as typeof config.career.paths,
      },
    }
    const without = cloutCeilings(noCareer)
    expect(ceilings.bySource.flex?.perAction).toBeGreaterThan(without.bySource.flex?.perAction ?? 0)
    expect(ceilings.bySource.event?.perAction).toBeGreaterThanOrEqual(
      without.bySource.event?.perAction ?? 0,
    )
    expect(ceilings.bySource.club).toEqual(without.bySource.club)
    expect(ceilings.bySource.paycheck).toEqual(without.bySource.paycheck)
  })
})

describe('chooseCareer', () => {
  const day = minutesPerDay(config)
  const at = (minute: number, snapshot: GameSnapshot = start): GameSnapshot => ({
    ...snapshot,
    clock: { ...snapshot.clock, minute },
  })

  it('the first choice is free and records its minute', () => {
    const result = chooseCareer(at(1000), 'streamer', config)
    if (!result.ok) throw new Error(result.error.code)
    expect(result.changed).toBe(true)
    expect(result.snapshot.player.careerPath).toBe('streamer')
    expect(result.snapshot.player.careerChangedAt).toBe(1000)
  })

  it('a change waits 7 game days; the same path again changes nothing', () => {
    const first = chooseCareer(at(1000), 'streamer', config)
    if (!first.ok) throw new Error(first.error.code)
    const chosen = first.snapshot
    const tooSoon = chooseCareer(at(1000 + 7 * day - 1, chosen), 'influencer', config)
    expect(tooSoon).toEqual({
      ok: false,
      error: { code: 'CHANGE_COOLDOWN', availableAt: 1000 + 7 * day },
    })
    const same = chooseCareer(at(1001, chosen), 'streamer', config)
    expect(same.ok && same.changed).toBe(false)
    const later = chooseCareer(at(1000 + 7 * day, chosen), 'influencer', config)
    if (!later.ok) throw new Error(later.error.code)
    expect(later.snapshot.player.careerPath).toBe('influencer')
    expect(changeAvailableAt(1000, 1000 + 7 * day, config)).toBeNull()
  })

  it('refuses an unknown path', () => {
    expect(chooseCareer(start, 'astronaut', config)).toEqual({
      ok: false,
      error: { code: 'UNKNOWN_CAREER', careerPath: 'astronaut' },
    })
  })
})
