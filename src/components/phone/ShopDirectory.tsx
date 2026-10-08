'use client'

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { PanelDialog } from '@/components/hud/PanelDialog'
import { engineConfig } from '@/engine/config'
import { isAtPlace } from '@/engine/game'
import { hasShop, placeActions, type PlaceView } from '@/engine/placeActions'
import type { TravelMode } from '@/engine/transit/plan'
import { copy, type CopyKey } from '@/lib/copy'
import type { PlaceIconGroup, Venue } from '@/lib/data/schemas/content'
import { formatMoney } from '@/lib/format'
import { log } from '@/lib/log'
import { boroughName, formatMiles, straightDistanceM } from '@/lib/phone/placeInfo'
import { actionName, durationText, hoursText } from '@/lib/phone/placeFacts'
import { placeIcon, placeIconGroup, placeIconGroups } from '@/lib/world/placeIcons'
import { placeGroupLabel } from '@/lib/world/placeIconCopy'
import {
  boroughAccessFor,
  boroughClosedReason,
  gateClout,
  placeName,
  venues,
} from '@/lib/world/places'
import { tripEnd } from '@/lib/world/tripEnds'
import { dismissHudPanel } from '@/state/hudPanel'
import { openPlace } from '@/state/placeSheet'
import { gameStore, useGameStore } from '@/state/store'
import { LaterCard, PHONE_PRIMARY, PHONE_SECONDARY } from './phoneUi'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/phone'

type TripDriver = typeof import('@/state/tripDriver')

const MODE_KEYS: Readonly<Record<TravelMode, CopyKey>> = {
  walk: 'phone.shop.fastest.walk',
  subway: 'phone.shop.fastest.subway',
  taxi: 'phone.shop.fastest.taxi',
}

const MINUTES_PER_HOUR = 60

interface Store {
  readonly venue: Venue
  readonly group: PlaceIconGroup
  readonly view: Extract<PlaceView, { kind: 'actions' }>
  /** What it sells: the item shop, or its paid actions with their prices. */
  readonly sells: string
  readonly distanceM: number | null
}

/**
 * Every place the player can buy from (S58): the item shops and every venue whose actions cost
 * cash (food, coffee, a workout), from the engine's own place actions, so what it lists is what
 * the place sheet sells. The cover at a club is a door, not a store, so clubs are not listed.
 */
function stores(snapshot: Parameters<typeof placeActions>[1]): Store[] {
  return venues.flatMap((venue): Store[] => {
    const view = placeActions(venue, snapshot, engineConfig)
    if (view.kind !== 'actions') return []
    const paid = view.actions.filter(
      (action) => action.kind === 'consume' && action.def.cashCost > 0,
    )
    if (!hasShop(venue) && paid.length === 0) return []
    const sells = hasShop(venue)
      ? copy('phone.shop.sellsItems')
      : paid
          .map((action) =>
            copy('phone.shop.sellsAction', {
              item: actionName(action.id),
              price: formatMoney(action.def.cashCost),
            }),
          )
          .join(' · ')
    return [
      {
        venue,
        group: placeIconGroup(venue.type),
        view,
        sells,
        distanceM: straightDistanceM(snapshot.player, venue.id),
      },
    ]
  })
}

/** The travel chunk (src/state/tripDriver.ts), loaded on open; null until it arrives. */
function useTripDriver(): TripDriver | null {
  const [driver, setDriver] = useState<TripDriver | null>(null)
  useEffect(() => {
    let active = true
    import('@/state/tripDriver').then(
      (module) => {
        if (active) setDriver(module)
      },
      (error: unknown) => {
        // Offline before the chunk was cached: the directory still lists distances.
        log.info('The travel chunk could not load for the store directory', {
          error: error instanceof Error ? error.name : typeof error,
        })
      },
    )
    return () => {
      active = false
    }
  }, [])
  return driver
}

/**
 * The quickest way to each store from where the player stands, from the travel planner itself
 * (GR-10: the same rows the place sheet's "Get there" offers), keyed by venue id. Planned again
 * when the player moves, the routes finish loading or the hour changes (rush hour).
 */
interface Fastest {
  /** The quickest trip's text by venue id, or null while the planner loads. */
  readonly byId: ReadonlyMap<string, string> | null
  /** What the rows were planned for: the routes' status and the hour (rush hour). */
  readonly plannedFor: string
}

function useFastest(idKey: string): Fastest {
  const driver = useTripDriver()
  const subscribe = useCallback(
    (listener: () => void) => driver?.transitWorldStore.subscribe(listener) ?? (() => {}),
    [driver],
  )
  const status = useSyncExternalStore(
    subscribe,
    () => driver?.transitWorldStore.getState().status ?? 'idle',
    () => 'idle' as const,
  )
  const location = useGameStore((state) => state.player.location)
  const home = useGameStore((state) => state.player.home)
  const hour = useGameStore((state) => Math.floor(state.clock.minute / MINUTES_PER_HOUR))
  return useMemo(() => {
    const plannedFor = `${status}:${hour}`
    const none = { byId: null, plannedFor }
    if (driver === null) return none
    const from = tripEnd(location, home)
    if (from === undefined) return none
    const snapshot = gameStore.getState()
    const fastest = new Map<string, string>()
    for (const id of idKey.split(',')) {
      const to = tripEnd({ kind: 'place', placeId: id }, home)
      if (to === undefined) continue
      const { options } = driver.tripOptionsFor({ from, to }, snapshot)
      if (options.length === 0) return none
      const best = options
        .filter((option) => option.route !== null && option.block === null)
        .sort((a, b) => a.durationMin - b.durationMin)[0]
      if (best === undefined) continue
      fastest.set(id, copy(MODE_KEYS[best.mode], { time: durationText(best.durationMin) }))
    }
    return { byId: fastest, plannedFor }
  }, [driver, idKey, location, home, hour, status])
}

/**
 * The Shop tab (S58): a store directory, every store the player can buy from grouped by
 * category (the place icon groups, in their data order), nearest first within a group by the
 * measured distance, with opening hours now, the quickest trip and "Get there", which opens the
 * store's sheet with its travel options (DEC-22). The premium store comes later (S25/S26) and
 * says so. A tall panel in the sheet zone.
 */
export function ShopDirectory() {
  const clock = useGameStore((state) => state.clock)
  const player = useGameStore((state) => state.player)
  const clout = gateClout(player, engineConfig)
  const all = stores({ clock, player })
  const fastest = useFastest(all.map((store) => store.venue.id).join(',')).byId
  const groups = placeIconGroups().flatMap((group) => {
    const inGroup = all
      .filter((store) => store.group === group)
      .sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity))
    return inGroup.length === 0 ? [] : [{ group, stores: inGroup }]
  })

  return (
    <div className="h-full" data-sheet-tall="">
      <PanelDialog
        title={copy('phone.shop.title')}
        panel="shop"
        feature="cc-feature:shop-directory"
        onClose={dismissHudPanel}
        scrollBody
      >
        <p className="text-sm text-muted">{copy('phone.shop.intro')}</p>
        {groups.map(({ group, stores: inGroup }) => (
          <section key={group} data-shop-group={group} className="flex flex-col gap-1.5">
            <h3 className="flex items-center gap-2 text-xs font-bold text-muted uppercase">
              <span aria-hidden="true" className="text-base leading-none">
                {placeIcon(group)}
              </span>
              {placeGroupLabel(group)}
            </h3>
            <ul className="flex flex-col gap-1.5">
              {inGroup.map(({ venue, view, sells, distanceM }) => {
                const name = placeName(venue)
                const here = isAtPlace(player, venue.id)
                const locked = boroughClosedReason(
                  venue.borough,
                  boroughAccessFor(venue.borough, clout),
                )
                const trip = here
                  ? copy('phone.shop.here')
                  : [
                      distanceM === null
                        ? null
                        : copy('phone.shop.distance', { distance: formatMiles(distanceM) }),
                      fastest === null
                        ? copy('phone.shop.planning')
                        : (fastest.get(venue.id) ?? null),
                    ]
                      .filter((part) => part !== null)
                      .join(' · ')
                return (
                  <li
                    key={venue.id}
                    data-shop-store={venue.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-bold text-fg">{name}</span>
                      <span className="text-xs text-muted">
                        {boroughName(venue.borough)} · {hoursText(view.hours)}
                      </span>
                      <span className="text-xs text-fg">{sells}</span>
                      <span className="text-xs font-semibold text-muted">{trip}</span>
                      {locked === null ? null : (
                        <span className="text-xs font-semibold text-taxi-ink">{locked}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      data-shop-get-there={venue.id}
                      onClick={() => openPlace(venue.id, { origin: 'panel' })}
                      aria-label={copy(
                        here ? 'phone.shop.openHereLabel' : 'phone.shop.getThereLabel',
                        { place: name },
                      )}
                      className={here ? PHONE_SECONDARY : PHONE_PRIMARY}
                    >
                      {copy(here ? 'phone.shop.openHere' : 'phone.shop.getThere')}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
        <LaterCard title={copy('phone.shop.premiumTitle')} body={copy('phone.shop.premiumBody')} />
      </PanelDialog>
    </div>
  )
}
