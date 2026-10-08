/**
 * S40 buy mode 2.0, across the engine: the grid maths (src/engine/homeGrid.ts), the S13 farming
 * probe extended to the grid (buy, place, move, turn, store, sell and finishes never farm clout or
 * cash), and S18c plausibility accepting honest decor play: buys, sells, moves, turns and finishes
 * uploaded step by step, with the home-clout slack rule (`homeCloutGone`) still holding.
 */
import baselineJson from '@data/sim/economy-baseline.derived.json'
import { describe, expect, it } from 'vitest'
import { sync } from '@/lib/data/config'
import { EconomyBaselineSchema } from '@/lib/data/schemas/sim'
import { cloutSums, totalClout } from './clout'
import { engineConfig as config } from './config'
import { initialSnapshot, type GameSnapshot } from './game'
import { applyFinish, homeClout, moveHome, placeDecor, removeDecor, rotateDecor } from './home'
import {
  facingTurn,
  firstFit,
  fitRefusal,
  footprintCells,
  footprintSize,
  gridSlots,
  parseSlot,
  type GridItem,
  type GridPlacement,
} from './homeGrid'
import { buyItem, findItem, isDecor, sellItem, shopItems, type DecorDef } from './items'
import { checkUpload, plausibilityCeilings, type UploadContext } from './plausibility'
import { countAction, initialSave, type SaveState } from './save'
import { freeSlot, unfurnished, withClout } from './test-support'

const size = { cols: 5, rows: 4 }
const sofa: GridItem = { kind: 'floor', footprint: '2x1', layer: 'furniture' }
const rug: GridItem = { kind: 'floor', footprint: '2x2', layer: 'rug' }
const frame: GridItem = { kind: 'wall', footprint: '1x1', layer: 'furniture' }

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`)
  return result as Extract<T, { ok: true }>
}

describe('homeGrid', () => {
  it('parses floor and wall cells of a grid, and nothing else', () => {
    expect(parseSlot('f4-3', size)).toEqual({ id: 'f4-3', kind: 'floor', c: 4, r: 3 })
    expect(parseSlot('w-left-3', size)).toEqual({
      id: 'w-left-3',
      kind: 'wall',
      wall: 'left',
      i: 3,
    })
    for (const id of ['f5-0', 'f0-4', 'w-back-5', 'w-left-4', 'wall-1', 'f-1-0', '', '__proto__']) {
      expect(parseSlot(id, size), id).toBeNull()
    }
    expect(gridSlots(size)).toHaveLength(20 + 5 + 4 + 4)
  })

  it('a footprint spans across at turns 0 and 2 and deep at 1 and 3; off the grid is null', () => {
    expect(footprintSize('2x1', 0)).toEqual({ w: 2, d: 1 })
    expect(footprintSize('2x1', 3)).toEqual({ w: 1, d: 2 })
    expect(footprintCells(3, 0, '2x1', 0, size)).toEqual(['f3-0', 'f4-0'])
    expect(footprintCells(4, 0, '2x1', 0, size)).toBeNull()
    expect(footprintCells(1, 1, '2x2', 0, size)).toEqual(['f1-1', 'f2-1', 'f1-2', 'f2-2'])
  })

  it('refuses the wrong kind, off the grid, blocked cells, an occupied cell or a shared slot', () => {
    const lookup = (itemId: string) => (itemId === 'rug' ? rug : itemId === 'frame' ? frame : sofa)
    const others: GridPlacement[] = [
      { itemId: 'rug', slotId: 'f1-1', turn: 0 },
      { itemId: 'sofa', slotId: 'f3-0', turn: 0 },
    ]
    const blocked = new Set(['f0-0', 'w-left-1'])
    const check = (slotId: string, item: GridItem, turn: 0 | 1 | 2 | 3 = 0) =>
      fitRefusal(slotId, item, turn, size, blocked, others, lookup)
    expect(check('w-back-0', sofa)).toBe('wrong-kind')
    expect(check('f0-1', frame)).toBe('wrong-kind')
    expect(check('f4-2', sofa)).toBe('off-grid')
    expect(check('f0-0', sofa)).toBe('blocked')
    expect(check('w-left-1', frame)).toBe('blocked')
    expect(check('f4-0', sofa, 1)).toBe('occupied')
    // Furniture may stand on the rug, but not share its slot; a second rug may not overlap it.
    expect(check('f2-1', sofa, 1)).toBeNull()
    expect(check('f1-1', sofa)).toBe('occupied')
    expect(check('f2-2', rug)).toBe('occupied')
  })

  it('faces an item away from its nearest wall, and finds the first spot that fits', () => {
    expect(facingTurn(2, 0, 1, 1, size)).toBe(0)
    expect(facingTurn(0, 2, 1, 1, size)).toBe(1)
    expect(facingTurn(4, 2, 1, 1, size)).toBe(3)
    const spot = firstFit(sofa, size, new Set(['f0-0', 'f1-0']), [], () => sofa)
    expect(spot).toEqual({ slotId: 'f2-0', turn: 0 })
    const full = new Set(gridSlots(size).map((slot) => slot.id))
    expect(firstFit(sofa, size, full, [], () => sofa)).toBeNull()
  })
})

describe('S13 extended: the grid never farms clout or cash', () => {
  const decor = shopItems(config).filter(
    (item): item is DecorDef => isDecor(item) && !item.decor.starter,
  )

  it('buy, place, move, turn, store and sell loops write no clout and only ever lose cash', () => {
    let snapshot: GameSnapshot = withClout(
      unfurnished({
        ...initialSnapshot(config),
        player: { ...initialSnapshot(config).player, cash: 50_000 },
      }),
      90,
      config,
    )
    const ledger = snapshot.player.clout.ledger
    const earned = cloutSums(snapshot.player.clout).earned
    for (const item of decor) {
      const before = snapshot.player.cash
      snapshot = ok(buyItem(snapshot, item.id, config)).snapshot
      for (let i = 0; i < 3; i += 1) {
        const spot = freeSlot(snapshot.player, item.id, config)
        snapshot = ok(placeDecor(snapshot, item.id, spot.slotId, config, spot.turn)).snapshot
        if (item.decor.fits !== 'wall') {
          const turned = rotateDecor(snapshot, item.id, config)
          if (turned.ok) snapshot = turned.snapshot
        }
        snapshot = ok(removeDecor(snapshot, spot.slotId, config)).snapshot
      }
      snapshot = ok(sellItem(snapshot, item.id, config)).snapshot
      expect(snapshot.player.cash, item.id).toBeLessThan(before)
    }
    expect(snapshot.player.clout.ledger).toEqual(ledger)
    expect(cloutSums(snapshot.player.clout).earned).toBe(earned)
    expect(totalClout(snapshot.player, config)).toBe(90)
  })

  it('home clout from the grid stays under the cap whatever is placed, and finishes add none', () => {
    let snapshot: GameSnapshot = withClout(
      { ...initialSnapshot(config), player: { ...initialSnapshot(config).player, cash: 100_000 } },
      2000,
      config,
    )
    snapshot = ok(moveHome(snapshot, 'manhattan-loft', config)).snapshot
    for (const item of decor) {
      snapshot = ok(buyItem(snapshot, item.id, config)).snapshot
      const fits = (() => {
        try {
          return freeSlot(snapshot.player, item.id, config)
        } catch {
          return null
        }
      })()
      if (fits !== null) {
        snapshot = ok(placeDecor(snapshot, item.id, fits.slotId, config, fits.turn)).snapshot
      }
    }
    expect(homeClout(snapshot.player, config)).toBeLessThanOrEqual(config.home.maxClout)
    const clout = totalClout(snapshot.player, config)
    for (const finish of config.home.finishes) {
      snapshot = ok(applyFinish(snapshot, finish.id, config)).snapshot
    }
    expect(totalClout(snapshot.player, config)).toBe(clout)
  })
})

describe('S18c: honest decor play is accepted, and home clout slack still holds', () => {
  const baseline = EconomyBaselineSchema.parse(baselineJson)
  const ceilings = plausibilityCeilings(config, baseline, sync)
  const ctx = (patch: Partial<UploadContext> = {}): UploadContext => ({
    realMinutesSinceAccept: 5,
    burstCreditMinutes: sync.plausibility.burstRealMinutes,
    accountAgeMinutes: 24 * 60,
    serverGrantKeys: [],
    entitledItemIds: [],
    firstUpload: false,
    ...patch,
  })
  const item = (id: string): DecorDef => {
    const found = findItem(id, config)
    if (found === undefined || !isDecor(found)) throw new Error(`no decor ${id}`)
    return found
  }

  it('buys, places, moves, turns, stores, sells and repaints on start cash: every upload accepted', () => {
    const radio = item('vintage-radio')
    const print = item('skyline-print')
    const steps: ((save: SaveState) => SaveState)[] = [
      (save) => ({ ...save, player: ok(buyItem(save, radio.id, config)).snapshot.player }),
      (save) => {
        const spot = freeSlot(save.player, radio.id, config)
        return {
          ...save,
          player: ok(placeDecor(save, radio.id, spot.slotId, config, spot.turn)).snapshot.player,
        }
      },
      (save) => ({ ...save, player: ok(rotateDecor(save, radio.id, config)).snapshot.player }),
      (save) => ({ ...save, player: ok(buyItem(save, print.id, config)).snapshot.player }),
      (save) => ({
        ...save,
        player: ok(placeDecor(save, print.id, 'w-back-0', config)).snapshot.player,
      }),
      // Rearranging the starter pieces: the table to storage, the plant across the room.
      (save) => ({ ...save, player: ok(removeDecor(save, 'f1-3', config)).snapshot.player }),
      (save) => {
        const spot = freeSlot(save.player, 'starter-plant', config)
        return {
          ...save,
          player: ok(placeDecor(save, 'starter-plant', spot.slotId, config, spot.turn)).snapshot
            .player,
        }
      },
      (save) => ({ ...save, player: ok(sellItem(save, radio.id, config)).snapshot.player }),
      (save) => ({ ...save, player: ok(applyFinish(save, 'sky-wash', config)).snapshot.player }),
      (save) => ({ ...save, player: ok(sellItem(save, print.id, config)).snapshot.player }),
    ]
    let save: SaveState = initialSave(config)
    let prev = checkUpload(null, save, ctx({ firstUpload: true }), ceilings, config).save
    expect(prev).not.toBeNull()
    for (const [i, step] of steps.entries()) {
      save = countAction(step({ ...save, clock: { ...save.clock, minute: save.clock.minute + 5 } }))
      const verdict = checkUpload(prev, save, ctx(), ceilings, config)
      expect(verdict.outcome, `step ${i}: ${verdict.findings.join(',')}`).toBe('accept')
      prev = verdict.save
    }
    expect(save.player.cash).toBeLessThan(initialSave(config).player.cash)
  })

  it('a save that claims a peak level only home clout it never held could give is lowered', () => {
    // Placed decor bought and sold inside one window leaves no trace; the slack is at most
    // home.maxClout (SEC-18). A peak above everything plus that slack is repaired.
    let save: SaveState = initialSave(config)
    const prev = checkUpload(null, save, ctx({ firstUpload: true }), ceilings, config).save
    save = countAction({
      ...save,
      clock: { ...save.clock, minute: save.clock.minute + 5 },
      player: { ...save.player, clout: { ...save.player.clout, peakLevel: 3 } },
    })
    const verdict = checkUpload(prev, save, ctx(), ceilings, config)
    expect(verdict.outcome).not.toBe('accept')
    expect(verdict.findings).toContain('peak-above-reachable')
  })
})
