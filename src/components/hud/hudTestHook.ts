import { minutesPerDay } from '@/engine/clock'
import { engineConfig } from '@/engine/config'
import { furnishWith } from '@/engine/home'
import { shopItems, shopPrice } from '@/engine/items'
import { nextRentDueDay, rentFor } from '@/engine/rent'
import { gameStore } from '@/state/store'

/**
 * Test-only hook for the S10a shop, inventory and rent flows (tests/e2e/shop-jobs-rent.spec.ts)
 * and the S16 home (tests/e2e/home-apartment.spec.ts),
 * on `window.__cloutcityTest.hud`. Only builds with NEXT_PUBLIC_TEST_HOOKS=1 load it (from its
 * own chunk, see HudPanelMount), and it installs only when the page also sets
 * `window.__CLOUTCITY_E2E__ = true` before the app loads (Playwright's addInitScript). Time moves through the
 * store's `advanceMinutes`, so decay and rent run through the engine like any other advance.
 * The energy setter writes the local save directly, which anyone with devtools can already do.
 */
export interface HudTestHook {
  /**
   * Fast-forwards the personal clock to the first minute of the next rent day, so that rent
   * is charged. Returns the 1-based day it fell on.
   */
  advancePastNextRentDay(): number
  /** Fast-forwards the personal clock by whole game minutes (decay and rent apply). */
  advanceMinutes(minutes: number): void
  setEnergy(energy: number): void
  /** Buys an item through the store and engine (funds and ownership still apply); false if refused. */
  buy(itemId: string): boolean
  /** Moves home through the store and engine (locks still apply); false if refused. */
  moveHome(home: string): boolean
  /**
   * Sets up every stored decor item in the first spot it fits (S40, the movers' rule), through
   * the store's `placeDecor` so the engine checks each one. Returns how many were placed.
   */
  furnish(): number
  /** Places owned decor at a cell, turned (S40), through the store and engine; false if refused. */
  place(itemId: string, slotId: string, turn: 0 | 1 | 2 | 3): boolean
  /** Puts every placed decor item in storage (S40). */
  clearRoom(): void
  state(): {
    readonly cash: number
    readonly minute: number
    readonly energy: number
    readonly home: string
    readonly rentForHome: number
    readonly owned: readonly string[]
    readonly outfit: Readonly<Record<string, string>>
    readonly gifts: Readonly<Record<string, number>>
    /** Owned decor (S16): item id → the colour variant shown. */
    readonly decor: Readonly<Record<string, string>>
    /** Decor placed in the current home: slot id → item id. */
    readonly placed: Readonly<Record<string, string>>
    readonly lastRentEvent: string | null
  }
  /**
   * Every item the shop sells, with its price, so specs assert against data, not literals;
   * `gift` and `decor` mark those that are not wearables.
   */
  shop(): readonly {
    readonly id: string
    readonly price: number
    readonly gift: boolean
    readonly decor: boolean
  }[]
}

declare global {
  interface CloutcityTestHooks {
    hud?: HudTestHook
  }
}

export function installHudTestHook(): void {
  if (window.__CLOUTCITY_E2E__ !== true) return
  window.__cloutcityTest = { ...window.__cloutcityTest, hud: createHudTestHook() }
}

function createHudTestHook(): HudTestHook {
  return {
    advancePastNextRentDay: () => {
      const { clock } = gameStore.getState()
      const day = nextRentDueDay(clock.minute, engineConfig)
      const target = (day - 1) * minutesPerDay(engineConfig)
      gameStore.getState().advanceMinutes(target - clock.minute)
      return day
    },
    advanceMinutes: (minutes) => gameStore.getState().advanceMinutes(minutes),
    setEnergy: (energy) => {
      const { max } = engineConfig.stats
      if (!Number.isSafeInteger(energy) || energy < 0 || energy > max) {
        throw new RangeError(`energy must be a whole number from 0 to ${max}: ${energy}`)
      }
      const { player } = gameStore.getState()
      gameStore.setState({ player: { ...player, stats: { ...player.stats, energy } } })
    },
    buy: (itemId) => gameStore.getState().buyItem(itemId).ok,
    moveHome: (home) => gameStore.getState().moveHome(home).ok,
    place: (itemId, slotId, turn) => gameStore.getState().placeDecor(itemId, slotId, turn).ok,
    clearRoom: () => {
      for (const slotId of Object.keys(gameStore.getState().player.apartment.placed)) {
        gameStore.getState().removeDecor(slotId)
      }
    },
    furnish: () => {
      const { player } = gameStore.getState()
      const stored = player.inventory.decor
        .filter((owned) => !Object.values(player.apartment.placed).includes(owned.itemId))
        .map((owned) => ({ itemId: owned.itemId, slotId: '', turn: 0 as const }))
      const set = furnishWith(player, player.home, stored, engineConfig)
      let placed = 0
      for (const [slotId, itemId] of Object.entries(set.placed)) {
        if (Object.values(player.apartment.placed).includes(itemId)) continue
        const turn = set.inventory.decor.find((owned) => owned.itemId === itemId)?.turn ?? 0
        if (gameStore.getState().placeDecor(itemId, slotId, turn).ok) placed += 1
      }
      return placed
    },
    state: () => {
      const { player, clock, lastRentEvent } = gameStore.getState()
      return {
        cash: player.cash,
        minute: clock.minute,
        energy: player.stats.energy,
        home: player.home,
        rentForHome: rentFor(player.home, engineConfig),
        owned: player.inventory.wearables.map((owned) => owned.itemId),
        outfit: { ...player.inventory.outfit },
        gifts: Object.fromEntries(player.inventory.gifts.map((g) => [g.itemId, g.count])),
        decor: Object.fromEntries(player.inventory.decor.map((d) => [d.itemId, d.variant])),
        placed: { ...player.apartment.placed },
        lastRentEvent: lastRentEvent?.kind ?? null,
      }
    },
    shop: () =>
      shopItems(engineConfig).map((item) => ({
        id: item.id,
        // What this player pays (GR-11: their shop-price trait), as the shop shows and charges.
        price: shopPrice(item, gameStore.getState().player, engineConfig),
        gift: item.category === 'gift',
        decor: item.category === 'decor',
      })),
  }
}
