/**
 * Player-facing text for the "Make it you" creator (S16a), built only from the data that drives
 * the options (GR-10): option and colour names from data/avatar/options.json, trait effect lines
 * from each trait's `effects`, career lines from balance.json `career.paths` (keys `career.<camelId>.name|goal|bonus`) and neighborhood
 * names from data/homes/neighborhoods.json. No number is ever written into the copy itself.
 */
import { minutesPerDay } from '@/engine/clock'
import { engineConfig, type EngineConfig } from '@/engine/config'
import { creatorConfig, type CreatorEngineConfig } from '@/engine/creatorConfig'
import type { TraitEffectKind } from '@/lib/data/avatarIds'
import type { CareerPathId } from '@/lib/data/schemas/config'
import { copy as activeCopy, isCopyKey, type CopyFn, type CopyKey } from './copy'
import { formatCount } from './format'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/avatar'
import '@/lib/copy/ns/career'
import '@/lib/copy/ns/colors'
import '@/lib/copy/ns/creator'
import '@/lib/copy/ns/neighborhoods'

export interface CreatorCopyOptions {
  readonly copy?: CopyFn
  readonly config?: EngineConfig
  readonly creator?: CreatorEngineConfig
}

function requireKey(key: string, what: string): CopyKey {
  if (!isCopyKey(key)) throw new Error(`No copy key "${key}" for ${what}`)
  return key
}

/** `energy-cost` → `energyCost`, the copy-key segment for a kebab-case id. */
function camelSegment(id: string): string {
  return id.replace(/-([a-z0-9])/g, (_, next: string) => next.toUpperCase())
}

/** The human name behind any option's or swatch's `nameKey` ("Deep warm", "Moss green"). */
export function optionName(nameKey: string, { copy = activeCopy }: CreatorCopyOptions = {}) {
  return copy(requireKey(nameKey, 'a look option'))
}

function trait(traitId: string, config: CreatorEngineConfig) {
  const found = config.traits.traits.find((entry) => entry.id === traitId)
  if (found === undefined) throw new Error(`Unknown trait "${traitId}"`)
  return found
}

/** "Early bird". */
export function traitName(traitId: string, options: CreatorCopyOptions = {}): string {
  const { copy = activeCopy, creator = creatorConfig } = options
  return copy(requireKey(trait(traitId, creator).nameKey, `trait ${traitId}`))
}

/** "Up before the bodega cat." */
export function traitFlavor(traitId: string, options: CreatorCopyOptions = {}): string {
  const { copy = activeCopy, creator = creatorConfig } = options
  return copy(requireKey(trait(traitId, creator).flavorKey, `trait ${traitId}`))
}

/** The copy key of one effect line: `creator.effect.<kind><More|Less>`. */
export function traitEffectKey(kind: TraitEffectKind, pct: number): string {
  return `creator.effect.${camelSegment(kind)}${pct > 0 ? 'More' : 'Less'}`
}

/** One line per effect of the trait, in data order: "Actions cost 10% less energy". */
export function traitEffectLines(traitId: string, options: CreatorCopyOptions = {}): string[] {
  const { copy = activeCopy, creator = creatorConfig } = options
  return trait(traitId, creator).effects.map((effect) =>
    copy(requireKey(traitEffectKey(effect.kind, effect.pct), `trait ${traitId}`), {
      pct: formatCount(Math.abs(effect.pct)),
    }),
  )
}

/** "Streamer". */
export function careerName(path: CareerPathId, options: CreatorCopyOptions = {}): string {
  const { copy = activeCopy } = options
  return copy(requireKey(`career.${camelSegment(path)}.name`, `career ${path}`))
}

/** The goal line while the path is chosen: "Make it in New York as a streamer". */
export function careerGoalLine(path: CareerPathId, options: CreatorCopyOptions = {}): string {
  const { copy = activeCopy } = options
  return copy(requireKey(`career.${camelSegment(path)}.goal`, `career ${path}`))
}

/** The path's bonus, from its numbers: "Flex clout +20%". */
export function careerBonusLine(path: CareerPathId, options: CreatorCopyOptions = {}): string {
  const { copy = activeCopy, config = engineConfig } = options
  const { bonus } = config.career.paths[path]
  const bonusKey = `career.${camelSegment(path)}.bonus`
  const vars: Readonly<Record<string, string>> =
    bonus.kind === 'resale-pts' ? { pts: formatCount(bonus.pts) } : { pct: formatCount(bonus.pct) }
  return copy(requireKey(bonusKey, `career ${path}`), vars)
}

/** "Jackson Heights". */
export function neighborhoodName(id: string, { copy = activeCopy }: CreatorCopyOptions = {}) {
  return copy(requireKey(`neighborhoods.${camelSegment(id)}.name`, `neighborhood ${id}`))
}

/**
 * When a changed trait pair or Dream can be saved again (the change cooldown): "You can change
 * this again in 3 game days", in whole game days rounded up.
 */
export function cooldownLine(
  availableAt: number,
  nowMinute: number,
  options: CreatorCopyOptions = {},
): string {
  const { copy = activeCopy, config = engineConfig } = options
  const days = Math.max(1, Math.ceil((availableAt - nowMinute) / minutesPerDay(config)))
  return copy(days === 1 ? 'creator.cooldownOne' : 'creator.cooldownMany', {
    days: formatCount(days),
  })
}
