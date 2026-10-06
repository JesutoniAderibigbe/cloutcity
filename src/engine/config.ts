/**
 * The balance numbers the engine runs on. Engine functions take an EngineConfig argument, so
 * tests can pass their own; the game passes `engineConfig`, built from data/config/balance.json
 * (validated by BalanceConfigSchema in src/lib/data/data.test.ts).
 *
 * The JSON is read directly rather than through src/lib/data/config.ts so the engine stays off
 * classic zod and out of the shell JS budget (src/lib/client-imports.test.ts).
 */
import balanceJson from '@data/config/balance.json'
import type { BalanceConfig } from '@/lib/data/schemas/config'

export interface EngineConfig {
  readonly time: BalanceConfig['time']
  readonly stats: BalanceConfig['stats']
  readonly actions: BalanceConfig['actions']
  /** Whole in-game dollars a new player starts with. */
  readonly startCash: number
}

export const engineConfig: EngineConfig = {
  time: balanceJson.time,
  stats: balanceJson.stats,
  actions: balanceJson.actions,
  startCash: balanceJson.start.cash,
}
