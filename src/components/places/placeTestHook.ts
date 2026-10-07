import { calendar, minutesPerDay } from '@/engine/clock'
import { cloutLevel, itemClout, legacyCloutState, playerLevel, totalClout } from '@/engine/clout'
import { engineConfig } from '@/engine/config'
import { placeActions } from '@/engine/placeActions'
import { findPlace } from '@/lib/world/places'
import { closePlace, openPlace } from '@/state/placeSheet'
import { gameStore } from '@/state/store'

/**
 * Test-only hook so Playwright can open any place by id and set up the player
 * (tests/e2e/place-sheet.spec.ts). Installed only when the page sets
 * `window.__CLOUTCITY_E2E__ = true` before the app loads (Playwright's addInitScript), from its
 * own lazily loaded chunk. Opening goes through `openPlace` (origin `hook`, so the 3D map brings
 * the place into view), the same entry point the 3D pins and Places panel use, and actions still
 * run through the engine. The setters write the local
 * save directly, which anyone with devtools can already do.
 */
export interface PlaceTestHook {
  /** Opens a place's sheet; false (and nothing opens) when no place has that id. */
  open(placeId: string): boolean
  close(): void
  /** Moves the personal clock forward to the next `minuteOfDay` (0..1439). */
  setTimeOfDay(minuteOfDay: number): void
  /**
   * Sets the player's total clout to `clout`: the ledger becomes one legacy entry (less the
   * clout their wearables already carry), and the level it lands on counts as reached, so no
   * level-up is reported for it.
   */
  setClout(clout: number): void
  setCash(cash: number): void
  state(): {
    readonly cash: number
    /** Total clout (src/engine/clout.ts `totalClout`). */
    readonly clout: number
    /** The current clout level id. */
    readonly level: string
    readonly minute: number
    readonly minuteOfDay: number
    readonly stats: { readonly energy: number; readonly hunger: number; readonly mood: number }
  }
  /** The engine's view of a place's actions, so specs assert against config, not literals. */
  actions(placeId: string): readonly {
    readonly id: string
    readonly durationMin: number
    readonly cashCost: number
    readonly mood: number
    readonly cloutGain: number
    readonly blocked: string | null
  }[]
}

declare global {
  interface Window {
    __CLOUTCITY_E2E__?: boolean
    __cloutcityPlaces?: PlaceTestHook
  }
}

const wholeNonNegative = (value: number, what: string) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${what} must be a whole, non-negative number: ${value}`)
  }
}

export function installPlaceTestHook(): void {
  if (window.__CLOUTCITY_E2E__ !== true) return
  window.__cloutcityPlaces = {
    open: (placeId) => {
      if (findPlace(placeId) === undefined) return false
      openPlace(placeId, { origin: 'hook' })
      return true
    },
    close: closePlace,
    setTimeOfDay: (minuteOfDay) => {
      const perDay = minutesPerDay(engineConfig)
      wholeNonNegative(minuteOfDay, 'minuteOfDay')
      if (minuteOfDay >= perDay) throw new RangeError(`minuteOfDay must be below ${perDay}`)
      const { clock } = gameStore.getState()
      const now = calendar(clock.minute, engineConfig).minuteOfDay
      const ahead = (minuteOfDay - now + perDay) % perDay
      gameStore.setState({ clock: { ...clock, minute: clock.minute + ahead } })
    },
    setClout: (clout) => {
      wholeNonNegative(clout, 'clout')
      const { player } = gameStore.getState()
      const earned = Math.max(0, clout - itemClout(player, engineConfig))
      const peak = cloutLevel(clout, engineConfig).index
      const ledger = {
        ...legacyCloutState(earned, peak),
        firstPaycheckPaid: player.clout.firstPaycheckPaid,
      }
      gameStore.setState({ player: { ...player, clout: ledger } })
    },
    setCash: (cash) => {
      wholeNonNegative(cash, 'cash')
      const { player } = gameStore.getState()
      gameStore.setState({ player: { ...player, cash } })
    },
    state: () => {
      const { player, clock } = gameStore.getState()
      return {
        cash: player.cash,
        clout: totalClout(player, engineConfig),
        level: playerLevel(player, engineConfig).id,
        minute: clock.minute,
        minuteOfDay: calendar(clock.minute, engineConfig).minuteOfDay,
        stats: player.stats,
      }
    },
    actions: (placeId) => {
      const place = findPlace(placeId)
      if (place === undefined) throw new Error(`No place "${placeId}"`)
      const view = placeActions(place, gameStore.getState(), engineConfig)
      if (view.kind === 'look-only') return []
      return view.actions.map((action) => ({
        id: action.id,
        durationMin: action.def.durationMin,
        cashCost: action.def.cashCost,
        mood: action.def.statEffects.mood ?? 0,
        cloutGain: action.kind === 'club-night' || action.kind === 'flex' ? action.cloutGain : 0,
        blocked: action.block?.code ?? null,
      }))
    },
  }
}
