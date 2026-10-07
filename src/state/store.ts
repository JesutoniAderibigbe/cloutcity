/**
 * The player's local-first game state, persisted to localStorage (zustand `persist`).
 *
 * The store holds an engine snapshot and calls the engine (src/engine) for every change; game
 * rules live there, not here. The save format and its migrations are src/engine/save.ts.
 * Saved data is untrusted: it is validated on every load and replaced by a fresh state if it
 * does not fit the schema.
 *
 * Client code: it validates with `zod/mini` (tree-shakable) and reads balance.json directly
 * (validated in src/lib/data/data.test.ts) to keep zod's classic build out of the shell JS.
 *
 * In a browser the store hydrates synchronously when this module loads. Components that render
 * persisted values must read them after mount to avoid a server/client hydration mismatch.
 */
import { useStore } from 'zustand'
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware'
import { createStore } from 'zustand/vanilla'
import { performAction, type ActionResult } from '@/engine/actions'
import { isSpeed } from '@/engine/clock'
import { engineConfig } from '@/engine/config'
import {
  chooseEventOption,
  openEvent,
  rollEvent,
  type ChooseResult,
  type EventContext,
  type EventOutcome,
  type OpenResult,
} from '@/engine/events'
import { tick } from '@/engine/game'
import {
  buyItem,
  equipItem,
  sellItem,
  unequipSlot,
  consumeGift,
  type GiftTarget,
  type ItemResult,
} from '@/engine/items'
import { workShift, type ShiftResult } from '@/engine/jobs'
import { performPlaceAction, type PlaceActionResult } from '@/engine/placeActions'
import type { Place } from '@/engine/places'
import {
  NewerSaveError,
  SAVE_VERSION,
  createSaveSchema,
  initialSave,
  loadSave,
  migrateSave,
  type SaveState,
} from '@/engine/save'
import { log, type Logger } from '@/lib/log'
import { browserLocalStorage, createSafeJsonStorage } from './storage'

export const STORE_KEY = 'cloutcity:game'
export const STORE_VERSION = SAVE_VERSION

export const PersistedStateSchema = createSaveSchema(engineConfig)
export type PersistedState = SaveState

export interface GameActions {
  /** Passive time: real ms since the last tick, while the tab is (or is not) visible. */
  tick(realElapsedMs: number, visible: boolean): void
  /** Runs a catalog action; the state changes only when the result is ok. */
  performAction(actionId: string): ActionResult
  /** Works one shift of a job (rent falling due on the way is charged by the engine). */
  workShift(jobId: string): ShiftResult
  /** Buys one of a shop item for its price in cash. */
  buyItem(itemId: string): ReturnType<typeof buyItem>
  /** Sells one owned item at its current resale value (a worn item is taken off). */
  sellItem(itemId: string): ReturnType<typeof sellItem>
  /** Wears an owned wearable in its slot. */
  equipItem(itemId: string, slot: string): ItemResult
  /** Takes off whatever is worn in a slot. */
  unequipSlot(slot: string): ItemResult
  /** Uses one gift on yourself or an NPC; it is consumed. Never another player. */
  consumeGift(itemId: string, target: GiftTarget): ReturnType<typeof consumeGift>
  /**
   * Does one action from a place's action sheet. The engine re-checks the borough, opening
   * hours, club door, job lock, funds and energy; the state changes only when the result is ok.
   */
  performPlaceAction(place: Place, actionId: string): PlaceActionResult
  /** Sets the passive clock speed (one of balance `time.speeds`, i.e. 1x or 2x). */
  setSpeed(speed: number): void
  /**
   * Rolls for a random event where the player is now (src/engine/events.ts); an event that
   * fires opens in the event sheet. Returns its id, or null. Callers (travel, place visits)
   * roll after the player arrives somewhere.
   */
  rollForEvent(context: EventContext): string | null
  /** Opens one event, if it is eligible in this context (scripted triggers, the e2e hook). */
  openEvent(eventId: string, context: EventContext): OpenResult
  /** Resolves the open event; on success its outcome is shown until dismissed. */
  chooseEventOption(choiceId: string): ChooseResult
  /** Closes the outcome screen of the last event. */
  dismissEventOutcome(): void
  /**
   * The player's explicit choice to drop a save written by a newer build: starts a fresh game
   * and lets saving resume. Nothing else ever overwrites that save.
   */
  discardNewerSaveAndStartFresh(): void
}

/** Session-only status, never persisted. */
export interface GameStatus {
  /**
   * True when storage holds a save from a newer build. It is left untouched: nothing is written
   * (play continues in memory) until `discardNewerSaveAndStartFresh` is called.
   */
  readonly newerSavePresent: boolean
  /** What the last event choice did, shown in the event sheet until dismissed. */
  readonly eventOutcome: EventOutcome | null
}
export type GameState = PersistedState & GameActions & GameStatus

export function initialPersistedState(): PersistedState {
  return initialSave(engineConfig)
}

/**
 * Upgrades a save written by an older STORE_VERSION (see src/engine/save.ts). A save from a
 * newer build is not loaded (the throw leaves the fresh state in place) and is never
 * overwritten unless the player calls `discardNewerSaveAndStartFresh`.
 */
export function migrateGameState(
  persisted: unknown,
  version: number,
  logger: Logger = log,
): PersistedState {
  const { save, outcome } = migrateSave(persisted, version, engineConfig)
  logger.info(
    outcome === 'carried'
      ? 'Upgraded a saved game to the current format'
      : 'Starting fresh: saved game predates the current format',
    { version, persisted: typeof persisted },
  )
  return save
}

/**
 * Validates loaded state before it replaces the in-memory state. Individually invalid fields
 * are repaired (src/engine/save.ts `loadSave`); only an unusable save is ignored.
 */
export function mergeGameState(
  persisted: unknown,
  current: GameState,
  logger: Logger = log,
): GameState {
  if (persisted === undefined) return current
  const result = loadSave(persisted, engineConfig)
  if (!result.ok) {
    // A corrupt or tampered save is expected and recoverable: info, not warn.
    logger.info('Ignoring a saved game that failed validation', { issues: result.issues })
    return current
  }
  if (result.repaired.length > 0) {
    logger.info('Repaired out-of-range fields in the saved game', { fields: result.repaired })
  }
  return { ...current, ...result.save }
}

/**
 * What makes a save worth writing: the version, clock minute, the player (cash, stats, clout,
 * home, rent, inventory), speed and event state. The sub-minute remainder alone is not, so a
 * visible tab does not write on every tick (a reload loses at most one game minute's worth of
 * carried real time).
 */
function saveSignature(value: StorageValue<unknown> | null): string | undefined {
  if (value === null) return undefined
  const state = (value.state ?? {}) as {
    clock?: { minute?: unknown }
    player?: unknown
    speed?: unknown
    events?: unknown
  }
  return JSON.stringify([
    value.version,
    state.clock?.minute,
    state.player,
    state.speed,
    state.events,
  ])
}

/**
 * Wraps the persist storage so that (1) a save from a newer build is never overwritten
 * without the player's explicit choice, and (2) only meaningful changes are written.
 */
function guardStorage(inner: PersistStorage<PersistedState>) {
  let newerSavePresent = false
  let lastSignature: string | undefined

  const storage: PersistStorage<PersistedState> = {
    getItem: (name) => {
      const value = inner.getItem(name)
      if (value instanceof Promise) return value
      if (value !== null && (value.version ?? 0) > STORE_VERSION) newerSavePresent = true
      lastSignature = saveSignature(value)
      return value
    },
    setItem: (name, value) => {
      if (newerSavePresent) return
      const signature = saveSignature(value)
      if (signature === lastSignature) return
      lastSignature = signature
      return inner.setItem(name, value)
    },
    removeItem: (name) => {
      if (newerSavePresent) return
      lastSignature = undefined
      return inner.removeItem(name)
    },
  }

  return {
    storage,
    get newerSavePresent() {
      return newerSavePresent
    },
    release() {
      newerSavePresent = false
    },
  }
}

export function createGameStore(storage: PersistStorage<PersistedState>, logger: Logger = log) {
  const guard = guardStorage(storage)
  const store = createStore<GameState>()(
    persist(
      (set, get) => ({
        ...initialPersistedState(),
        newerSavePresent: false,
        eventOutcome: null,
        tick: (realElapsedMs, visible) => {
          const state = get()
          const { snapshot } = tick(
            state,
            realElapsedMs,
            { visible, speed: state.speed },
            engineConfig,
          )
          if (snapshot.clock !== state.clock) {
            set({ clock: snapshot.clock, player: snapshot.player })
          }
        },
        performAction: (actionId) => {
          const result = performAction(get(), actionId, engineConfig)
          if (result.ok) set({ clock: result.snapshot.clock, player: result.snapshot.player })
          return result
        },
        workShift: (jobId) => {
          const result = workShift(get(), jobId, engineConfig)
          if (result.ok) set({ clock: result.snapshot.clock, player: result.snapshot.player })
          return result
        },
        buyItem: (itemId) => {
          const result = buyItem(get(), itemId, engineConfig)
          if (result.ok) set({ player: result.snapshot.player })
          return result
        },
        sellItem: (itemId) => {
          const result = sellItem(get(), itemId, engineConfig)
          if (result.ok) set({ player: result.snapshot.player })
          return result
        },
        equipItem: (itemId, slot) => {
          const result = equipItem(get(), itemId, slot, engineConfig)
          if (result.ok) set({ player: result.snapshot.player })
          return result
        },
        unequipSlot: (slot) => {
          const result = unequipSlot(get(), slot)
          if (result.ok) set({ player: result.snapshot.player })
          return result
        },
        consumeGift: (itemId, target) => {
          const result = consumeGift(get(), itemId, target, engineConfig)
          if (result.ok) set({ player: result.snapshot.player })
          return result
        },
        performPlaceAction: (place, actionId) => {
          const result = performPlaceAction(get(), place, actionId, engineConfig)
          if (result.ok) set({ clock: result.snapshot.clock, player: result.snapshot.player })
          return result
        },
        setSpeed: (speed) => {
          if (!isSpeed(speed, engineConfig))
            throw new RangeError(`Unsupported clock speed: ${speed}`)
          set({ speed })
        },
        rollForEvent: (context) => {
          const state = get()
          const { events, event } = rollEvent(state, state.events, context, engineConfig)
          set({ events })
          return event?.id ?? null
        },
        openEvent: (eventId, context) => {
          const state = get()
          const result = openEvent(state, state.events, eventId, context, engineConfig)
          if (result.ok) set({ events: result.events, eventOutcome: null })
          return result
        },
        chooseEventOption: (choiceId) => {
          const state = get()
          const result = chooseEventOption(state, state.events, choiceId, engineConfig)
          if (result.ok) {
            set({
              clock: result.snapshot.clock,
              player: result.snapshot.player,
              events: result.events,
              eventOutcome: result.outcome,
            })
          }
          return result
        },
        dismissEventOutcome: () => set({ eventOutcome: null }),
        discardNewerSaveAndStartFresh: () => {
          guard.release()
          logger.info("Discarding a saved game from a newer build at the player's request")
          set({ ...initialPersistedState(), newerSavePresent: false, eventOutcome: null })
        },
      }),
      {
        name: STORE_KEY,
        version: STORE_VERSION,
        storage: guard.storage,
        partialize: ({ clock, player, speed, events }): PersistedState => ({
          clock,
          player,
          speed,
          events,
        }),
        migrate: (persisted, version) => migrateGameState(persisted, version, logger),
        merge: (persisted, current) => mergeGameState(persisted, current, logger),
        onRehydrateStorage: () => (_state, error) => {
          if (error instanceof NewerSaveError) {
            // Expected (another tab or a rolled-back build); the save is kept untouched.
            logger.info('Saved game is from a newer build; playing in memory without saving', {
              version: error.version,
            })
          } else if (error !== undefined) {
            logger.warn('Could not load the saved game; playing from a fresh state', {
              error: error instanceof Error ? error.message : String(error),
            })
          }
        },
      },
    ),
  )
  // Hydration is synchronous, so the guard already knows. This write is blocked by the guard.
  if (guard.newerSavePresent) store.setState({ newerSavePresent: true })
  return store
}

export type GameStore = ReturnType<typeof createGameStore>

export const gameStore: GameStore = createGameStore(
  createSafeJsonStorage<PersistedState>(browserLocalStorage),
)

/** React binding: `useGameStore((s) => s.player.cash)`. */
export function useGameStore<T>(selector: (state: GameState) => T): T {
  return useStore(gameStore, selector)
}
