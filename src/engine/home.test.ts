/**
 * S16/S40 apartment engine: home score and clout, placing decor on the grid (footprints, turns,
 * blocked cells, rugs under furniture), finishes, luxury upkeep, colour variants and moving home.
 */
import { describe, expect, it } from 'vitest'
import { HOME_IDS } from '@/lib/data/homes'
import { cloutBreakdown, goalClout, levelClout, playerLevel, totalClout } from './clout'
import { engineConfig as config, type HomeId } from './config'
import { initialSnapshot, type GameSnapshot } from './game'
import {
  applyFinish,
  currentFinish,
  homeClout,
  homeLock,
  homeScore,
  initialApartment,
  itemUpkeep,
  layoutFor,
  moveHome,
  placeDecor,
  placementsAfterMove,
  removeDecor,
  rotateDecor,
  setDecorVariant,
  slotsFor,
  starterFurnishing,
  weeklyUpkeep,
  type HomeResult,
} from './home'
import { canAffordMove, moveInCost, rentReserve } from './housing'
import { buyItem, findItem, isDecor, sellItem, shopItems, type DecorDef } from './items'
import { rentFor, settleRent } from './rent'
import { unfurnished, withClout } from './test-support'

const start = unfurnished(initialSnapshot(config))
const DAY = config.time.gameDayHours * 60

function decor(id: string): DecorDef {
  const item = findItem(id, config)
  if (item === undefined || !isDecor(item)) throw new Error(`no decor ${id}`)
  return item
}
const lights = decor('fairy-string-lights') // wall
const rug = decor('thrift-flatweave-rug') // floor, 2×2, rug layer
const monstera = decor('windowsill-monstera') // surface, 1×1
const neon = decor('custom-neon-sign') // wall
const chair = decor('cloud-lounge-chair') // floor, 1×1, luxury
const player = decor('crate-record-player') // surface, 1×1
const sofa = decor('corduroy-sofa') // floor, 2×1
const ALL = [lights, rug, monstera, neon, chair, player]

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`)
  return result as Extract<T, { ok: true }>
}

/** `snapshot` owning each of `ids` (bought with cash to spare, then cash set to `cash`). */
function owning(snapshot: GameSnapshot, ids: readonly string[], cash = snapshot.player.cash) {
  let out: GameSnapshot = { ...snapshot, player: { ...snapshot.player, cash: 100_000 } }
  for (const id of ids) out = ok(buyItem(out, id, config)).snapshot
  return { ...out, player: { ...out.player, cash } }
}

function inHome(snapshot: GameSnapshot, home: HomeId): GameSnapshot {
  return { ...snapshot, player: { ...snapshot.player, home } }
}

function place(
  snapshot: GameSnapshot,
  itemId: string,
  slotId: string,
  turn?: 0 | 1 | 2 | 3,
): GameSnapshot {
  return ok(placeDecor(snapshot, itemId, slotId, config, turn)).snapshot
}

function errorOf(result: HomeResult<object>) {
  if (result.ok) throw new Error('expected a refusal')
  return result.error
}

const turnOf = (snapshot: GameSnapshot, itemId: string) =>
  snapshot.player.inventory.decor.find((owned) => owned.itemId === itemId)?.turn ?? 0

// The Queens room (data/homes/interiors.json): 5 × 4 cells; the kitchen run blocks f0-0..f2-0, the
// window blocks w-left-1 and w-left-2, the door w-right-3; the avatar keeps f2-2 and the way in
// from the door keeps f4-3 walkable.

describe('home score and home clout', () => {
  it('a home with nothing placed scores its base score; the start home is 0', () => {
    for (const home of HOME_IDS) {
      const snapshot = inHome(start, home)
      expect(homeScore(snapshot.player, config)).toBe(config.home.baseScore[home])
    }
    expect(homeClout(start.player, config)).toBe(0)
    expect(totalClout(start.player, config)).toBe(0)
  })

  it('a new game is furnished with starter pieces that add no score (S40)', () => {
    const fresh = initialSnapshot(config)
    expect(Object.keys(fresh.player.apartment.placed).length).toBeGreaterThanOrEqual(8)
    expect(homeScore(fresh.player, config)).toBe(0)
    expect(totalClout(fresh.player, config)).toBe(0)
    expect(starterFurnishing(config.startHome, 0, config).placed).toEqual(
      fresh.player.apartment.placed,
    )
  })

  it('placed decor adds its homeScore; owned decor in storage adds nothing', () => {
    const owned = owning(start, [lights.id, rug.id])
    expect(homeScore(owned.player, config)).toBe(0)
    const placed = place(owned, lights.id, 'w-back-0')
    expect(homeScore(placed.player, config)).toBe(lights.decor.homeScore)
    const both = place(placed, rug.id, 'f1-1')
    expect(homeScore(both.player, config)).toBe(lights.decor.homeScore + rug.decor.homeScore)
  })

  it('home clout is the score capped at home.maxClout', () => {
    let loft = inHome(
      owning(
        start,
        ALL.map((item) => item.id),
      ),
      'manhattan-loft',
    )
    for (const [itemId, slotId] of [
      [lights.id, 'w-back-0'],
      [neon.id, 'w-back-1'],
      [rug.id, 'f1-2'],
      [chair.id, 'f5-3'],
      [monstera.id, 'f6-3'],
      [player.id, 'f7-3'],
    ] as const) {
      loft = place(loft, itemId, slotId)
    }
    const score =
      config.home.baseScore['manhattan-loft'] +
      ALL.reduce((sum, item) => sum + item.decor.homeScore, 0)
    expect(homeScore(loft.player, config)).toBe(score)
    expect(score).toBeGreaterThan(config.home.maxClout)
    expect(homeClout(loft.player, config)).toBe(config.home.maxClout)
  })

  it('kept decor (prestige) counts 0 even when placed', () => {
    const owned = place(owning(start, [neon.id]), neon.id, 'w-back-0')
    const kept = {
      ...owned.player,
      inventory: {
        ...owned.player.inventory,
        decor: owned.player.inventory.decor.map((entry) => ({
          ...entry,
          prestigeKept: true as const,
        })),
      },
    }
    expect(homeScore(kept, config)).toBe(0)
  })

  it('home clout is part of the breakdown, the total, goal clout and level clout', () => {
    const placed = place(owning(start, [neon.id]), neon.id, 'w-back-0')
    const homeCl = neon.decor.homeScore
    const withEarned = withClout(placed, 90 + homeCl, config)
    const breakdown = cloutBreakdown(withEarned.player, config)
    expect(breakdown).toMatchObject({ earned: 90, items: 0, home: homeCl, premium: 0 })
    expect(breakdown.total).toBe(90 + homeCl)
    expect(totalClout(withEarned.player, config)).toBe(90 + homeCl)
    expect(goalClout(withEarned.player, config)).toBe(90 + homeCl)
    expect(levelClout(withEarned.player, config)).toBe(90 + homeCl)
    expect(playerLevel(withEarned.player, config).id).toBe('local')
  })
})

describe('slotsFor', () => {
  it('lists every floor cell from the back row, then each wall’s cells, for each home', () => {
    const queens = slotsFor('queens-room', config).map((slot) => slot.id)
    expect(queens.slice(0, 6)).toEqual(['f0-0', 'f1-0', 'f2-0', 'f3-0', 'f4-0', 'f0-1'])
    expect(queens).toHaveLength(5 * 4 + 5 + 4 + 4)
    expect(queens).toContain('w-left-3')
    expect(queens).not.toContain('w-left-4')
    for (const home of HOME_IDS) {
      const { size } = layoutFor(home, config)
      expect(slotsFor(home, config)).toHaveLength(size.cols * size.rows + size.cols + 2 * size.rows)
    }
  })
})

describe('placeDecor', () => {
  const owned = owning(start, [lights.id, neon.id, rug.id, sofa.id, monstera.id])

  it('refuses unknown items, non-decor, decor not owned, unknown cells and the wrong kind', () => {
    expect(errorOf(placeDecor(owned, 'nope', 'w-back-0', config))).toEqual({
      code: 'UNKNOWN_ITEM',
      itemId: 'nope',
    })
    expect(errorOf(placeDecor(owned, 'bodega-graphic-tee', 'w-back-0', config)).code).toBe(
      'NOT_DECOR',
    )
    expect(errorOf(placeDecor(owned, chair.id, 'f3-1', config)).code).toBe('NOT_OWNED')
    for (const slotId of ['wall-1', 'f9-0', 'w-left-4', '__proto__', 'constructor', '']) {
      expect(errorOf(placeDecor(owned, lights.id, slotId, config)), slotId).toEqual({
        code: 'UNKNOWN_SLOT',
        slotId,
      })
    }
    expect(errorOf(placeDecor(owned, lights.id, 'f3-1', config))).toEqual({
      code: 'WRONG_SLOT_KIND',
      itemId: lights.id,
      slotId: 'f3-1',
      fits: 'wall',
      kind: 'floor',
    })
    expect(errorOf(placeDecor(owned, monstera.id, 'w-back-0', config)).code).toBe('WRONG_SLOT_KIND')
  })

  it('a 2×1 item covers two cells across, or two deep once turned; never off the grid', () => {
    const across = place(owned, sofa.id, 'f3-1')
    expect(errorOf(placeDecor(across, rug.id, 'f3-1', config))).toMatchObject({
      code: 'NO_ROOM',
      reason: 'occupied',
    })
    // The sofa's second cell (f4-1) is taken for furniture.
    expect(errorOf(placeDecor(across, monstera.id, 'f4-1', config)).code).toBe('NO_ROOM')
    expect(errorOf(placeDecor(owned, sofa.id, 'f4-1', config, 0))).toMatchObject({
      code: 'NO_ROOM',
      reason: 'off-grid',
    })
    const deep = place(owned, sofa.id, 'f4-0', 1)
    expect(turnOf(deep, sofa.id)).toBe(1)
    expect(errorOf(placeDecor(deep, monstera.id, 'f4-1', config)).code).toBe('NO_ROOM')
  })

  it('keeps the kitchen, the windows and the door clear, and the walkway free of furniture', () => {
    expect(errorOf(placeDecor(owned, monstera.id, 'f1-0', config))).toMatchObject({
      reason: 'blocked',
    })
    expect(errorOf(placeDecor(owned, lights.id, 'w-left-1', config))).toMatchObject({
      reason: 'blocked',
    })
    expect(errorOf(placeDecor(owned, lights.id, 'w-right-3', config))).toMatchObject({
      reason: 'blocked',
    })
    expect(errorOf(placeDecor(owned, monstera.id, 'f2-2', config))).toMatchObject({
      reason: 'blocked',
    })
    // A rug may lie over the walkway.
    expect(place(owned, rug.id, 'f1-2').player.apartment.placed).toEqual({ 'f1-2': rug.id })
  })

  it('furniture stands on a rug, but two items never share a slot', () => {
    const rugged = place(owned, rug.id, 'f1-1')
    const onRug = place(rugged, monstera.id, 'f2-1')
    expect(onRug.player.apartment.placed).toEqual({ 'f1-1': rug.id, 'f2-1': monstera.id })
    expect(errorOf(placeDecor(rugged, monstera.id, 'f1-1', config))).toMatchObject({
      reason: 'occupied',
    })
  })

  it('placing never displaces another item; placing an item already placed moves it', () => {
    const first = place(owned, lights.id, 'w-back-0')
    expect(errorOf(placeDecor(first, neon.id, 'w-back-0', config))).toMatchObject({
      code: 'NO_ROOM',
      reason: 'occupied',
    })
    const moved = place(first, lights.id, 'w-back-4')
    expect(moved.player.apartment.placed).toEqual({ 'w-back-4': lights.id })
    // Moving an item onto cells it already covers is fine (it does not block itself).
    const sofaIn = place(owned, sofa.id, 'f3-1')
    expect(place(sofaIn, sofa.id, 'f3-1', 2).player.apartment.placed).toEqual({ 'f3-1': sofa.id })
  })

  it('never touches the clock, cash, stats or the clout ledger', () => {
    const placed = place(owned, lights.id, 'w-back-0')
    expect(placed.clock).toBe(owned.clock)
    expect(placed.player.cash).toBe(owned.player.cash)
    expect(placed.player.stats).toBe(owned.player.stats)
    expect(placed.player.clout.ledger).toEqual(owned.player.clout.ledger)
  })

  it('reports a level-up when the home score lifts the player to a new level, once', () => {
    const near = withClout(owned, 100 - neon.decor.homeScore, config)
    const result = ok(placeDecor(near, neon.id, 'w-back-0', config))
    expect(result.levelUp).toMatchObject({ fromPeak: 'nobody', to: 'local', source: 'home' })
    expect(result.levelUp?.unlocks.boroughs).toEqual(['brooklyn'])
    const removed = ok(removeDecor(result.snapshot, 'w-back-0', config))
    expect(removed.levelUp).toBeNull()
    expect(playerLevel(removed.snapshot.player, config).id).toBe('nobody')
    // The peak is remembered: placing it again replays no level-up.
    expect(ok(placeDecor(removed.snapshot, neon.id, 'w-back-0', config)).levelUp).toBeNull()
  })
})

describe('rotateDecor', () => {
  const owned = owning(start, [sofa.id, lights.id, monstera.id])

  it('turns a stored or placed item a quarter turn; looks only', () => {
    const stored = ok(rotateDecor(owned, sofa.id, config)).snapshot
    expect(turnOf(stored, sofa.id)).toBe(1)
    const placed = place(owned, monstera.id, 'f3-1')
    const turned = ok(rotateDecor(placed, monstera.id, config)).snapshot
    expect(turnOf(turned, monstera.id)).toBe(1)
    expect(turned.player.apartment).toBe(placed.player.apartment)
    expect(totalClout(turned.player, config)).toBe(totalClout(placed.player, config))
  })

  it('skips turns that do not fit where it stands, and refuses when none does or for a wall item', () => {
    const placed = place(owned, sofa.id, 'f3-2', 0)
    const turned = ok(rotateDecor(placed, sofa.id, config)).snapshot
    expect(turnOf(turned, sofa.id)).toBe(1)
    // On the front row, turning deep would run off the grid: the sofa skips to the next turn.
    const front = place(owned, sofa.id, 'f0-3', 0)
    expect(turnOf(ok(rotateDecor(front, sofa.id, config)).snapshot, sofa.id)).toBe(2)
    const hung = place(owned, lights.id, 'w-back-0')
    expect(errorOf(rotateDecor(hung, lights.id, config)).code).toBe('NO_ROOM_TO_TURN')
    expect(errorOf(rotateDecor(owned, chair.id, config)).code).toBe('NOT_OWNED')
  })
})

describe('removeDecor', () => {
  const placed = place(owning(start, [lights.id]), lights.id, 'w-back-0')

  it('takes the item back to storage and its score away', () => {
    const removed = ok(removeDecor(placed, 'w-back-0', config))
    expect(removed.snapshot.player.apartment.placed).toEqual({})
    expect(removed.snapshot.player.inventory.decor.map((entry) => entry.itemId)).toEqual([
      lights.id,
    ])
    expect(homeScore(removed.snapshot.player, config)).toBe(0)
  })

  it('is a no-op on an empty cell and refuses a cell the home does not have', () => {
    const empty = ok(removeDecor(placed, 'f3-1', config))
    expect(empty.snapshot).toBe(placed)
    expect(empty.levelUp).toBeNull()
    expect(errorOf(removeDecor(placed, 'w-left-9', config))).toEqual({
      code: 'UNKNOWN_SLOT',
      slotId: 'w-left-9',
    })
  })
})

describe('setDecorVariant', () => {
  const owned = owning(start, [neon.id])

  it('a new purchase shows its first variant; choosing another changes looks only', () => {
    expect(owned.player.inventory.decor[0]?.variant).toBe(neon.decor.variants[0]?.id)
    const placed = place(owned, neon.id, 'w-back-0')
    const other = neon.decor.variants[1]?.id ?? ''
    const changed = ok(setDecorVariant(placed, neon.id, other, config)).snapshot
    expect(changed.player.inventory.decor[0]?.variant).toBe(other)
    expect(changed.player.apartment).toBe(placed.player.apartment)
    expect(totalClout(changed.player, config)).toBe(totalClout(placed.player, config))
  })

  it('refuses an unknown variant, decor not owned and non-decor', () => {
    expect(errorOf(setDecorVariant(owned, neon.id, 'plaid', config))).toEqual({
      code: 'UNKNOWN_VARIANT',
      itemId: neon.id,
      variantId: 'plaid',
    })
    expect(errorOf(setDecorVariant(owned, rug.id, 'teal', config)).code).toBe('NOT_OWNED')
    expect(errorOf(setDecorVariant(owned, 'bodega-flowers', 'pink', config)).code).toBe('NOT_DECOR')
  })
})

describe('applyFinish: wall paint and floors (S40)', () => {
  const cash = (snapshot: GameSnapshot, amount: number) => ({
    ...snapshot,
    player: { ...snapshot.player, cash: amount },
  })
  const mint = config.home.finishes.find((finish) => finish.id === 'mint-fresh')
  if (mint === undefined) throw new Error('no mint-fresh finish')

  it('the home shows its originals until another finish is applied', () => {
    const shell = layoutFor('queens-room', config).shell
    expect(currentFinish(start.player, 'wall', config)).toBe(shell.wallPaint)
    expect(currentFinish(start.player, 'floor', config)).toBe(shell.floorFinish)
  })

  it('buys a finish once for its price; applying it again, or the original, is free', () => {
    const bought = ok(applyFinish(cash(start, 500), mint.id, config))
    expect(bought.cost).toBe(mint.price)
    expect(bought.snapshot.player.cash).toBe(500 - mint.price)
    expect(bought.snapshot.player.apartment).toMatchObject({
      wallPaint: mint.id,
      finishes: [mint.id],
    })
    expect(currentFinish(bought.snapshot.player, 'wall', config)).toBe(mint.id)
    const original = layoutFor('queens-room', config).shell.wallPaint
    const back = ok(applyFinish(bought.snapshot, original, config))
    expect(back.cost).toBe(0)
    expect(back.snapshot.player.apartment.wallPaint).toBeNull()
    const again = ok(applyFinish(back.snapshot, mint.id, config))
    expect(again.cost).toBe(0)
    expect(again.snapshot.player.apartment.finishes).toEqual([mint.id])
  })

  it('refuses an unknown finish and one the player cannot afford, changing nothing; adds no clout', () => {
    expect(errorOf(applyFinish(start, 'plaid', config))).toEqual({
      code: 'UNKNOWN_FINISH',
      finishId: 'plaid',
    })
    expect(errorOf(applyFinish(cash(start, mint.price - 1), mint.id, config))).toEqual({
      code: 'FINISH_FUNDS_SHORT',
      required: mint.price,
      available: mint.price - 1,
    })
    const bought = ok(applyFinish(cash(start, 500), mint.id, config)).snapshot
    expect(totalClout(bought.player, config)).toBe(totalClout(start.player, config))
    expect(homeScore(bought.player, config)).toBe(homeScore(start.player, config))
  })

  it('moving home starts on the new home’s originals and keeps what was bought', () => {
    const painted = ok(applyFinish(cash(withClout(start, 100, config), 5000), mint.id, config))
    const moved = ok(moveHome(painted.snapshot, 'brooklyn-1br', config)).snapshot
    expect(moved.player.apartment.wallPaint).toBeNull()
    expect(moved.player.apartment.finishes).toEqual([mint.id])
    expect(ok(applyFinish(moved, mint.id, config)).cost).toBe(0)
  })
})

describe('luxury upkeep (S40)', () => {
  it('only rare decor is luxury, and its weekly upkeep is the configured share of its price', () => {
    const luxury = shopItems(config).filter((item) => isDecor(item) && item.decor.luxury)
    expect(luxury.length).toBeGreaterThanOrEqual(4)
    for (const item of luxury) {
      if (!isDecor(item)) continue
      expect(item.rarity, item.id).toBe('rare')
      expect(itemUpkeep(item, config)).toBe(
        Math.ceil((item.price * config.home.upkeepPctPerWeek) / 100),
      )
    }
    expect(itemUpkeep(lights, config)).toBe(0)
  })

  it('is billed with the rent every week while owned, placed or stored, and stops once sold', () => {
    const owned = owning(start, [chair.id], 10_000)
    const upkeep = weeklyUpkeep(owned.player, config)
    expect(upkeep).toBe(itemUpkeep(chair, config))
    expect(upkeep).toBeGreaterThan(0)
    const week = config.time.rentPeriodGameDays * DAY
    const billed = settleRent(owned.player, week - 1, week, config)
    expect(billed.events).toEqual([
      expect.objectContaining({ kind: 'paid', rent: rentFor('queens-room', config) + upkeep }),
    ])
    expect(billed.player.cash).toBe(10_000 - rentFor('queens-room', config) - upkeep)
    const sold = ok(sellItem(owned, chair.id, config)).snapshot
    expect(weeklyUpkeep(sold.player, config)).toBe(0)
  })
})

describe('placementsAfterMove: the movers', () => {
  it('keeps what fits where it stood, sets the rest up in the first free spot, stores what fits nowhere', () => {
    const loft = place(
      place(
        place(
          inHome(owning(start, [lights.id, neon.id, chair.id]), 'manhattan-loft'),
          lights.id,
          'w-back-0',
        ),
        neon.id,
        'w-left-5',
      ),
      chair.id,
      'f7-4',
    )
    const moved = placementsAfterMove(loft.player, 'queens-room', config)
    // w-back-0 is in the Queens room; the left wall's sixth spot and column 7 are not.
    expect(moved.placed['w-back-0']).toBe(lights.id)
    expect(Object.values(moved.placed).sort()).toEqual([chair.id, lights.id, neon.id].sort())
    // Deterministic: the same move always sets the room up the same way.
    expect(placementsAfterMove(loft.player, 'queens-room', config)).toEqual(moved)
  })
})

describe('homeLock: current, then borough, then funds', () => {
  it('the current home is locked as current, whatever else holds', () => {
    expect(homeLock(start.player, 'queens-room', config)).toEqual({
      code: 'CURRENT_HOME',
      home: 'queens-room',
    })
  })

  it('a home in a borough the level has not opened is borough-locked before funds are checked', () => {
    const broke = { ...start.player, cash: 0 }
    expect(homeLock(broke, 'brooklyn-1br', config)).toEqual({
      code: 'BOROUGH_LOCKED',
      home: 'brooklyn-1br',
      borough: 'brooklyn',
      access: { status: 'locked', required: 'local', current: 'nobody' },
    })
    const local = withClout({ ...start, player: broke }, 100, config).player
    expect(homeLock(local, 'manhattan-loft', config)).toMatchObject({
      code: 'BOROUGH_LOCKED',
      borough: 'manhattan',
      access: { required: 'scene-regular', current: 'local' },
    })
  })

  it('an open borough the player cannot afford is funds-short, naming the reserve plus move-in', () => {
    const local = withClout({ ...start, player: { ...start.player, cash: 50 } }, 100, config)
    const required = rentReserve(local.player, config) + moveInCost('brooklyn-1br', config)
    expect(homeLock(local.player, 'brooklyn-1br', config)).toEqual({
      code: 'FUNDS_SHORT',
      home: 'brooklyn-1br',
      required,
      available: 50,
    })
  })

  it('is open exactly when canAffordMove is, once the borough is open (canAffordMove unchanged)', () => {
    const local = withClout(start, 100, config)
    const threshold = rentReserve(local.player, config) + moveInCost('brooklyn-1br', config)
    for (const cash of [0, threshold - 1, threshold, threshold + 1, 10_000]) {
      const p = { ...local.player, cash }
      expect(homeLock(p, 'brooklyn-1br', config) === null, `cash ${cash}`).toBe(
        canAffordMove(p, 'brooklyn-1br', config),
      )
    }
  })
})

describe('moveHome', () => {
  const ready = withClout({ ...start, player: { ...start.player, cash: 2000 } }, 100, config)

  it('refuses an unknown home, including prototype names', () => {
    for (const home of ['penthouse', '__proto__', 'constructor', '']) {
      expect(errorOf(moveHome(ready, home, config)), home).toEqual({ code: 'UNKNOWN_HOME', home })
    }
  })

  it('refuses what homeLock refuses, changing nothing', () => {
    expect(errorOf(moveHome(ready, 'queens-room', config)).code).toBe('CURRENT_HOME')
    expect(errorOf(moveHome(ready, 'manhattan-loft', config)).code).toBe('BOROUGH_LOCKED')
    const broke = { ...ready, player: { ...ready.player, cash: 10 } }
    expect(errorOf(moveHome(broke, 'brooklyn-1br', config)).code).toBe('FUNDS_SHORT')
  })

  it('is instant: pays the move-in cost, changes the home and logs the move', () => {
    const at = { ...ready, clock: { ...ready.clock, minute: 3 * DAY + 100 } }
    const result = ok(moveHome(at, 'brooklyn-1br', config))
    const cost = moveInCost('brooklyn-1br', config)
    expect(result.cost).toBe(cost)
    expect(result.snapshot.clock).toBe(at.clock)
    expect(result.snapshot.player.cash).toBe(2000 - cost)
    expect(result.snapshot.player.home).toBe('brooklyn-1br')
    expect(result.snapshot.player.rent).toBe(at.player.rent)
    expect(result.snapshot.player.apartment.moveLog).toEqual([
      { from: 'queens-room', to: 'brooklyn-1br', at: 3 * DAY + 100, cost },
    ])
    expect(homeClout(result.snapshot.player, config)).toBe(config.home.baseScore['brooklyn-1br'])
  })

  it('the movers keep decor where it stood when the new home has the spot, and set up the rest', () => {
    const decorated = place(
      place(owning(ready, [lights.id, chair.id]), lights.id, 'w-back-0'),
      chair.id,
      'f3-1',
    )
    const brooklyn = ok(moveHome(decorated, 'brooklyn-1br', config)).snapshot
    expect(brooklyn.player.apartment.placed).toEqual({ 'w-back-0': lights.id, 'f3-1': chair.id })
    const moved = place(brooklyn, chair.id, 'f5-3')
    const back = ok(moveHome(moved, 'queens-room', config)).snapshot
    expect(back.player.apartment.placed['w-back-0']).toBe(lights.id)
    expect(Object.values(back.player.apartment.placed)).toContain(chair.id)
    expect(back.player.inventory.decor.map((entry) => entry.itemId).sort()).toEqual(
      [chair.id, lights.id].sort(),
    )
  })

  it('keeps the newest home.moveLogMax moves', () => {
    let snapshot: GameSnapshot = { ...ready, player: { ...ready.player, cash: 1_000_000 } }
    const moves = config.home.moveLogMax + 5
    for (let i = 0; i < moves; i += 1) {
      const to = snapshot.player.home === 'queens-room' ? 'brooklyn-1br' : 'queens-room'
      snapshot = { ...snapshot, clock: { ...snapshot.clock, minute: snapshot.clock.minute + 1 } }
      snapshot = ok(moveHome(snapshot, to, config)).snapshot
    }
    const log = snapshot.player.apartment.moveLog
    expect(log).toHaveLength(config.home.moveLogMax)
    expect(log.at(-1)?.at).toBe(snapshot.clock.minute)
  })

  it('reports a level-up when the new home’s base score lifts the player (source home)', () => {
    const known = config.clout.levels.find((level) => level.id === 'known')?.minClout ?? 0
    const nearKnown = withClout(
      { ...start, player: { ...start.player, cash: 50_000 } },
      known - config.home.baseScore['manhattan-loft'],
      config,
    )
    const result = ok(moveHome(nearKnown, 'manhattan-loft', config))
    expect(result.levelUp).toMatchObject({ to: 'known', source: 'home' })
  })
})

describe('eviction and the apartment', () => {
  it('an eviction to the lowest-rent home has the movers set the decor up there', () => {
    const owned = owning(inHome(start, 'brooklyn-1br'), [lights.id, neon.id], 0)
    const placed = place(place(owned, lights.id, 'w-back-0'), neon.id, 'w-left-4')
    const missed = { ...placed.player, rent: { owed: 0, missed: config.rent.evictAfterMissed - 1 } }
    const week = config.time.rentPeriodGameDays * DAY
    const settled = settleRent(missed, week - 1, week, config)
    expect(settled.events.map((event) => event.kind)).toEqual(['evicted'])
    expect(settled.player.home).toBe('queens-room')
    expect(settled.player.apartment).toMatchObject({
      ...initialApartment,
      placed: expect.any(Object),
    })
    expect(settled.player.apartment.placed['w-back-0']).toBe(lights.id)
    expect(Object.values(settled.player.apartment.placed)).toContain(neon.id)
  })
})
