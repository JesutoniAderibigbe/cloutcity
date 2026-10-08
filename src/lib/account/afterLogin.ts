/**
 * Where a player goes after logging in (DEC-62): once cloud sync has settled the account's game
 * on this device (restored, or a conflict the player must settle first), straight to their room;
 * an account that never made its character goes to the creator first. An account's game that is
 * past its start never sees the first-run tour this device may have queued for the empty game it
 * found here before logging in.
 *
 * Loaded with the log-in screen (lazy), never the shell.
 */
import { engineConfig } from '@/engine/config'
import { openCreator } from '@/state/creatorOpen'
import { openHudPanel } from '@/state/hudPanel'
import { openRoomAfterCreator } from '@/state/onboardingFlow'
import { gameStore } from '@/state/store'
import { syncStatusStore, type SyncStatus } from '@/state/syncStatus'
import { isFreshStart, tourStore } from '@/state/tour'
import tourJson from '@data/config/tour.json'

/** Sync statuses after which this device's game is the account's (or the player must pick). */
const SETTLED: ReadonlySet<SyncStatus> = new Set([
  'synced',
  'conflict',
  'update',
  'behind',
  'paused',
  'offline',
])

/** How long to wait for the account's game before going on with what this device has. */
export const AFTER_LOGIN_WAIT_MS = 15_000

/** What to open once the account's game is here. Pure, for tests. */
export function afterLoginDestination(
  status: SyncStatus,
  creatorDone: boolean,
): 'cloud' | 'creator' | 'home' {
  if (status === 'conflict') return 'cloud'
  return creatorDone ? 'home' : 'creator'
}

/** Routes the player once sync settles (or after AFTER_LOGIN_WAIT_MS). Returns a way to stop. */
export function routeAfterLogin(waitMs: number = AFTER_LOGIN_WAIT_MS): () => void {
  let done = false
  const go = () => {
    if (done) return
    done = true
    unsubscribe()
    clearTimeout(timer)
    const game = gameStore.getState()
    if (
      !isFreshStart(game, engineConfig, tourJson) &&
      tourStore.getState().record?.status !== 'done'
    ) {
      tourStore.setState({ record: { status: 'done' } })
    }
    const destination = afterLoginDestination(
      syncStatusStore.getState().status,
      game.creator.completedAt !== null,
    )
    if (destination === 'creator') {
      openRoomAfterCreator()
      openCreator()
    } else {
      openHudPanel(destination)
    }
  }
  const unsubscribe = syncStatusStore.subscribe((state) => {
    if (SETTLED.has(state.status)) go()
  })
  const timer = setTimeout(go, waitMs)
  if (SETTLED.has(syncStatusStore.getState().status)) go()
  return () => {
    done = true
    unsubscribe()
    clearTimeout(timer)
  }
}
