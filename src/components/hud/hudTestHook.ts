import { minutesPerDay } from '@/engine/clock'
import { engineConfig } from '@/engine/config'
import { shopItems } from '@/engine/items'
import { nextRentDueDay, rentFor } from '@/engine/rent'
import { gameStore } from '@/state/store'

/**
 * Test-only hook for the S10a shop, inventory and rent flows (tests/e2e/shop-jobs-rent.spec.ts).
 * Installed only when the page sets `window.__CLOUTCITY_E2E__ = true` before the app loads
 * (Playwright's addInitScript), from its own lazily loaded chunk. Time moves through the
 * store's `advanceMinutes`, so decay and rent run through the engine like any other advance.
 * The energy setter writes the local save directly, which anyone with devtools can already do.
 */
export interface HudTestHook {
  /**
   * Fast-forwards the personal clock to the first minute of the next rent day, so that rent
   * is charged. Returns the 1-based day it fell on.
   */
  advancePastNextRentDay(): number
  setEnergy(energy: number): void
  state(): {
    readonly cash: number
    readonly minute: number
    readonly energy: number
    readonly home: string
    readonly rentForHome: number
    readonly owned: readonly string[]
    readonly outfit: Readonly<Record<string, string>>
    readonly gifts: Readonly<Record<string, number>>
    readonly lastRentEvent: string | null
  }
  /** Shop items with their prices, so specs assert against data, not literals. */
  shop(): readonly { readonly id: string; readonly price: number; readonly gift: boolean }[]
}

declare global {
  interface Window {
    __cloutcityHud?: HudTestHook
  }
}

export function installHudTestHook(): void {
  if (window.__CLOUTCITY_E2E__ !== true) return
  window.__cloutcityHud = {
    advancePastNextRentDay: () => {
      const { clock } = gameStore.getState()
      const day = nextRentDueDay(clock.minute, engineConfig)
      const target = (day - 1) * minutesPerDay(engineConfig)
      gameStore.getState().advanceMinutes(target - clock.minute)
      return day
    },
    setEnergy: (energy) => {
      const { max } = engineConfig.stats
      if (!Number.isSafeInteger(energy) || energy < 0 || energy > max) {
        throw new RangeError(`energy must be a whole number from 0 to ${max}: ${energy}`)
      }
      const { player } = gameStore.getState()
      gameStore.setState({ player: { ...player, stats: { ...player.stats, energy } } })
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
        lastRentEvent: lastRentEvent?.kind ?? null,
      }
    },
    shop: () =>
      shopItems(engineConfig).map((item) => ({
        id: item.id,
        price: item.price,
        gift: item.category === 'gift',
      })),
  }
}
