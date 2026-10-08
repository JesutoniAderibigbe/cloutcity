'use client'

import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ActionList } from '@/components/places/ActionList'
import { engineConfig, type HomeId } from '@/engine/config'
import { homeLock, type HomeError } from '@/engine/home'
import { homeActions } from '@/engine/placeActions'
import { homeIds } from '@/engine/rent'
import { copy } from '@/lib/copy'
import type { QualityTier } from '@/lib/data/schemas/config'
import { homeName } from '@/lib/economyCopy'
import {
  currentHomeLine,
  homeErrorText,
  homeLockName,
  homeLockReason,
  homeScoreLine,
  movedNotice,
  moveButtonText,
  moveConfirmText,
  moveDetails,
  moveLabel,
} from '@/lib/homeCopy'
import { log } from '@/lib/log'
import { useActionGuard } from '@/components/overlay/useActionGuard'
import { setApartmentView } from '@/state/apartmentView'
import { closeHudPanel } from '@/state/hudPanel'
import { openPlace } from '@/state/placeSheet'
import { playRoomActivity } from '@/state/roomActivity'
import { gameStore, useGameStore } from '@/state/store'
import { HOME_SPOT_ID } from '@/state/trip'
import { finishesView, placedView } from './homeView'
import { PANEL_BUTTON, PanelDialog, PanelStatus } from './PanelDialog'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/home'
import '@/lib/copy/ns/hud'

const ACTION = `${PANEL_BUTTON} bg-raised text-center text-sm text-fg enabled:hover:bg-pressed`
const ROW = 'flex flex-col gap-1.5 rounded-xl bg-canvas/60 p-2'
const SECTION_HEADING = 'text-xs font-bold text-muted uppercase'

/** Which part of the Home panel shows: the room and its things, or buy mode's catalogue (S40). */
export type HomeMode = 'room' | 'buy'

/** Does the action, then has the room's Sim act it out (S40c: visual only, after the fact). */
const performHomeAction = (actionId: string) => {
  const outcome = gameStore.getState().performHomeAction(actionId)
  if (outcome.ok) playRoomActivity(actionId)
  return outcome
}

/**
 * Quality tiers arrive with S04b; until then every device gets the mid tier, as the map does
 * (src/scene/CityScene.tsx `dprCap`).
 */
const DEVICE_TIER: QualityTier = 'mid'

/**
 * Buy mode 2.0 (S40): the furniture list, placement controls, catalogue and finishes, in their
 * own lazy chunk (`cc-feature:home-decor`, left out of the precache, PERF-7) so the Home panel
 * on the playable path stays as small as it was.
 */
const HomeDecor = lazy(() => import('./HomeDecor'))

/**
 * A buy-mode chunk that fails to load (offline before it was ever cached) leaves the rest of the
 * Home panel working: an expected condition, logged at info.
 */
class DecorBoundary extends Component<{ readonly children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(error: Error): void {
    log.info('Buy mode failed to load; the Home panel still works', { error })
  }

  override render(): ReactNode {
    return this.state.failed ? (
      <p className="text-sm text-muted">{copy('home.decor.offline')}</p>
    ) : (
      this.props.children
    )
  }
}

/**
 * The Home panel (S16, S40), opened from the HUD: the player's apartment. It shows the home
 * score (which feeds clout), a switch between "Your place" (rest and eat here, everything in the
 * room and in storage, moving home) and "Buy mode" (the furniture catalogue by category and the
 * wall paints and floors to try on), and the other homes with Move (a two-step confirm) or, when
 * locked, why ("{home}. {reason}", in the accessible name too).
 *
 * The 3D room (src/scene/apartment/ApartmentMount.tsx, fed through src/state/apartmentView.ts)
 * draws beside or above the panel and mirrors it: buy mode's chunk drives it while it is loaded
 * (the held item, the grid, a finish tried on), this panel shows the room as it stands until then.
 * Everything the room does, the lists do with a keyboard (A11Y-3), and without WebGL the lists are
 * the whole feature. Every action goes through the store to the engine; the result, or the
 * engine's refusal, shows in the status line. Loaded lazily by HudPanelMount (DEC-11).
 */
export function HomePanel() {
  const player = useGameStore((state) => state.player)
  const clock = useGameStore((state) => state.clock)
  const minute = clock.minute
  const snapshot = useMemo(() => ({ clock, player }), [clock, player])
  const rest = useMemo(() => homeActions(snapshot, engineConfig), [snapshot])
  const restId = useId()
  const [mode, setMode] = useState<HomeMode>('room')
  const [decorLive, setDecorLive] = useState(false)
  const [confirming, setConfirming] = useState<HomeId | null>(null)
  // The nonce re-runs the focus check for every result, even when two read the same.
  const [result, setResult] = useState<{ readonly text: string; readonly nonce: number } | null>(
    null,
  )
  const { guard: act, onKeyDown, onPointerDown } = useActionGuard()
  const dialogRef = useRef<HTMLElement | null>(null)
  /** A selector, inside the panel, to focus after the next render. */
  const pendingFocus = useRef<string | null>(null)

  const { home } = player

  useEffect(() => {
    dialogRef.current = document.querySelector<HTMLElement>('[data-hud-panel-dialog="home"]')
  }, [])

  // Moves focus where the last action asked; if the focused control left the page, focus stays
  // in the panel on its heading instead of dropping to the body.
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    const target = pendingFocus.current
    pendingFocus.current = null
    if (target !== null) {
      const found = dialog.querySelector<HTMLElement>(target)
      if (found !== null) {
        found.focus()
        found.scrollIntoView({ block: 'nearest' })
        return
      }
    }
    if (result !== null && !dialog.contains(document.activeElement)) {
      dialog.querySelector<HTMLElement>('h2')?.focus()
    }
  })

  const show = (text: string) => setResult((last) => ({ text, nonce: (last?.nonce ?? 0) + 1 }))

  const refused = (error: HomeError, context: Record<string, unknown>) => {
    // The panel offers only what the engine allows, so a refusal means the state moved under it.
    log.info('A home action was refused', { ...context, code: error.code })
    show(homeErrorText(error))
  }

  const move = (to: HomeId) => {
    const outcome = gameStore.getState().moveHome(to)
    setConfirming(null)
    if (!outcome.ok) {
      refused(outcome.error, { to })
      return
    }
    pendingFocus.current = 'h2'
    show(movedNotice(to))
  }

  const buttonGuard = { onKeyDown, onPointerDown }

  // Only a real change of what sits where (or its colour or finish) may reach the room: a new
  // object on every render (the clock ticks) would make the on-demand canvas draw for nothing.
  const placed = useMemo(() => placedView(player), [player])
  const finishes = useMemo(() => finishesView(player), [player])
  const label = copy('home.view.label', { home: homeName(home) })
  const resetLabel = copy('home.view.reset')
  useEffect(() => {
    if (decorLive) return
    setApartmentView({
      home,
      placed,
      finishes,
      cells: null,
      label,
      resetLabel,
      minute,
      tier: DEVICE_TIER,
    })
  }, [decorLive, home, placed, finishes, label, resetLabel, minute])
  // Closing the panel closes the room.
  useEffect(() => () => setApartmentView(null), [])

  return (
    <PanelDialog
      title={copy('home.heading')}
      panel="home"
      feature="cc-feature:home-panel"
      onClose={closeHudPanel}
      scrollBody
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm text-fg" data-home-current="">
            {currentHomeLine(home)}
          </p>
          <p className="text-sm font-bold text-taxi-ink" data-home-score="">
            {homeScoreLine(player)}
          </p>
        </div>
        <div
          role="group"
          aria-label={copy('home.mode.label')}
          className="flex gap-1 rounded-xl bg-canvas/60 p-1"
        >
          {(['room', 'buy'] as const).map((option) => (
            <button
              key={option}
              type="button"
              data-home-mode={option}
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
              className={`${PANEL_BUTTON} text-sm ${
                mode === option ? 'bg-taxi text-on-taxi' : 'bg-raised text-fg'
              }`}
            >
              {copy(option === 'room' ? 'home.mode.room' : 'home.mode.buy')}
            </button>
          ))}
        </div>
      </div>

      {mode === 'room' ? (
        // B1: rest and eat here. Away, the rows say to head home first, and one button opens
        // the home card with the trip back.
        <div data-home-rest="" className="flex flex-col gap-1.5">
          <ActionList
            headingId={restId}
            actions={rest}
            place={null}
            snapshot={snapshot}
            perform={performHomeAction}
          />
          {player.location.kind === 'home' ? null : (
            <button
              type="button"
              data-home-head-home=""
              onClick={() => openPlace(HOME_SPOT_ID, { origin: 'panel' })}
              className={`${ACTION} bg-taxi text-on-taxi enabled:hover:bg-taxi`}
            >
              {copy('home.rest.headHome')}
            </button>
          )}
        </div>
      ) : null}

      <DecorBoundary>
        <Suspense fallback={null}>
          <HomeDecor
            mode={mode}
            minute={minute}
            tier={DEVICE_TIER}
            label={label}
            onLive={setDecorLive}
            onStatus={show}
          />
        </Suspense>
      </DecorBoundary>

      {mode === 'room' ? (
        <section aria-label={copy('home.move.heading')} className="flex flex-col gap-1.5">
          <h3 className={SECTION_HEADING}>{copy('home.move.heading')}</h3>
          <ul className="flex flex-col gap-1.5">
            {homeIds(engineConfig)
              .filter((id) => id !== home)
              .map((id) => {
                const lock = homeLock(player, id, engineConfig)
                return (
                  <li key={id} data-home-move={id} className={ROW}>
                    <div className="min-w-0">
                      <p className="font-semibold text-fg">{homeName(id)}</p>
                      <p className="text-xs text-muted">{moveDetails(id)}</p>
                      {lock === null ? null : (
                        <p className="text-xs text-taxi-ink">{homeLockReason(lock)}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        data-home-move-button=""
                        {...buttonGuard}
                        aria-disabled={lock === null ? undefined : true}
                        aria-expanded={lock === null ? confirming === id : undefined}
                        aria-label={lock === null ? moveLabel(id) : homeLockName(lock)}
                        onClick={(event) => {
                          if (lock !== null) return
                          act(event, `move-${id}`, () => {
                            setConfirming(confirming === id ? null : id)
                            pendingFocus.current = `[data-home-move="${id}"] [data-home-confirm]`
                          })
                        }}
                        className={`${ACTION} ${lock === null ? '' : 'cursor-not-allowed text-muted'}`}
                      >
                        {moveButtonText(id)}
                      </button>
                    </div>
                    {lock === null && confirming === id ? (
                      <div
                        role="group"
                        aria-label={moveButtonText(id)}
                        className="flex flex-col gap-1.5"
                      >
                        <p className="text-sm text-fg" data-home-confirm-text="">
                          {moveConfirmText(id)}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            data-home-confirm=""
                            {...buttonGuard}
                            onClick={(event) => act(event, `confirm-${id}`, () => move(id))}
                            className={`${ACTION} bg-taxi text-on-taxi enabled:hover:bg-taxi`}
                          >
                            {copy('home.move.confirmButton')}
                          </button>
                          <button
                            type="button"
                            {...buttonGuard}
                            onClick={(event) =>
                              act(event, `cancel-${id}`, () => {
                                setConfirming(null)
                                pendingFocus.current = `[data-home-move="${id}"] [data-home-move-button]`
                              })
                            }
                            className={ACTION}
                          >
                            {copy('home.move.cancel')}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                )
              })}
          </ul>
        </section>
      ) : null}
      <PanelStatus text={result?.text ?? null} />
    </PanelDialog>
  )
}
