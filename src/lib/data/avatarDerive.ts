/**
 * Derives data/avatar/engine.derived.json (the compact tables the engine reads on the playable
 * path) from the S16a source files. Tests and the schema use it; the game never does.
 * No imports beyond avatarIds.ts, so Node can load it from scripts/.
 */
import {
  ROLL_KINDS,
  type AvatarEngineTables,
  type AvatarIdTables,
  type LookField,
  type RollKind,
  type RollScope,
  type TraitEffectKind,
} from './avatarIds'

interface Option {
  readonly id: string
}

/** The option lists of data/avatar/options.json that a look is checked against. */
export interface LookOptionLists {
  readonly bodies: readonly Option[]
  readonly skinTones: readonly Option[]
  readonly hairStyles: readonly Option[]
  readonly hairColors: readonly Option[]
  readonly facialHair: readonly Option[]
  readonly headwear: readonly Option[]
  readonly eyewear: readonly Option[]
  readonly ears: readonly Option[]
  readonly outfits: readonly (Option & {
    readonly variants: Readonly<Partial<Record<string, string>>>
  })[]
  readonly garmentColors: readonly Option[]
  readonly shoeColors: readonly string[]
  readonly heights: readonly Option[]
}

/** The id tables of look options. */
export function deriveAvatarIds(
  options: LookOptionLists & {
    readonly defaults: Readonly<Record<LookField, string>>
    readonly random: AvatarIdTables['random']
  },
  /** data/avatar/compat.json (S16b); left out, nothing is aliased or pending. */
  compat: { readonly legacy: AvatarIdTables['legacy'] } = { legacy: { ids: {}, body: {} } },
): AvatarIdTables {
  const ids = (list: readonly Option[]) => list.map((option) => option.id)
  const garment = ids(options.garmentColors)
  const outfitsByBody: Record<string, readonly string[]> = {}
  for (const body of options.bodies) {
    outfitsByBody[body.id] = options.outfits
      .filter((outfit) => outfit.variants[body.id] !== undefined)
      .map((outfit) => outfit.id)
  }
  return {
    look: {
      body: ids(options.bodies),
      skin: ids(options.skinTones),
      hairStyle: ids(options.hairStyles),
      hairColor: ids(options.hairColors),
      facialHair: ids(options.facialHair),
      headwear: ids(options.headwear),
      eyewear: ids(options.eyewear),
      ears: ids(options.ears),
      outfit: ids(options.outfits),
      top: garment,
      bottom: garment,
      shoes: options.shoeColors,
      height: ids(options.heights),
    },
    outfitsByBody,
    legacy: compat.legacy,
    defaults: options.defaults,
    random: options.random,
  }
}

/** The engine tables from the S16a source files (see `AvatarEngineTables`). */
export function deriveAvatarEngineTables(sources: {
  readonly options: Parameters<typeof deriveAvatarIds>[0]
  readonly compat: NonNullable<Parameters<typeof deriveAvatarIds>[1]>
  readonly traits: {
    readonly maxModifierPct: number
    readonly traits: readonly {
      readonly id: string
      readonly effects: readonly { readonly kind: TraitEffectKind; readonly pct: number }[]
    }[]
  }
  readonly creator: {
    readonly offerAfterActions: number
    readonly waitForTour: boolean
    readonly changeCooldownGameDays: number
    readonly steps: readonly { readonly id: string; readonly pick?: number }[]
    readonly rolls: Readonly<Partial<Record<RollKind, { readonly scope: RollScope }>>>
  }
  readonly neighborhoods: readonly { readonly id: string }[]
}): AvatarEngineTables {
  const { options, traits, creator } = sources
  const rolls: Partial<Record<RollKind, RollScope>> = {}
  for (const kind of ROLL_KINDS) {
    const rule = creator.rolls[kind]
    if (rule !== undefined) rolls[kind] = rule.scope
  }
  return {
    version: 1,
    avatar: deriveAvatarIds(options, sources.compat),
    traits: {
      maxModifierPct: traits.maxModifierPct,
      pick: creator.steps.find((step) => step.id === 'traits')?.pick ?? 0,
      effects: Object.fromEntries(
        traits.traits.map((trait) => [
          trait.id,
          Object.fromEntries(trait.effects.map((effect) => [effect.kind, effect.pct])),
        ]),
      ),
    },
    creator: {
      offerAfterActions: creator.offerAfterActions,
      waitForTour: creator.waitForTour,
      changeCooldownGameDays: creator.changeCooldownGameDays,
      rolls,
    },
    neighborhoods: sources.neighborhoods.map((entry) => entry.id),
  }
}
