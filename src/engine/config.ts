/**
 * The balance numbers the engine runs on. Engine functions take an EngineConfig argument, so
 * tests can pass their own; the game passes `engineConfig`, built from data/config/balance.json
 * (validated by BalanceConfigSchema in src/lib/data/data.test.ts).
 *
 * The JSON (balance, the item catalog, data/events/events.json validated by EventsFileSchema,
 * and the landmark and venue lists) is read directly rather than through src/lib/data/config.ts
 * so the engine stays off classic zod and out of the shell JS budget
 * (src/lib/client-imports.test.ts).
 */
import balanceJson from '@data/config/balance.json'
import eventsJson from '@data/events/events.json'
import itemsJson from '@data/items/items.json'
import landmarksJson from '@data/landmarks/landmarks.json'
import venuesJson from '@data/venues/venues.json'
import type { BalanceConfig, BoroughAccessRule } from '@/lib/data/schemas/config'
import type { Borough, GameEvent, LocationCategory } from '@/lib/data/schemas/content'
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
  /** Move-in costs (src/engine/housing.ts). */
  readonly housing: BalanceConfig['housing']
  /** Food range and the subway fare, in whole dollars. */
  readonly costs: BalanceConfig['costs']
  readonly clout: BalanceConfig['clout']
  /** Shop, resale and gift-stack rules, plus the cash item catalog (data/items/items.json). */
  readonly items: BalanceConfig['items'] & { readonly catalog: readonly ItemDef[] }
  /** Who may enter each borough (open, a clout level, or expanding soon). */
  readonly boroughs: BalanceConfig['boroughs']
  /** Whole in-game dollars a new player starts with. */
  readonly startCash: number
  /** The home a new player starts in. */
  readonly startHome: HomeId
  /** Place actions, club doors, landmark visits and flex multipliers (src/engine/placeActions.ts). */
  readonly place: BalanceConfig['place']
  /** Event tuning plus the event catalog (data/events, validated by EventsFileSchema). */
  readonly events: BalanceConfig['events'] & { readonly catalog: readonly GameEvent[] }
  /**
   * The category of every known place (landmark category or venue type), by id. The engine
   * judges place rules (memorials, government buildings) on this, never on what a caller says.
   */
  readonly places: ReadonlyMap<string, LocationCategory>
}

/**
 * Built from whatever landmarks and venues the data holds (validated by LandmarksFileSchema and
 * VenuesFileSchema in data.test.ts), so new or renamed places need no code change.
 */
export function placeCategories(
  landmarks: readonly { readonly id: string; readonly category: string }[],
  venues: readonly { readonly id: string; readonly type: string }[],
): ReadonlyMap<string, LocationCategory> {
  return new Map<string, LocationCategory>([
    ...landmarks.map((place) => [place.id, place.category as LocationCategory] as const),
    ...venues.map((place) => [place.id, place.type as LocationCategory] as const),
  ])
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

/**
 * JSON imports widen `access` to string, so the rules are narrowed here. A bad rule throws at
 * load (fail fast); BalanceConfigSchema checks the same file in data.test.ts.
 */
function boroughRules(json: Readonly<Record<Borough, { access: string; level?: string }>>) {
  const rule = (id: Borough): BoroughAccessRule => {
    const entry = json[id]
    if (entry.access === 'open' || entry.access === 'expanding-soon')
      return { access: entry.access }
    if (entry.access === 'clout' && entry.level !== undefined) {
      return { access: 'clout', level: entry.level }
    }
    throw new Error(`config/balance.json: boroughs.${id} has an invalid access rule`)
  }
  return {
    queens: rule('queens'),
    brooklyn: rule('brooklyn'),
    manhattan: rule('manhattan'),
    bronx: rule('bronx'),
    'staten-island': rule('staten-island'),
  } satisfies BalanceConfig['boroughs']
}

export const engineConfig: EngineConfig = {
  time: balanceJson.time,
  stats: balanceJson.stats,
  actions: balanceJson.actions,
  jobs: balanceJson.jobs,
  rentPerWeek,
  rent: balanceJson.rent,
  housing: balanceJson.housing,
  costs: balanceJson.costs,
  clout: balanceJson.clout,
  items: { ...balanceJson.items, catalog: catalogFromJson(itemsJson.items) },
  boroughs: boroughRules(balanceJson.boroughs),
  startCash: balanceJson.start.cash,
  startHome: startHome(balanceJson.start.home),
  // JSON imports widen string unions to `string`; data.test.ts validates the file itself.
  events: { ...balanceJson.events, catalog: eventsJson.events as readonly GameEvent[] },
  places: placeCategories(landmarksJson.landmarks, venuesJson.venues),
  place: balanceJson.place,
}
