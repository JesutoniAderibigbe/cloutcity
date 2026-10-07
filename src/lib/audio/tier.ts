/**
 * The audio quality tier (S05b). Quality tiers arrive with S04b's tier picker; until then every
 * device gets `mid`, except that a data-saver request forces `low` (CLAUDE.md "Quality tiers").
 */
import type { AudioTier } from './config'

interface NetworkInformationLike {
  readonly saveData?: boolean
}

export function audioTier(
  navigatorRef: Navigator | undefined,
  matchMediaRef: ((query: string) => { matches: boolean }) | undefined,
): AudioTier {
  const connection = (
    navigatorRef as (Navigator & { connection?: NetworkInformationLike }) | undefined
  )?.connection
  if (connection?.saveData === true) return 'low'
  if (matchMediaRef?.('(prefers-reduced-data: reduce)').matches === true) return 'low'
  return 'mid'
}
