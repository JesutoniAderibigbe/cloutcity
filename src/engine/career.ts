/**
 * Career paths (S16a, DEC-20): the creator's "Dream". The path sets the goal line copy and one
 * bonus from balance.json `career.paths` (TUNE-11 placeholders):
 *
 * - `clout-pct`: positive flex or event clout gains are multiplied (`careerPct`), event clout
 *   except events tagged with any of `exceptEventTags` (nightlife is flavour only, DEC-12). The
 *   schema allows only `flex` and `event`: club, grant, premium and item clout never get a bonus.
 * - `home-clout-pct`: the home score counts more before the home clout cap (src/engine/home.ts).
 * - `resale-pts`: every resale pays that many more percentage points of the item's price
 *   (src/engine/items.ts `resaleValue`); the balance schema keeps it below any discounted price.
 *
 * A chosen path can change again only after `creator.changeCooldownGameDays` game days (traits
 * share the cooldown, src/engine/traits.ts). Choosing the same path again changes nothing.
 */
import { CAREER_PATHS, type CareerPathId } from '@/lib/data/avatarIds'
import type { CloutSourceId } from '@/lib/data/cloutSources'
import { minutesPerDay } from './clock'
import { settleLevel, type LevelUp } from './clout'
import type { EngineConfig } from './config'
import type { GameSnapshot, PlayerState } from './game'

export { CAREER_PATHS, type CareerPathId }

export function isCareerPath(value: unknown): value is CareerPathId {
  return typeof value === 'string' && (CAREER_PATHS as readonly string[]).includes(value)
}

/** The personal-clock minute a choice made at `changedAt` can change again, or null if now. */
export function changeAvailableAt(
  changedAt: number | null,
  nowMinute: number,
  config: EngineConfig,
): number | null {
  if (changedAt === null) return null
  const at = changedAt + config.creator.changeCooldownGameDays * minutesPerDay(config)
  return nowMinute >= at ? null : at
}

/** What a clout gain is, for the career bonus: its source and, for an event, the event. */
export interface CloutGainContext {
  readonly source: CloutSourceId
  readonly eventId?: string
}

/**
 * The whole percent the player's career path multiplies a positive gain by (100 when it adds
 * nothing).
 */
export function careerPct(
  player: Pick<PlayerState, 'careerPath'>,
  gain: CloutGainContext,
  config: EngineConfig,
): number {
  if (player.careerPath === null) return 100
  const { bonus } = config.career.paths[player.careerPath]
  if (bonus.kind !== 'clout-pct' || bonus.source !== gain.source) return 100
  if (gain.source === 'event' && bonus.exceptEventTags !== undefined) {
    const event = config.events.catalog.find((entry) => entry.id === gain.eventId)
    // An unknown event gets no bonus: the bonus must never land where it cannot be checked.
    if (event === undefined) return 100
    if (event.tags.some((tag) => bonus.exceptEventTags?.includes(tag) === true)) return 100
  }
  return 100 + bonus.pct
}

/** The highest percent any path gives `source` (for the clout ceilings S18c falls back on). */
export function topCareerPct(source: CloutSourceId, config: EngineConfig): number {
  return Math.max(
    100,
    ...Object.values(config.career.paths).map((path) =>
      path.bonus.kind === 'clout-pct' && path.bonus.source === source ? 100 + path.bonus.pct : 100,
    ),
  )
}

/** The whole percent the home score counts at for this player (100 without a home bonus). */
export function homeScorePct(player: Pick<PlayerState, 'careerPath'>, config: EngineConfig) {
  if (player.careerPath === null) return 100
  const { bonus } = config.career.paths[player.careerPath]
  return bonus.kind === 'home-clout-pct' ? 100 + bonus.pct : 100
}

/** Extra percentage points of the price every resale pays this player (0 without the bonus). */
export function resaleBonusPts(player: Pick<PlayerState, 'careerPath'>, config: EngineConfig) {
  if (player.careerPath === null) return 0
  const { bonus } = config.career.paths[player.careerPath]
  return bonus.kind === 'resale-pts' ? bonus.pts : 0
}

export type CareerError =
  | { readonly code: 'UNKNOWN_CAREER'; readonly careerPath: string }
  | { readonly code: 'CHANGE_COOLDOWN'; readonly availableAt: number }

export type CareerResult =
  | {
      readonly ok: true
      readonly snapshot: GameSnapshot
      readonly changed: boolean
      /** An artist/DJ's home bonus can lift the level at once. */
      readonly levelUp: LevelUp | null
    }
  | { readonly ok: false; readonly error: CareerError }

/** Chooses (or changes) the Dream; see the module comment for the cooldown. */
export function chooseCareer(
  snapshot: GameSnapshot,
  careerPath: string,
  config: EngineConfig,
): CareerResult {
  if (!isCareerPath(careerPath)) {
    return { ok: false, error: { code: 'UNKNOWN_CAREER', careerPath } }
  }
  const { player } = snapshot
  if (player.careerPath === careerPath) {
    return { ok: true, snapshot, changed: false, levelUp: null }
  }
  const now = snapshot.clock.minute
  const availableAt = changeAvailableAt(player.careerChangedAt, now, config)
  if (availableAt !== null) return { ok: false, error: { code: 'CHANGE_COOLDOWN', availableAt } }
  const settled = settleLevel({ ...player, careerPath, careerChangedAt: now }, now, 'home', config)
  return {
    ok: true,
    snapshot: { ...snapshot, player: settled.player },
    changed: true,
    levelUp: settled.levelUp,
  }
}
