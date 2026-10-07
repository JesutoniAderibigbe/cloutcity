/**
 * Helpers for engine tests (not used by the game). Clout is derived from the ledger, so tests
 * that need a player at some clout build the ledger through these instead of setting a number.
 */
import { cloutLevel, itemClout, legacyCloutState } from './clout'
import type { EngineConfig } from './config'
import type { GameSnapshot, PlayerState } from './game'

/**
 * `player` holding `total` clout: earned clout becomes one folded legacy entry (less what their
 * wearables already carry), and the level it lands on counts as reached (no level-up for it).
 */
export function playerWithClout<P extends PlayerState>(
  player: P,
  total: number,
  config: EngineConfig,
): P {
  const earned = Math.max(0, total - itemClout(player, config))
  const clout = {
    ...legacyCloutState(earned, cloutLevel(total, config).index),
    firstPaycheckPaid: player.clout.firstPaycheckPaid,
  }
  return { ...player, clout }
}

/** `snapshot` with its player holding `total` clout (see `playerWithClout`). */
export function withClout(
  snapshot: GameSnapshot,
  total: number,
  config: EngineConfig,
): GameSnapshot {
  return { ...snapshot, player: playerWithClout(snapshot.player, total, config) }
}
