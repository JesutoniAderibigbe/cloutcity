'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useModalOpen } from '@/components/overlay/modalState'
import { engineConfig } from '@/engine/config'
import type { GameSnapshot } from '@/engine/game'
import { hasShop, placeActions, type PlaceAction } from '@/engine/placeActions'
import type { Place } from '@/engine/places'
import { copy, isCopyKey, type CopyKey } from '@/lib/copy'
import { rentNotice } from '@/lib/economyCopy'
import { log } from '@/lib/log'
import {
  placeActionAccessibleName,
  placeActionDetails,
  placeActionDone,
  placeActionName,
  placeBlockReason,
  placeHoursLine,
} from '@/lib/world/placeActionCopy'
import { findPlace, placeName } from '@/lib/world/places'
import { announcePlace, closePlace, usePlaceOpenCount } from '@/state/placeSheet'
import { gameStore, useGameStore } from '@/state/store'
import { ShopSection } from './ShopSection'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/boroughs'
import '@/lib/copy/ns/club'
import '@/lib/copy/ns/landmarks'
import '@/lib/copy/ns/place'
import '@/lib/copy/ns/places'
import '@/lib/copy/ns/venues'

/**
 * The location action sheet (S09), in the overlay `sheet` zone. One sheet for every way into a
 * place (3D pin, Places panel): it lists what the engine says the player can do there right
 * now on the personal clock, each blocked action with its reason. Memorials get a muted info
 * card with no actions.
 *
 * A non-modal dialog on purpose: the map, HUD and tabs stay usable while it is open, so a
 * player can tap another place (which swaps the sheet) without closing this one first. Focus
 * moves into it on open and back on close; Escape and the Close button close it. Loaded
 * lazily on first use by PlaceSheetMount (DEC-11).
 */
export function PlaceSheet({ placeId }: { readonly placeId: string }) {
  const place = findPlace(placeId)

  useEffect(() => {
    if (place !== undefined) return
    log.info('No place with that id; closing the place sheet', { placeId })
    closePlace()
  }, [place, placeId])

  if (place === undefined) return null
  return <PlaceCard key={place.id} place={place} />
}

const BUTTON =
  'min-h-11 rounded-xl px-3 py-2 text-left font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-taxi-400'

function PlaceCard({ place }: { readonly place: Place }) {
  const clock = useGameStore((state) => state.clock)
  const player = useGameStore((state) => state.player)
  const snapshot: GameSnapshot = useMemo(() => ({ clock, player }), [clock, player])
  const view = useMemo(() => placeActions(place, snapshot, engineConfig), [place, snapshot])
  // The result of the last action, and which action it was. That action stays disabled while
  // its result shows, so a fast double tap cannot run it twice; `busy` is the same guard,
  // set synchronously, for taps that land before React re-renders.
  const [result, setResult] = useState<{ readonly actionId: string; readonly text: string } | null>(
    null,
  )
  const busy = useRef<string | null>(null)
  const refocus = useRef<string | null>(null)
  const dismissButton = useRef<HTMLButtonElement>(null)
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const name = placeName(place)
  const lookOnly = view.kind === 'look-only'

  // Every pick, from the map or the Places panel, is announced by name (A11Y-3), including a
  // repeat pick of the open place (openPlace cleared the announcement).
  const openCount = usePlaceOpenCount()
  useEffect(() => {
    announcePlace(copy('places.announce.opened', { place: name }))
  }, [openCount, name])

  // On close, give focus back to what had it on open (or to the scene if that is gone). Runs
  // before the title takes focus, so it records the control the player was on.
  useEffect(() => {
    const previous = document.activeElement
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected && previous !== document.body) {
        previous.focus()
      } else {
        document.querySelector<HTMLElement>('main')?.focus()
      }
    }
  }, [])
  // Focus the title on open (once a modal holding the page inert at boot has closed).
  const blocked = useModalOpen()
  const titleFocused = useRef(false)
  useEffect(() => {
    if (blocked || titleFocused.current) return
    titleFocused.current = true
    ref.current?.querySelector<HTMLElement>('h2')?.focus()
  }, [blocked])

  // Listened to directly: jsx-a11y does not allow key handlers on a non-interactive role.
  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePlace()
    }
    dialog.addEventListener('keydown', onKeyDown)
    return () => dialog.removeEventListener('keydown', onKeyDown)
  }, [])

  // A new result takes focus to its Dismiss button (the action's own button is now
  // disabled); dismissing gives focus back to that action.
  useEffect(() => {
    if (result !== null) {
      dismissButton.current?.focus()
      return
    }
    const actionId = refocus.current
    refocus.current = null
    if (actionId === null) return
    ref.current
      ?.querySelector<HTMLButtonElement>(`button[data-place-action="${CSS.escape(actionId)}"]`)
      ?.focus()
  }, [result])

  const run = (action: PlaceAction) => {
    if (busy.current === action.id) return
    busy.current = action.id
    const outcome = gameStore.getState().performPlaceAction(place, action.id)
    if (outcome.ok) {
      // Rent that fell due while the action ran is part of what it did.
      const text = [
        placeActionDone(outcome, place),
        ...outcome.rent.map((event) => rentNotice(event)),
      ]
      setResult({ actionId: action.id, text: text.join(' ') })
      return
    }
    // The UI only enables allowed actions, so a refusal here means the state moved under it.
    log.info('A place action was refused', { placeId: place.id, code: outcome.error.code })
    const text =
      outcome.error.code === 'BLOCKED' ? placeBlockReason(outcome.error.block, place) : null
    if (text === null) {
      busy.current = null
      setResult(null)
    } else {
      setResult({ actionId: action.id, text })
    }
  }

  const dismiss = () => {
    refocus.current = result?.actionId ?? null
    busy.current = null
    setResult(null)
  }

  const info = 'category' in place ? place.infoKey : place.blurbKey

  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={titleId}
      data-place-sheet={place.id}
      data-cc-feature="cc-feature:place-sheet"
      data-look-only={lookOnly ? '' : undefined}
      className={`m-2 flex flex-col gap-2 rounded-2xl border p-3 shadow-lg ${
        lookOnly
          ? 'border-night-700 bg-night-950'
          : 'border-night-700 bg-night-900/95 backdrop-blur'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2
            id={titleId}
            tabIndex={-1}
            className={`text-base leading-tight font-extrabold focus:outline-none ${
              lookOnly ? 'text-ink-50' : 'text-pink-400'
            }`}
          >
            {name}
          </h2>
          <p className="text-xs text-ink-300">
            {view.kind === 'look-only' ? copy('place.memorial.label') : placeHoursLine(view.hours)}
          </p>
        </div>
        <button
          type="button"
          onClick={closePlace}
          aria-label={copy('place.sheet.closeLabel', { place: name })}
          className={`${BUTTON} min-w-11 shrink-0 bg-night-800 text-center text-ink-50`}
        >
          {copy('place.sheet.close')}
        </button>
      </div>
      <p className="text-sm text-ink-50">{copy(infoKeyOf(info))}</p>
      {view.kind === 'look-only' ? (
        <p className="text-sm text-ink-300">{copy('place.memorial.note')}</p>
      ) : (
        <section aria-labelledby={`${titleId}-actions`} className="flex flex-col gap-1.5">
          <h3 id={`${titleId}-actions`} className="text-xs font-bold text-ink-300 uppercase">
            {copy('place.actions.heading')}
          </h3>
          {view.actions.length === 0 ? (
            <p className="text-sm text-ink-300">{copy('place.actions.none')}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {view.actions.map((action) => {
                const resultShowing = action.block === null && result?.actionId === action.id
                return (
                  <li key={action.id}>
                    <button
                      type="button"
                      disabled={action.block !== null || resultShowing}
                      data-place-action={action.id}
                      aria-label={
                        resultShowing
                          ? copy('place.action.blockedLabel', {
                              action: placeActionAccessibleName(action, place, snapshot),
                              reason: copy('place.busy.reason'),
                            })
                          : placeActionAccessibleName(action, place, snapshot)
                      }
                      onClick={() => run(action)}
                      className={`${BUTTON} flex w-full flex-col bg-night-800 text-ink-50 enabled:hover:bg-night-700 disabled:opacity-70`}
                    >
                      <span>{placeActionName(action)}</span>
                      <span className="text-xs font-normal text-ink-300">
                        {placeActionDetails(action, snapshot)}
                      </span>
                      {action.block === null ? null : (
                        <span className="text-xs font-normal text-taxi-400">
                          {placeBlockReason(action.block, place)}
                        </span>
                      )}
                      {resultShowing ? (
                        <span className="text-xs font-normal text-taxi-400">
                          {copy('place.busy.reason')}
                        </span>
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="flex items-center justify-between gap-2">
            <p role="status" className="text-sm font-semibold text-taxi-400">
              {result?.text}
            </p>
            {result === null ? null : (
              <button
                ref={dismissButton}
                type="button"
                onClick={dismiss}
                className={`${BUTTON} min-w-11 shrink-0 bg-night-800 text-center text-ink-50`}
              >
                {copy('place.result.dismiss')}
              </button>
            )}
          </div>
        </section>
      )}
      {view.kind !== 'look-only' && hasShop(place) ? (
        <ShopSection place={place} headingId={`${titleId}-shop`} />
      ) : null}
    </div>
  )
}

function infoKeyOf(key: string): CopyKey {
  if (!isCopyKey(key)) throw new Error(`No copy key "${key}" for a place blurb or info`)
  return key
}
