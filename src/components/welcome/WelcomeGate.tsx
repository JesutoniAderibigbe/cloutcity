'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { lazyIsland } from '@/components/overlay/lazyIsland'
import { useModalPresence } from '@/components/overlay/modalState'
import { trapTab } from '@/components/overlay/trapTab'
import { deriveGateStatus } from '@/engine/ageGate'
import { copy } from '@/lib/copy'
import { supabaseEnv } from '@/lib/supabase/env'
import { entryStore, setSignedIn, storedAccountSession } from '@/state/entry'
import { onboardingStore } from '@/state/onboarding'
import { startGuestSession } from '@/state/session'
import { browserLocalStorage } from '@/state/storage'
import { AgeLockNotice } from './AgeLockNotice'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/welcome'

// DEC-62: sign-up and log-in load with the account chunk (and supabase-js) only when tapped.
const AuthScreen = lazyIsland(
  () => import('@/components/account/AuthScreen').then((module) => module.AuthScreen),
  { zone: 'sheet', labelKey: 'loading.account' },
)

// A build with no Supabase (local development, the default e2e suite) has no accounts: it keeps
// the S05a welcome card (18+ check, consent, sound) and plays solo on this device.
const WelcomeCard = lazyIsland(() => import('./WelcomeCard').then((module) => module.WelcomeCard), {
  zone: 'sheet',
  labelKey: 'loading.welcome',
})

export type EntryView =
  'pending' | 'locked' | 'landing' | 'signup' | 'login' | 'finish' | 'welcome' | 'open'

/**
 * Where the visitor is (DEC-62). With accounts (Supabase configured): the landing until an
 * account is signed in here and its welcome steps are done (the 18+ check and consent on the
 * server, the sound choice on this device); a signed-in account whose sound choice this device
 * has not made yet finishes it. Without: the welcome card until it is done. An under-age lock
 * holds in both.
 */
export function entryViewFor(
  gate: ReturnType<typeof deriveGateStatus>,
  signedIn: boolean | undefined,
  accounts: boolean,
): Exclude<EntryView, 'signup' | 'login'> {
  if (gate === 'pending') return 'pending'
  if (gate === 'locked') return 'locked'
  if (!accounts) return gate === 'done' ? 'open' : 'welcome'
  if (signedIn === undefined) return 'pending'
  if (!signedIn) return 'landing'
  return gate === 'done' ? 'open' : 'finish'
}

/**
 * The screen shown once the player has picked Sign up or Log in: that screen stays until its
 * last step says it is done, even when the account signs in (or the device's welcome steps
 * complete) part-way through it. Only an under-age lock replaces it.
 */
export function viewWithPick(
  base: Exclude<EntryView, 'signup' | 'login'>,
  picked: 'signup' | 'login' | null,
): EntryView {
  if (picked === null || base === 'locked' || base === 'pending' || base === 'welcome') return base
  return picked
}

const gateStatus = () => deriveGateStatus(onboardingStore.getState().record, Date.now())
// The server cannot know what this device stored; render nothing until the client reads it,
// so a returning player never sees the landing flash.
const serverGateStatus = () => 'pending' as const
const signedInState = () => entryStore.getState().signedIn
const serverSignedIn = () => undefined
const onOnlineChange = (listener: () => void) => {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
  }
}
const isOnline = () => navigator.onLine
const serverOnline = () => true

/** The landing card (DEC-62, like Lagos Life): the live city behind, "Sign up" and "Log in". */
function Landing({
  titleId,
  bodyId,
  onPick,
}: {
  readonly titleId: string
  readonly bodyId: string
  readonly onPick: (view: 'signup' | 'login') => void
}) {
  const title = useRef<HTMLHeadingElement>(null)
  // A first visit with no connection: signing up or logging in needs one (DEC-62); a returning
  // signed-in player never sees the landing and plays offline.
  const online = useSyncExternalStore(onOnlineChange, isOnline, serverOnline)
  useEffect(() => title.current?.focus(), [])
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2
          ref={title}
          id={titleId}
          tabIndex={-1}
          className="text-2xl font-extrabold tracking-tight text-fg focus:outline-none"
        >
          {copy('welcome.landing.title')}
        </h2>
        <p id={bodyId} className="text-sm text-muted">
          {copy('welcome.landing.body')}
        </p>
      </div>
      {online ? null : (
        <p role="status" data-landing-offline="" className="text-sm font-semibold text-fg">
          {copy('welcome.landing.offline')}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          data-landing="signup"
          onClick={() => onPick('signup')}
          className="min-h-12 flex-1 rounded-full bg-taxi px-5 text-base font-extrabold text-on-taxi focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {copy('welcome.landing.signup')}
        </button>
        <button
          type="button"
          data-landing="login"
          onClick={() => onPick('login')}
          className="min-h-12 rounded-full border border-line bg-raised px-5 text-base font-bold text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {copy('welcome.landing.login')}
        </button>
      </div>
    </div>
  )
}

/**
 * The entry gate (S05a, DEC-62), over the already-loading live city. With accounts it is the
 * landing ("Sign up" / "Log in"), then the sign-up or log-in screen, until an account is signed
 * in on this device and its welcome steps are done; without, the welcome card. An under-age
 * answer locks it for `underAgeLockHours`. There is no close button: the gate is the way in. A
 * returning signed-in player sees nothing (and plays offline too). Loaded as a boot island by
 * WelcomeMount (DEC-11); the forms load lazily.
 */
export function WelcomeGate() {
  const gate = useSyncExternalStore(onboardingStore.subscribe, gateStatus, serverGateStatus)
  const signedIn = useSyncExternalStore(entryStore.subscribe, signedInState, serverSignedIn)
  const [accounts] = useState(() => supabaseEnv() !== null)
  const [picked, setPicked] = useState<'signup' | 'login' | null>(null)
  // Signed out (another tab, or the Me tab): the landing comes back, never a guest. Adjusted
  // while rendering (React's "storing information from previous renders"), not in an effect.
  const [lastSignedIn, setLastSignedIn] = useState(signedIn)
  if (lastSignedIn !== signedIn) {
    setLastSignedIn(signedIn)
    if (signedIn === false) setPicked(null)
  }
  const base = entryViewFor(gate, signedIn, accounts)
  const view = viewWithPick(base, picked)
  const open = view !== 'open' && view !== 'pending'
  useModalPresence(open)
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = dialog.current
    if (!open || element === null) return
    const onKeyDown = (event: KeyboardEvent) => trapTab(element, event)
    element.addEventListener('keydown', onKeyDown)
    return () => element.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEffect(() => {
    const { clearExpiredLock } = onboardingStore.getState()
    clearExpiredLock(Date.now())
    setSignedIn(storedAccountSession(browserLocalStorage()))
    // A returning player's session starts on boot; a new one's once the gate is done.
    if (onboardingStore.getState().record?.status === 'complete') startGuestSession()
  }, [])

  // Closed: an empty marker records that the boot island has decided (e2e specs wait for it
  // before driving the page, which stays inert while the island loads).
  if (!open) return <span hidden data-welcome-gate={view === 'open' ? 'done' : view} />

  const ids =
    view === 'locked'
      ? { title: 'age-gate-title', description: 'age-gate-body' }
      : { title: 'welcome-title', description: 'welcome-intro' }
  // The landing sits low over the city like Lagos Life's; the forms take the screen.
  const frame =
    view === 'landing' || view === 'locked'
      ? 'self-end mb-2 max-w-[var(--overlay-sheet-max-w)] rounded-3xl border border-line glass p-5 shadow-2xl'
      : view === 'welcome'
        ? 'self-center max-w-[var(--overlay-sheet-max-w)] rounded-3xl border border-line glass p-5 shadow-2xl'
        : 'h-full self-stretch bg-canvas'

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby={ids.title}
      aria-describedby={ids.description}
      data-welcome-dialog={view}
      data-welcome-gate={view}
      data-cc-feature="cc-feature:welcome"
      className={`pointer-events-auto max-h-full w-full overflow-y-auto overscroll-contain ${frame}`}
    >
      {view === 'locked' ? (
        <AgeLockNotice titleId={ids.title} bodyId={ids.description} />
      ) : view === 'landing' ? (
        <Landing titleId={ids.title} bodyId={ids.description} onPick={setPicked} />
      ) : view === 'welcome' ? (
        <WelcomeCard titleId={ids.title} introId={ids.description} />
      ) : (
        <AuthScreen
          titleId={ids.title}
          introId={ids.description}
          start={view}
          onBack={() => setPicked(null)}
          onSwitch={setPicked}
          onFinished={() => setPicked(null)}
        />
      )}
    </div>
  )
}
