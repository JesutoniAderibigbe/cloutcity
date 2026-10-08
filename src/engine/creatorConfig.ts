/**
 * What the "Make it you" creator and the avatar chunks need beyond the engine's compact tables
 * (S16a): the full look options (models, tokens, names), the traits with their copy keys, the
 * creator's steps and the neighborhoods with their home points. Only lazy code imports this
 * module, so none of it is on the playable path (PERF-6); src/engine/config.ts reads the
 * compact data/avatar/engine.derived.json instead.
 */
import avatarOptionsJson from '@data/avatar/options.json'
import traitsJson from '@data/avatar/traits.json'
import creatorJson from '@data/config/creator.json'
import neighborhoodsJson from '@data/homes/neighborhoods.json'
import {
  ATTACHMENT_KINDS,
  CREATOR_STEP_IDS,
  ROLL_KINDS,
  ROLL_SCOPES,
  TRAIT_EFFECT_KINDS,
} from '@/lib/data/avatarIds'
import type { AvatarOptions, TraitsFile } from '@/lib/data/schemas/avatar'
import type { CreatorConfig } from '@/lib/data/schemas/creator'
import { engineConfig, isHomeId, oneOf, type HomeId } from './config'

/** A start neighborhood: where its startable homes stand. */
export interface NeighborhoodDef {
  readonly id: string
  readonly home: { readonly lat: number; readonly lng: number }
  readonly homes: readonly HomeId[]
}

export interface CreatorEngineConfig {
  /** data/avatar/options.json. */
  readonly options: AvatarOptions
  /** data/avatar/traits.json. */
  readonly traits: TraitsFile
  /** data/config/creator.json. */
  readonly creator: CreatorConfig
  /** data/homes/neighborhoods.json, as the engine needs it. */
  readonly neighborhoods: readonly NeighborhoodDef[]
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
function neighborhoodRules(json: typeof neighborhoodsJson): NeighborhoodDef[] {
  return json.neighborhoods.map((entry) => ({
    id: entry.id,
    home: entry.home,
    homes: entry.homes.map((home) => {
      if (!isHomeId(home, engineConfig)) {
        throw new Error(`homes/neighborhoods.json: ${entry.id} names an unknown home "${home}"`)
      }
      return home as HomeId
    }),
  }))
}

export const creatorConfig: CreatorEngineConfig = {
  options: avatarRules(avatarOptionsJson),
  traits: traitRules(traitsJson),
  creator: creatorRules(creatorJson),
  neighborhoods: neighborhoodRules(neighborhoodsJson),
}
