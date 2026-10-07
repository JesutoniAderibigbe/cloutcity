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
import type { LevelUp } from '@/engine/clout'
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
import { advanceMinutes, tick } from '@/engine/game'
import { findGoal, syncGoals, victoryGoal, type GoalsState } from '@/engine/goals'
import { grant, type GrantResult } from '@/engine/grants'
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
import {
  buyAtShop,
  performPlaceAction,
  type PlaceActionResult,
  type ShopBuyResult,
} from '@/engine/placeActions'
import type { Place } from '@/engine/places'
import { prestige as startNextRun, type PrestigeResult } from '@/engine/prestige'
import type { RentEvent } from '@/engine/rent'
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
  /**
   * Buys one item at a place's shop: the engine checks the place has a shop that is open to
   * the player now, then the usual buy rules.
   */
  buyAtShop(place: Place, itemId: string): ShopBuyResult
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
  /**
   * Fast-forwards the personal clock by whole game minutes (decay and rent apply). Used by the
   * e2e hook; no player-facing control waits without an action yet.
   */
  advanceMinutes(minutes: number): void
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
  /** Clears the last level-up (the level-up toast closed). */
  dismissLevelUp(): void
  /**
   * Claims a reached goal's reward through the grant function (src/engine/grants.ts): capped,
   * logged and idempotent. A second claim replays the first and changes nothing.
   */
  claimGoalReward(goalId: string): GrantResult<PersistedState>
  /**
   * After Icon: grants the run's badge and starts the next run (src/engine/prestige.ts). Named
   * apart from the persisted `prestige` state it changes.
   */
  startPrestige(): PrestigeResult<PersistedState>
  /** The player closed the Icon moment; it does not show again this run. */
  acknowledgeIconMoment(): void
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
  /**
   * The last rent charge, miss or collection this session, for the rent panel. Session-only:
   * a reload starts with none (the save keeps what is owed, not the notice).
   */
  readonly lastRentEvent: RentEvent | null
  /**
   * The last level-up, shown as a toast until dismissed. Session-only: never saved and not
   * part of the save signature, so a reload never replays it.
   */
  readonly lastLevelUp: LevelUp | null
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
 * What makes a save worth writing: the version, clock minute, the player (cash, stats, clout
 * ledger, flex state, home, rent, inventory, club nights, visits), speed, event state, goals,
 * the grant log and prestige. The sub-minute remainder alone is not, so a visible tab does not
 * write on every tick (a reload loses at most one game minute's worth of carried real time).
 */
function saveSignature(value: StorageValue<unknown> | null): string | undefined {
  if (value === null) return undefined
  const state = (value.state ?? {}) as {
    clock?: { minute?: unknown }
    player?: unknown
    speed?: unknown
    events?: unknown
    goals?: unknown
    grants?: unknown
    prestige?: unknown
  }
  return JSON.stringify([
    value.version,
    state.clock?.minute,
    state.player,
    state.speed,
    state.events,
    state.goals,
    state.grants,
    state.prestige,
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

/** The last rent event of an advance, or the current one when the advance had none. */
function latestRent(events: readonly RentEvent[], current: RentEvent | null): RentEvent | null {
  return events.at(-1) ?? current
}

const ICON_LEVEL = victoryGoal(engineConfig).level

/**
 * A new level-up replaces the one showing; no level-up leaves the toast as it is. Reaching the
 * victory level while the Icon moment is about to show adds no toast: the moment is the
 * celebration.
 */
function levelUpPatch(levelUp: LevelUp | null, goals: GoalsState): Partial<GameStatus> {
  if (levelUp === null) return {}
  const iconMoment = goals.icon.reachedAt !== null && !goals.icon.acknowledged
  return levelUp.to === ICON_LEVEL && iconMoment ? {} : { lastLevelUp: levelUp }
}

/** The persisted part of the state: what a save holds. */
function persistedOf(state: PersistedState): PersistedState {
  const { clock, player, speed, events, goals, grants, prestige: prestigeState } = state
  return { clock, player, speed, events, goals, grants, prestige: prestigeState }
}

export function createGameStore(storage: PersistStorage<PersistedState>, logger: Logger = log) {
  const guard = guardStorage(storage)
  const store = createStore<GameState>()(
    persist(
      (set, get) => {
        /**
         * Applies a state-changing action's result, then records any goal it reached
         * (src/engine/goals.ts `syncGoals`). Never on the passive tick: time alone reaches no goal.
         */
        const commit = (patch: Partial<GameState>, levelUp: LevelUp | null = null) => {
          const { save } = syncGoals({ ...get(), ...patch }, engineConfig)
          set({ ...patch, goals: save.goals, ...levelUpPatch(levelUp, save.goals) })
        }
        return {
          ...initialPersistedState(),
          newerSavePresent: false,
          eventOutcome: null,
          lastRentEvent: null,
          lastLevelUp: null,
          tick: (realElapsedMs, visible) => {
            const state = get()
            const { snapshot, rent } = tick(
              state,
              realElapsedMs,
              { visible, speed: state.speed },
              engineConfig,
            )
            if (snapshot.clock !== state.clock) {
              set({
                clock: snapshot.clock,
                player: snapshot.player,
                lastRentEvent: latestRent(rent, state.lastRentEvent),
              })
            }
          },
          performAction: (actionId) => {
            const state = get()
            const result = performAction(state, actionId, engineConfig)
            if (result.ok) {
              commit({
                clock: result.snapshot.clock,
                player: result.snapshot.player,
                lastRentEvent: latestRent(result.rent, state.lastRentEvent),
              })
            }
            return result
          },
          workShift: (jobId) => {
            const state = get()
            const result = workShift(state, jobId, engineConfig)
            if (result.ok) {
              commit(
                {
                  clock: result.snapshot.clock,
                  player: result.snapshot.player,
                  lastRentEvent: latestRent(result.rent, state.lastRentEvent),
                },
                result.levelUp,
              )
            }
            return result
          },
          buyItem: (itemId) => {
            const result = buyItem(get(), itemId, engineConfig)
            if (result.ok) commit({ player: result.snapshot.player }, result.levelUp)
            return result
          },
          buyAtShop: (place, itemId) => {
            const result = buyAtShop(get(), place, itemId, engineConfig)
            if (result.ok) commit({ player: result.snapshot.player }, result.levelUp)
            return result
          },
          sellItem: (itemId) => {
            const result = sellItem(get(), itemId, engineConfig)
            if (result.ok) commit({ player: result.snapshot.player }, result.levelUp)
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
            const state = get()
            const result = performPlaceAction(state, place, actionId, engineConfig)
            if (result.ok) {
              commit(
                {
                  clock: result.snapshot.clock,
                  player: result.snapshot.player,
                  lastRentEvent: latestRent(result.rent, state.lastRentEvent),
                },
                result.levelUp,
              )
            }
            return result
          },
          advanceMinutes: (minutes) => {
            const state = get()
            const { snapshot, rent } = advanceMinutes(state, minutes, engineConfig)
            set({
              clock: snapshot.clock,
              player: snapshot.player,
              lastRentEvent: latestRent(rent, state.lastRentEvent),
            })
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
              commit(
                {
                  clock: result.snapshot.clock,
                  player: result.snapshot.player,
                  events: result.events,
                  eventOutcome: result.outcome,
                  lastRentEvent: latestRent(result.rent, state.lastRentEvent),
                },
                result.levelUp,
              )
            }
            return result
          },
          dismissEventOutcome: () => set({ eventOutcome: null }),
          dismissLevelUp: () => set({ lastLevelUp: null }),
          claimGoalReward: (goalId) => {
            const state = persistedOf(get())
            const goal = findGoal(goalId, engineConfig)
            // Unknown ids still go through the grant function, which refuses them.
            const reward = goal?.reward ?? {}
            const result = grant(
              state,
              { kind: 'goal_reward', goalId, reward },
              Date.now(),
              engineConfig,
            )
            if (result.ok && !result.replayed) {
              const { player, grants, prestige: prestigeState } = result.save
              set({ player, grants, prestige: prestigeState })
            }
            return result
          },
          startPrestige: () => {
            const result = startNextRun(persistedOf(get()), Date.now(), engineConfig)
            if (result.ok) {
              set({
                ...result.save,
                eventOutcome: null,
                lastLevelUp: null,
                lastRentEvent: null,
              })
            }
            return result
          },
          acknowledgeIconMoment: () => {
            const { goals } = get()
            if (goals.icon.reachedAt === null || goals.icon.acknowledged) return
            set({ goals: { ...goals, icon: { ...goals.icon, acknowledged: true } } })
          },
          discardNewerSaveAndStartFresh: () => {
            guard.release()
            logger.info("Discarding a saved game from a newer build at the player's request")
            set({
              ...initialPersistedState(),
              newerSavePresent: false,
              eventOutcome: null,
              lastRentEvent: null,
              lastLevelUp: null,
            })
          },
        }
      },
      {
        name: STORE_KEY,
        version: STORE_VERSION,
        storage: guard.storage,
        partialize: (state): PersistedState => persistedOf(state),
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
