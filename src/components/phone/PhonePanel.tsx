'use client'

import { useEffect, useId, useMemo, useRef, type ComponentType } from 'react'
import { useStore } from 'zustand'
import { lazyIsland } from '@/components/overlay/lazyIsland'
import { calendar } from '@/engine/clock'
import { engineConfig } from '@/engine/config'
import { nextRentDueDay, rentFor } from '@/engine/rent'
import { copy, type CopyKey } from '@/lib/copy'
import { formatCount, formatGameTime, formatMoney } from '@/lib/format'
import {
  PHONE_APP_TARGETS,
  badgeCount,
  phoneAppOf,
  phoneConfig,
  type PhoneAppId,
} from '@/lib/phone/phoneConfig'
import { phoneUpdates } from '@/lib/phone/updates'
import { closeHudPanel, hudPanelStore, openHudPanel } from '@/state/hudPanel'
import { openPlacesPanel } from '@/state/placesPanel'
import { useGameStore } from '@/state/store'
import { MessagesApp, PHONE_BUTTON } from './phoneUi'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/phone'

interface ScreenProps {
  /** The screen asked for: the app's id, or a part of it (`shortcuts` in Settings & Help). */
  readonly screen: string
}

// Each app with a screen inside the phone is its own island (S58): its engine, data and copy
// load the first time it opens.
const BankApp = lazyIsland<ScreenProps>(
  () => import('./BankApp').then((module) => module.BankApp),
  {
    zone: 'sheet',
    labelKey: 'loading.phoneApp',
  },
)
const UpdatesApp = lazyIsland<ScreenProps>(
  () => import('./UpdatesApp').then((module) => module.UpdatesApp),
  {
    zone: 'sheet',
    labelKey: 'loading.phoneApp',
  },
)
const JobsApp = lazyIsland<ScreenProps>(
  () => import('./JobsApp').then((module) => module.JobsApp),
  {
    zone: 'sheet',
    labelKey: 'loading.phoneApp',
  },
)
const SettingsApp = lazyIsland<ScreenProps>(
  () => import('./SettingsApp').then((module) => module.SettingsApp),
  {
    zone: 'sheet',
    labelKey: 'loading.phoneApp',
  },
)

const SCREENS: Partial<Record<PhoneAppId, ComponentType<ScreenProps>>> = {
  bank: BankApp,
  updates: UpdatesApp,
  jobs: JobsApp,
  messages: MessagesApp,
  settings: SettingsApp,
}

const APP_LABEL: Readonly<Record<PhoneAppId, CopyKey>> = {
  bank: 'phone.app.bank',
  updates: 'phone.app.updates',
  jobs: 'phone.app.jobs',
  places: 'phone.app.places',
  goals: 'phone.app.goals',
  closet: 'phone.app.closet',
  home: 'phone.app.home',
  profile: 'phone.app.profile',
  messages: 'phone.app.messages',
  settings: 'phone.app.settings',
}

/** Which app screen the phone shows (the store's `phoneApp`), or null for the home screen. */
function showScreen(screen: string | null): void {
  hudPanelStore.setState({ phoneApp: screen })
}

/** The app icon last opened, so Back hands focus to it again. */
let lastApp: PhoneAppId | null = null

/**
 * The Phone tab (S58): a phone-style home screen with an app grid, in Clout City's own look
 * (a sky wallpaper that follows the day/night theme, white app tiles, taxi yellow for what needs
 * the player). Apps with a screen open inside the phone with a Back button; Goals, Closet, Home
 * and Profile open their HUD panel in the phone's place, and its Close comes back here; Places
 * opens the Places panel. A non-modal dialog in the sheet zone, which it makes tall
 * (`data-sheet-tall`, globals.css); Escape goes back from an app, then closes the phone.
 */
export function PhonePanel() {
  const screen = useStore(hudPanelStore, (state) => state.phoneApp)
  const app = phoneAppOf(screen)
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const appTitleId = useId()

  // Focus: the phone's title on open, an app's title when it opens, the app's icon on Back.
  useEffect(() => {
    const root = ref.current
    if (root === null) return
    if (app !== null) {
      root.querySelector<HTMLElement>('[data-phone-app-title]')?.focus()
      return
    }
    const icon =
      lastApp === null
        ? null
        : root.querySelector<HTMLElement>(`[data-phone-app="${CSS.escape(lastApp)}"]`)
    ;(icon ?? root.querySelector<HTMLElement>('h2'))?.focus()
  }, [app])

  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      if (hudPanelStore.getState().phoneApp !== null) showScreen(null)
      else closeHudPanel()
    }
    dialog.addEventListener('keydown', onKeyDown)
    return () => dialog.removeEventListener('keydown', onKeyDown)
  }, [])

  // Focus goes back to the Phone tab when the phone closes.
  useEffect(
    () => () => {
      lastApp = null
      document.querySelector<HTMLElement>('[data-tab="phone"]')?.focus()
    },
    [],
  )

  const open = (id: PhoneAppId) => {
    lastApp = id
    const target = PHONE_APP_TARGETS[id]
    if (target.kind === 'screen') showScreen(id)
    else if (target.kind === 'panel') openHudPanel(target.panel, { fromPhone: true })
    else openPlacesPanel()
  }

  const Screen = app === null ? undefined : SCREENS[app]

  return (
    <div className="flex h-full justify-center p-2" data-sheet-tall="">
      <div
        ref={ref}
        role="dialog"
        aria-labelledby={app === null ? titleId : `${titleId} ${appTitleId}`}
        data-cc-feature="cc-feature:phone"
        data-phone-screen={app ?? 'home'}
        className="flex h-full w-full max-w-[23rem] flex-col rounded-[2.4rem] bg-scrim p-[5px] shadow-2xl"
      >
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2.1rem] bg-canvas">
          <StatusBar />
          <h2 id={titleId} tabIndex={-1} className="sr-only">
            {copy('phone.title')}
          </h2>
          {app === null || Screen === undefined ? (
            <HomeScreen onOpen={open} />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center gap-1 border-b border-line bg-surface px-2 py-1">
                <button
                  type="button"
                  data-phone-back=""
                  onClick={() => showScreen(null)}
                  aria-label={copy('phone.backLabel')}
                  className={`${PHONE_BUTTON} flex items-center gap-1 px-2 text-taxi-ink`}
                >
                  <span aria-hidden="true" className="text-lg leading-none">
                    ‹
                  </span>
                  {copy('phone.back')}
                </button>
                <h3
                  id={appTitleId}
                  tabIndex={-1}
                  data-phone-app-title=""
                  className="min-w-0 flex-1 truncate text-lg font-extrabold text-fg focus:outline-none"
                >
                  {copy(APP_LABEL[app])}
                </h3>
                <CloseButton />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
                <Screen screen={screen ?? app} />
              </div>
            </div>
          )}
          <div
            aria-hidden="true"
            className="pointer-events-none mx-auto mb-1.5 h-1 w-28 shrink-0 rounded-full bg-fg/40"
          />
        </div>
      </div>
    </div>
  )
}

function CloseButton() {
  return (
    <button
      type="button"
      data-phone-close=""
      onClick={closeHudPanel}
      aria-label={copy('phone.closeLabel')}
      className={`${PHONE_BUTTON} shrink-0 bg-raised text-fg`}
    >
      {copy('phone.close')}
    </button>
  )
}

/** The phone's status bar: the personal clock's time and day (decorative signal glyphs). */
function StatusBar() {
  const minute = useGameStore((state) => state.clock.minute)
  const { minuteOfDay, day } = calendar(minute, engineConfig)
  return (
    <div className="flex h-8 shrink-0 items-center justify-between px-6 text-xs font-bold text-fg">
      <span>{formatGameTime(minuteOfDay)}</span>
      <span aria-hidden="true" className="h-4 w-20 rounded-full bg-scrim" />
      <span className="flex items-center gap-1.5">
        {copy('phone.status.day', { day: formatCount(day) })}
        <svg aria-hidden="true" viewBox="0 0 16 12" className="h-3 w-4 fill-current">
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="4.5" y="5" width="3" height="7" rx="1" />
          <rect x="9" y="2" width="3" height="10" rx="1" />
          <rect x="13.5" y="0" width="2.5" height="12" rx="1" opacity="0.4" />
        </svg>
      </span>
    </div>
  )
}

/** Day 3, 8:00 PM; the cash widget; the app grid over the sky wallpaper and the skyline. */
function HomeScreen({ onOpen }: { readonly onOpen: (id: PhoneAppId) => void }) {
  const clock = useGameStore((state) => state.clock)
  const player = useGameStore((state) => state.player)
  const goals = useGameStore((state) => state.goals)
  const grants = useGameStore((state) => state.grants)
  const prestige = useGameStore((state) => state.prestige)
  const events = useGameStore((state) => state.events)
  const creator = useGameStore((state) => state.creator)
  const lastRentEvent = useGameStore((state) => state.lastRentEvent)
  const { minuteOfDay, day } = calendar(clock.minute, engineConfig)
  const updates = useMemo(
    () =>
      phoneUpdates(
        {
          save: { clock, player, goals, grants, prestige, events, creator },
          lastRentEvent,
          maxEvents: phoneConfig.updates.maxEvents,
        },
        engineConfig,
      ),
    [clock, player, goals, grants, prestige, events, creator, lastRentEvent],
  )
  const badge = badgeCount(updates.needsYou.length, phoneConfig.updates.badgeCap)
  const rent = copy('phone.widget.rent', {
    rent: formatMoney(rentFor(player.home, engineConfig)),
    day: formatCount(nextRentDueDay(clock.minute, engineConfig)),
  })
  const cash = formatMoney(player.cash)

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain bg-linear-to-b from-wall-top to-wall-bottom px-4 pb-3">
      <Skyline />
      <div className="relative flex items-start justify-between gap-2 pt-1 pb-2">
        <div className="flex flex-col gap-0.5">
          <p className="text-3xl leading-none font-extrabold tracking-tight text-fg">
            {formatGameTime(minuteOfDay)}
          </p>
          <p className="text-sm font-semibold text-fg">
            {copy('phone.home.date', { day: formatCount(day) })}
          </p>
        </div>
        <CloseButton />
      </div>
      <button
        type="button"
        data-phone-widget="bank"
        onClick={() => onOpen('bank')}
        aria-label={copy('phone.widget.label', { cash, rent })}
        className="relative mb-3 flex items-center justify-between gap-3 rounded-2xl border border-line glass px-4 py-2 text-left shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <span className="flex flex-col">
          <span className="text-xs font-bold text-muted uppercase">
            {copy('phone.widget.cash')}
          </span>
          <span className="text-xl font-extrabold text-fg">{cash}</span>
        </span>
        <span className="text-right text-xs font-semibold text-muted">{rent}</span>
      </button>
      <ul
        aria-label={copy('phone.home.apps')}
        className="relative grid grid-cols-4 gap-x-2 gap-y-2"
      >
        {phoneConfig.apps.map(({ id, icon }) => {
          const label = copy(APP_LABEL[id])
          const shown = id === 'updates' ? badge : null
          const count =
            shown === null
              ? null
              : shown.capped
                ? copy('phone.app.badgeCapped', { count: formatCount(shown.value) })
                : formatCount(shown.value)
          return (
            <li key={id} className="flex justify-center">
              <button
                type="button"
                data-phone-app={id}
                onClick={() => onOpen(id)}
                aria-label={
                  count === null ? label : copy('phone.app.badgeLabel', { app: label, count })
                }
                className="group flex w-full min-w-11 flex-col items-center gap-1 rounded-2xl py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <span
                  aria-hidden="true"
                  className="relative flex size-13 items-center justify-center rounded-2xl border border-line bg-surface text-[1.75rem] leading-none shadow-md transition-transform group-active:scale-95 motion-reduce:transition-none"
                >
                  {icon}
                  {count === null ? null : (
                    <span
                      data-phone-badge=""
                      className="absolute -top-1.5 -right-1.5 min-w-5 rounded-full border-2 border-surface bg-taxi px-1 text-center text-[0.6875rem] leading-4 font-extrabold text-on-taxi"
                    >
                      {count}
                    </span>
                  )}
                </span>
                <span
                  aria-hidden="true"
                  className="line-clamp-2 text-center text-[0.6875rem] leading-tight font-semibold text-fg"
                >
                  {label}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** A low skyline along the wallpaper's foot (decorative; our own shapes, no real building). */
function Skyline() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 360 90"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-24 w-full fill-current text-line-strong opacity-20"
    >
      <path d="M0 90 V64 V52 H18 V40 H32 V62 H48 V30 H60 V58 H80 V22 H90 V48 H106 V66 H120 V36 H138 V54 H150 V44 H166 V26 H176 V60 H194 V38 H208 V50 H220 V32 H236 V64 H250 V46 H268 V56 H280 V34 H296 V62 H310 V42 H332 V52 H350 V40 H360 V90Z" />
    </svg>
  )
}
