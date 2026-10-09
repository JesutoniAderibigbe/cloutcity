/**
 * Wires the presence loop (src/realtime/presenceClient.ts) to the game (S42 phase 1): who this
 * device is (the session store: an account announces, a guest only watches, anyone else gets the
 * signed-out view), where the player is (the trip store's spot, "travelling" while a trip
 * animates, the home's borough at home), and the page's visibility. Answers go to the presence
 * store, which the map and the overlay read.
 *
 * Nothing here runs without a Supabase configuration (the default e2e build): `startPresence`
 * answers a no-op stop.
 */
import homesJson from '@data/homes/homes.json'
import realtimeJson from '@data/config/realtime.json'
import { log } from '@/lib/log'
import { supabaseEnv } from '@/lib/supabase/env'
import type { RealtimeConfig } from '@/lib/data/schemas/config'
import { createPresenceClient, type PresenceMode } from '@/realtime/presenceClient'
import type { Announce, PresenceBorough, PresenceTransport } from '@/realtime/types'
import { PRESENCE_BOROUGHS } from '@/realtime/types'
import { guestSessionStore } from '@/state/guestSession'
import { playerHomeStore } from '@/state/playerHome'
import {
  applyPublicSnapshot,
  applySnapshot,
  presenceUnavailable,
  resetPresence,
} from '@/state/presence'
import { tripStore } from '@/state/trip'

const config = realtimeJson.presence as RealtimeConfig['presence']
const homes = (homesJson as { homes: Record<string, { borough: string }> }).homes

const asBorough = (value: string | undefined): PresenceBorough | null =>
  (PRESENCE_BOROUGHS as readonly string[]).includes(value ?? '') ? (value as PresenceBorough) : null

/** Who this device is, from the session store. */
export function presenceMode(status = guestSessionStore.getState().status): PresenceMode {
  if (status === 'permanent') return 'announce'
  if (status === 'anonymous') return 'view'
  return 'public'
}

/**
 * Where the player is, coarse: the place pin (and its borough), home (the home's borough) or
 * travelling (the destination's borough). Null before the save has been read.
 */
export function currentAnnounce(
  boroughOf: ReadonlyMap<string, string>,
  state = tripStore.getState(),
  home = playerHomeStore.getState().home,
): Announce | null {
  const homeBorough = asBorough(home === null ? undefined : homes[home]?.borough)
  if (state.active !== null) {
    const to = state.active.destination
    const borough =
      to.kind === 'place' ? asBorough(boroughOf.get(to.placeId)) : (homeBorough ?? null)
    return borough === null ? null : { spot: 'travelling', place: null, borough }
  }
  const spot = state.spot
  if (spot === null) return null
  if (spot.kind === 'home') {
    return homeBorough === null ? null : { spot: 'home', place: null, borough: homeBorough }
  }
  const borough = asBorough(boroughOf.get(spot.placeId))
  return borough === null ? null : { spot: 'place', place: spot.placeId, borough }
}

/**
 * Starts presence for this page: the place pins give each place's borough. Answers the stop
 * (leaves the map, clears the store). `connect` is the transport (tests pass a fake).
 */
export function startPresence(
  boroughOf: ReadonlyMap<string, string>,
  connect?: () => Promise<PresenceTransport | null>,
): () => void {
  const env = supabaseEnv()
  if (connect === undefined && env === null) return () => {}
  const open =
    connect ?? (async () => (await import('@/realtime/supabasePresence')).connectedPresence(env))
  let stopped = false
  let cleanup = () => {}
  void open()
    .then((transport) => {
      if (stopped || transport === null) return
      const client = createPresenceClient({
        transport,
        config,
        mode: () => presenceMode(),
        announce: () => currentAnnounce(boroughOf),
        onSnapshot: applySnapshot,
        onPublic: applyPublicSnapshot,
        onFailures: (failures) => {
          if (failures >= config.hideAfterFailures) presenceUnavailable()
        },
      })
      const visible = () => document.visibilityState === 'visible'
      client.setVisible(visible())
      client.start()
      let lastMode = presenceMode()
      const offSession = guestSessionStore.subscribe(() => {
        const mode = presenceMode()
        if (mode === lastMode) return
        lastMode = mode
        // Signed in or out: what this device may see changes at once.
        resetPresence()
        client.kick()
      })
      const offTrip = tripStore.subscribe(() => client.kick())
      const offHome = playerHomeStore.subscribe(() => client.kick())
      const onVisibility = () => client.setVisible(visible())
      // Closing the tab: leave at once rather than linger until the online TTL.
      const onPageHide = () => client.stop()
      // Back from the back/forward cache: on the map again.
      const onPageShow = (event: PageTransitionEvent) => {
        if (event.persisted) client.start()
      }
      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('pagehide', onPageHide)
      window.addEventListener('pageshow', onPageShow)
      cleanup = () => {
        offSession()
        offTrip()
        offHome()
        document.removeEventListener('visibilitychange', onVisibility)
        window.removeEventListener('pagehide', onPageHide)
        window.removeEventListener('pageshow', onPageShow)
        client.stop()
      }
    })
    .catch((error: unknown) => {
      // Offline before the session chunk was cached: the map stays a quiet solo city.
      log.info('presence: not started', {
        reason: error instanceof Error ? error.message : String(error),
      })
    })
  return () => {
    stopped = true
    cleanup()
    resetPresence()
  }
}
