/**
 * The balance numbers the engine runs on. Engine functions take an EngineConfig argument, so
 * tests can pass their own; the game passes `engineConfig`, built from data/config/balance.json
 * (validated by BalanceConfigSchema in src/lib/data/data.test.ts).
 *
 * The JSON (balance, progression (validated by createProgressionConfigSchema), the item catalog, data/events/events.json validated by EventsFileSchema,
 * and the landmark and venue lists) is read directly rather than through src/lib/data/config.ts
 * so the engine stays off classic zod and out of the shell JS budget
 * (src/lib/client-imports.test.ts).
 */
import avatarOptionsJson from '@data/avatar/options.json'
import traitsJson from '@data/avatar/traits.json'
import balanceJson from '@data/config/balance.json'
import creatorJson from '@data/config/creator.json'
import progressionJson from '@data/config/progression.json'
import eventsJson from '@data/events/events.json'
import interiorsJson from '@data/homes/interiors.json'
import neighborhoodsJson from '@data/homes/neighborhoods.json'
import itemsJson from '@data/items/items.json'
import landmarksJson from '@data/landmarks/landmarks.json'
import venuesJson from '@data/venues/venues.json'
import { STYLED_SOURCES, type StyledSourceId } from '@/lib/data/cloutSources'
import { GOAL_FACTS, PRESTIGE_PARTS, type GoalFact, type PrestigePart } from '@/lib/data/goalFacts'
import {
  ATTACHMENT_KINDS,
  CREATOR_STEP_IDS,
  ROLL_KINDS,
  ROLL_SCOPES,
  TRAIT_EFFECT_KINDS,
} from '@/lib/data/avatarIds'
import type { AvatarOptions, TraitsFile } from '@/lib/data/schemas/avatar'
import type {
  BalanceConfig,
  BoroughAccessRule,
  CareerConfig,
  ProgressionConfig,
} from '@/lib/data/schemas/config'
import type { Borough, GameEvent, LocationCategory } from '@/lib/data/schemas/content'
import type { CreatorConfig } from '@/lib/data/schemas/creator'
import { DECOR_FITS, catalogFromJson, type DecorFit, type ItemDef } from './itemCatalog'

/** A housing tier: a key of `rentPerWeek`. */
export type HomeId = keyof BalanceConfig['rentPerWeek']
/** A job: a key of `jobs.hourlyWage`. */
export type JobId = keyof BalanceConfig['jobs']['hourlyWage']

/** A decor slot as the engine sees it (data/homes/interiors.json; the rest is for the scene). */
export interface SlotDef {
  readonly id: string
  readonly kind: DecorFit
}

/** A goal (data/config/progression.json, src/engine/goals.ts). */
export type GoalDef = ProgressionConfig['goals'][number]

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
  /**
   * Home scores, the home clout cap and the move log's length (src/engine/home.ts), plus each
   * home's decor slots, in data/homes/interiors.json order.
   */
  readonly home: BalanceConfig['home'] & {
    readonly slots: Readonly<Record<HomeId, readonly SlotDef[]>>
  }
  /** Food range and the subway fare, in whole dollars. */
  readonly costs: BalanceConfig['costs']
  /** Levels, flex, style, the ledger and the premium cap (src/engine/clout.ts). */
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
  /** Goals and their rewards (src/engine/goals.ts), in display order. */
  readonly goals: readonly GoalDef[]
  /** How grants are capped and how many records the save keeps (src/engine/grants.ts). */
  readonly grants: ProgressionConfig['grants']
  /** What prestige requires, earns, resets and keeps (src/engine/prestige.ts). */
  readonly prestige: ProgressionConfig['prestige']
  /** Look options (data/avatar/options.json; src/engine/appearance.ts). */
  readonly avatar: AvatarOptions
  /** Traits and the cap on their summed modifiers (data/avatar/traits.json; src/engine/traits.ts). */
  readonly traits: TraitsFile
  /** Career paths and their bonuses (balance.json `career`; src/engine/career.ts). */
  readonly career: CareerConfig
  /** The creator's offer, steps, rolls and change cooldown (data/config/creator.json). */
  readonly creator: CreatorConfig
  /** Start neighborhoods (data/homes/neighborhoods.json; src/engine/neighborhoods.ts). */
  readonly neighborhoods: readonly NeighborhoodDef[]
}

/** A start neighborhood as the engine sees it (the copy and geo checks are the data tests'). */
export interface NeighborhoodDef {
  readonly id: string
  readonly home: { readonly lat: number; readonly lng: number }
  readonly homes: readonly HomeId[]
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

/**
 * JSON imports widen `style.appliesTo` to string[], so it is narrowed here; a source the
 * style may not multiply throws at load (fail fast). CloutConfigSchema checks the same file.
 */
function cloutRules(json: typeof balanceJson.clout): BalanceConfig['clout'] {
  const isStyled = (id: string): id is StyledSourceId =>
    (STYLED_SOURCES as readonly string[]).includes(id)
  const appliesTo = json.style.appliesTo.map((id) => {
    if (!isStyled(id)) throw new Error(`config/balance.json: clout.style.appliesTo has "${id}"`)
    return id
  })
  return { ...json, style: { ...json.style, appliesTo } }
}

/**
 * JSON imports widen string unions (`fact`, prestige parts) and literals (`victory`, `badge`), so
 * the progression rules are narrowed here; anything else throws at load (fail fast).
 * createProgressionConfigSchema checks the same file in data.test.ts.
 */
function progressionRules(json: typeof progressionJson) {
  const where = 'config/progression.json'
  const fact = (id: string, value: string): GoalFact => {
    if (!(GOAL_FACTS as readonly string[]).includes(value)) {
      throw new Error(`${where}: goal "${id}" has an unknown fact "${value}"`)
    }
    return value as GoalFact
  }
  const parts = (list: readonly string[]): PrestigePart[] =>
    list.map((part) => {
      if (!(PRESTIGE_PARTS as readonly string[]).includes(part)) {
        throw new Error(`${where}: unknown prestige part "${part}"`)
      }
      return part as PrestigePart
    })
  const goals: GoalDef[] = json.goals.map((raw) => {
    const entry = raw as {
      id: string
      fact: string
      level?: string
      available?: boolean
      victory?: boolean
      reward: { cash?: number; clout?: number; badge?: boolean }
    }
    const { cash, clout, badge } = entry.reward
    if (entry.victory === false || badge === false) {
      throw new Error(`${where}: goal "${entry.id}" sets victory or badge to false`)
    }
    return {
      id: entry.id,
      fact: fact(entry.id, entry.fact),
      ...(entry.level === undefined ? {} : { level: entry.level }),
      ...(entry.available === undefined ? {} : { available: entry.available }),
      ...(entry.victory === true ? { victory: true as const } : {}),
      reward: {
        ...(cash === undefined ? {} : { cash }),
        ...(clout === undefined ? {} : { clout }),
        ...(badge === true ? { badge: true as const } : {}),
      },
    }
  })
  return {
    goals,
    grants: json.grants,
    prestige: {
      ...json.prestige,
      resets: parts(json.prestige.resets),
      keeps: parts(json.prestige.keeps),
    },
  }
}

const progression = progressionRules(progressionJson)

/**
 * Each home's decor slots from data/homes/interiors.json (validated by HomeInteriorsFileSchema in
 * data.test.ts). JSON imports widen `kind` to string, so it is narrowed here; anything else
 * throws at load (fail fast).
 */
function homeSlots(json: typeof interiorsJson): Readonly<Record<HomeId, readonly SlotDef[]>> {
  const slots = (id: HomeId): SlotDef[] =>
    json.homes[id].slots.map((slot) => {
      if (!(DECOR_FITS as readonly string[]).includes(slot.kind)) {
        throw new Error(`homes/interiors.json: ${id} slot "${slot.id}" has an unknown kind`)
      }
      return { id: slot.id, kind: slot.kind as DecorFit }
    })
  return {
    'queens-room': slots('queens-room'),
    'brooklyn-1br': slots('brooklyn-1br'),
    'manhattan-loft': slots('manhattan-loft'),
  }
}

function oneOf<T extends string>(value: unknown, options: readonly T[], where: string): T {
  if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) {
    throw new Error(`${where}: "${String(value)}" is not one of ${options.join(', ')}`)
  }
  return value as T
}

/**
 * JSON imports widen enums to string, so the look options are narrowed here; anything else
 * throws at load (fail fast). AvatarOptionsSchema checks the same file in the data tests.
 */
function avatarRules(json: typeof avatarOptionsJson): AvatarOptions {
  const where = 'avatar/options.json'
  return {
    ...json,
    version: 1,
    attachments: {
      max: json.attachments.max,
      priority: json.attachments.priority.map((kind) =>
        oneOf(kind, ATTACHMENT_KINDS, `${where} attachments.priority`),
      ),
    },
  }
}

/** Trait effect kinds narrowed (see `avatarRules`); TraitsFileSchema checks the file. */
function traitRules(json: typeof traitsJson): TraitsFile {
  return {
    ...json,
    version: 1,
    traits: json.traits.map((trait) => ({
      ...trait,
      effects: trait.effects.map((effect) => ({
        kind: oneOf(effect.kind, TRAIT_EFFECT_KINDS, `avatar/traits.json ${trait.id}`),
        pct: effect.pct,
      })),
    })),
  }
}

/** Career bonuses narrowed (see `avatarRules`); CareerConfigSchema checks balance.json. */
function careerRules(json: typeof balanceJson.career): CareerConfig {
  const where = 'config/balance.json career'
  const path = (raw: (typeof json.paths)[keyof typeof json.paths]) => {
    const bonus = raw.bonus as Record<string, unknown>
    const kind = oneOf(bonus.kind, ['clout-pct', 'home-clout-pct', 'resale-pts'] as const, where)
    const whole = (value: unknown) => {
      if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        throw new Error(`${where}: a bonus needs a whole positive amount`)
      }
      return value
    }
    const narrowed: CareerConfig['paths']['influencer']['bonus'] =
      kind === 'clout-pct'
        ? {
            kind,
            source: oneOf(bonus.source, ['flex', 'event'] as const, where),
            pct: whole(bonus.pct),
            ...(Array.isArray(bonus.exceptEventTags)
              ? { exceptEventTags: bonus.exceptEventTags.map(String) }
              : {}),
          }
        : kind === 'home-clout-pct'
          ? { kind, pct: whole(bonus.pct) }
          : { kind, pts: whole(bonus.pts) }
    return { nameKey: raw.nameKey, goalKey: raw.goalKey, bonusKey: raw.bonusKey, bonus: narrowed }
  }
  return {
    paths: {
      influencer: path(json.paths.influencer),
      streamer: path(json.paths.streamer),
      'artist-dj': path(json.paths['artist-dj']),
      'founder-hustler': path(json.paths['founder-hustler']),
    },
  }
}

/** Creator steps and roll scopes narrowed (see `avatarRules`); CreatorConfigSchema checks the file. */
function creatorRules(json: typeof creatorJson): CreatorConfig {
  const where = 'config/creator.json'
  const steps = json.steps.map((raw) => {
    const step = raw as Record<string, unknown>
    const id = oneOf(step.id, CREATOR_STEP_IDS, `${where} steps`)
    const enabled = typeof step.enabled === 'boolean' ? { enabled: step.enabled } : {}
    if (id === 'traits') {
      if (typeof step.pick !== 'number') throw new Error(`${where}: traits needs a pick count`)
      return { id, pick: step.pick, ...enabled }
    }
    if (id === 'neighborhood') return { id, roll: 'neighborhood' as const, ...enabled }
    if (id === 'origin' && step.roll !== undefined) {
      return { id, roll: oneOf(step.roll, ROLL_KINDS, where), ...enabled }
    }
    return { id, ...enabled }
  }) as CreatorConfig['steps']
  const rolls: CreatorConfig['rolls'] = {}
  for (const [kind, rule] of Object.entries(json.rolls)) {
    rolls[oneOf(kind, ROLL_KINDS, `${where} rolls`)] = {
      scope: oneOf(rule.scope, ROLL_SCOPES, `${where} rolls.${kind}`),
    }
  }
  return {
    version: 1,
    offerAfterActions: json.offerAfterActions,
    waitForTour: json.waitForTour,
    steps,
    rolls,
    changeCooldownGameDays: json.changeCooldownGameDays,
  }
}

/** The engine's view of the neighborhoods: ids, home points and startable homes. */
function neighborhoodRules(json: typeof neighborhoodsJson): readonly NeighborhoodDef[] {
  return json.neighborhoods.map((entry) => ({
    id: entry.id,
    home: entry.home,
    homes: entry.homes.map((home) => {
      if (!Object.hasOwn(rentPerWeek, home)) {
        throw new Error(`homes/neighborhoods.json: ${entry.id} names an unknown home "${home}"`)
      }
      return home as HomeId
    }),
  }))
}

/**
 * balance.json `transit` plus the subway fare, for src/engine/transit/config.ts. Built here so
 * the balance file has one importer in the client graph: the bundler then keeps one copy of it
 * instead of copying the JSON into the lazy travel chunk and the boot islands (PERF-3).
 */
export const transitBalance = {
  ...balanceJson.transit,
  subwayFare: balanceJson.costs.subwayFare,
}

export const engineConfig: EngineConfig = {
  time: balanceJson.time,
  stats: balanceJson.stats,
  actions: balanceJson.actions,
  jobs: balanceJson.jobs,
  rentPerWeek,
  rent: balanceJson.rent,
  housing: balanceJson.housing,
  home: { ...balanceJson.home, slots: homeSlots(interiorsJson) },
  costs: balanceJson.costs,
  clout: cloutRules(balanceJson.clout),
  items: { ...balanceJson.items, catalog: catalogFromJson(itemsJson.items) },
  boroughs: boroughRules(balanceJson.boroughs),
  startCash: balanceJson.start.cash,
  startHome: startHome(balanceJson.start.home),
  // JSON imports widen string unions to `string`; data.test.ts validates the file itself.
  events: { ...balanceJson.events, catalog: eventsJson.events as readonly GameEvent[] },
  places: placeCategories(landmarksJson.landmarks, venuesJson.venues),
  place: balanceJson.place,
  goals: progression.goals,
  grants: progression.grants,
  prestige: progression.prestige,
  avatar: avatarRules(avatarOptionsJson),
  traits: traitRules(traitsJson),
  career: careerRules(balanceJson.career),
  creator: creatorRules(creatorJson),
  neighborhoods: neighborhoodRules(neighborhoodsJson),
}
