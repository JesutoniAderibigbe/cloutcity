/**
 * The balance numbers the engine runs on. Engine functions take an EngineConfig argument, so
 * tests can pass their own; the game passes `engineConfig`, built from data/config/balance.json
 * (validated by BalanceConfigSchema in src/lib/data/data.test.ts).
 *
 * The JSON (balance and the item catalog) is read directly rather than through src/lib/data/config.ts so the engine stays off
 * classic zod and out of the shell JS budget (src/lib/client-imports.test.ts).
 */
import balanceJson from '@data/config/balance.json'
import itemsJson from '@data/items/items.json'
import type { BalanceConfig } from '@/lib/data/schemas/config'
import { catalogFromJson, type ItemDef } from './itemCatalog'

/** A housing tier: a key of `rentPerWeek`. */
export type HomeId = keyof BalanceConfig['rentPerWeek']
/** A job: a key of `jobs.hourlyWage`. */
export type JobId = keyof BalanceConfig['jobs']['hourlyWage']

export interface EngineConfig {
  readonly time: BalanceConfig['time']
  readonly stats: BalanceConfig['stats']
  readonly actions: BalanceConfig['actions']
  readonly jobs: BalanceConfig['jobs']
  /** Whole dollars per rent week, by home. */
  readonly rentPerWeek: BalanceConfig['rentPerWeek']
  readonly rent: BalanceConfig['rent']
  readonly clout: BalanceConfig['clout']
  /** Shop, resale and gift-stack rules, plus the cash item catalog (data/items/items.json). */
  readonly items: BalanceConfig['items'] & { readonly catalog: readonly ItemDef[] }
  /** Whole in-game dollars a new player starts with. */
  readonly startCash: number
  /** The home a new player starts in. */
  readonly startHome: HomeId
}

export function isHomeId(id: unknown, config: EngineConfig): id is HomeId {
  return typeof id === 'string' && Object.hasOwn(config.rentPerWeek, id)
}

const rentPerWeek: BalanceConfig['rentPerWeek'] = balanceJson.rentPerWeek

function startHome(id: string): HomeId {
  if (!Object.hasOwn(rentPerWeek, id)) {
    throw new Error(`config/balance.json: start.home "${id}" is not a key of rentPerWeek`)
  }
  return id as HomeId
}

export const engineConfig: EngineConfig = {
  time: balanceJson.time,
  stats: balanceJson.stats,
  actions: balanceJson.actions,
  jobs: balanceJson.jobs,
  rentPerWeek,
  rent: balanceJson.rent,
  clout: balanceJson.clout,
  items: { ...balanceJson.items, catalog: catalogFromJson(itemsJson.items) },
  startCash: balanceJson.start.cash,
  startHome: startHome(balanceJson.start.home),
}
