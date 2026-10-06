/**
 * The player's local-first game state, persisted to localStorage (zustand `persist`).
 *
 * Bump STORE_VERSION on any breaking change to PersistedStateSchema and teach `migrateGameState`
 * the step from the previous version. Saved data is untrusted: it is validated on every load and
 * replaced by a fresh state if it does not fit the schema.
 *
 * Client code: it validates with `zod/mini` (tree-shakable) and reads balance.json directly
 * (validated in src/lib/data/data.test.ts) to keep zod's classic build out of the shell JS.
 *
 * In a browser the store hydrates synchronously when this module loads. Components that render
 * persisted values must read them after mount to avoid a server/client hydration mismatch.
 */
import { useStore } from 'zustand'
import { persist, type PersistStorage } from 'zustand/middleware'
import { createStore } from 'zustand/vanilla'
import { z } from 'zod/mini'
import balanceJson from '@data/config/balance.json'
import { log, type Logger } from '@/lib/log'
import { browserLocalStorage, createSafeJsonStorage } from './storage'

export const STORE_KEY = 'cloutcity:game'
export const STORE_VERSION = 1

/** Whole in-game dollars. */
const CashSchema = z.int().check(z.nonnegative())

export const PersistedStateSchema = z.strictObject({
  player: z.strictObject({ cash: CashSchema }),
})
export type PersistedState = z.infer<typeof PersistedStateSchema>

export interface GameActions {
  setCash(cash: number): void
}
export type GameState = PersistedState & GameActions

export function initialPersistedState(): PersistedState {
  return { player: { cash: balanceJson.start.cash } }
}

/**
 * Upgrades a save written by an older STORE_VERSION. No earlier version has shipped, so any
 * older save starts fresh. A save from a newer build is not loaded (the throw leaves the fresh
 * state in place and the save untouched); it is only overwritten if the player then plays on
 * this older build.
 */
export function migrateGameState(
  persisted: unknown,
  version: number,
  logger: Logger = log,
): PersistedState {
  if (version > STORE_VERSION) {
    throw new Error(`Saved game version ${version} is newer than this build (${STORE_VERSION})`)
  }
  logger.info('Starting fresh: saved game predates the current format', {
    version,
    persisted: typeof persisted,
  })
  return initialPersistedState()
}

/** Validates loaded state before it replaces the in-memory state. */
export function mergeGameState(
  persisted: unknown,
  current: GameState,
  logger: Logger = log,
): GameState {
  if (persisted === undefined) return current
  const result = PersistedStateSchema.safeParse(persisted)
  if (!result.success) {
    // A corrupt or tampered save is expected and recoverable: info, not warn.
    logger.info('Ignoring a saved game that failed validation', {
      issues: result.error.issues.map((issue) => issue.path.join('.')),
    })
    return current
  }
  return { ...current, ...result.data }
}

export function createGameStore(storage: PersistStorage<PersistedState>, logger: Logger = log) {
  return createStore<GameState>()(
    persist(
      (set) => ({
        ...initialPersistedState(),
        setCash: (cash) => set({ player: { cash: CashSchema.parse(cash) } }),
      }),
      {
        name: STORE_KEY,
        version: STORE_VERSION,
        storage,
        partialize: (state): PersistedState => ({ player: state.player }),
        migrate: (persisted, version) => migrateGameState(persisted, version, logger),
        merge: (persisted, current) => mergeGameState(persisted, current, logger),
        onRehydrateStorage: () => (_state, error) => {
          if (error !== undefined) {
            logger.warn('Could not load the saved game; playing from a fresh state', {
              error: error instanceof Error ? error.message : String(error),
            })
          }
        },
      },
    ),
  )
}

export type GameStore = ReturnType<typeof createGameStore>

export const gameStore: GameStore = createGameStore(
  createSafeJsonStorage<PersistedState>(browserLocalStorage),
)

/** React binding: `useGameStore((s) => s.player.cash)`. */
export function useGameStore<T>(selector: (state: GameState) => T): T {
  return useStore(gameStore, selector)
}
