'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { lazyIsland } from '@/components/overlay/lazyIsland'
import { useModalPresence } from '@/components/overlay/modalState'
import { trapTab } from '@/components/overlay/trapTab'
import { deriveGateStatus, type GateStatus } from '@/engine/ageGate'
import {
  clearAccountHandoff,
  readAccountHandoff,
  type AccountAttestation,
} from '@/lib/account/handoff'
import { authCallbackUrl, supabaseEnv } from '@/lib/supabase/env'
import { onboardingStore } from '@/state/onboarding'
import { startGuestSession } from '@/state/session'
import { AgeLockNotice } from './AgeLockNotice'
import { WelcomeCard } from './WelcomeCard'

// S19: "Have an account? Log in" swaps the card for the log-in form, which loads with the account
// chunk (and supabase-js) only when tapped. No guest is created first.
const WelcomeLogin = lazyIsland(
  () => import('@/components/account/WelcomeLogin').then((module) => module.WelcomeLogin),
  { zone: 'sheet', labelKey: 'loading.account' },
)

/** Account links can work in this build: Supabase and the site URL are both configured. */
const accountsConfigured = () => supabaseEnv() !== null && authCallbackUrl() !== null

const gateStatus = (): GateStatus => deriveGateStatus(onboardingStore.getState().record, Date.now())
// The server cannot know what this device stored; render nothing until the client reads it,
// so a returning player never sees the card flash.
const serverGateStatus = (): GateStatus => 'pending'

/**
 * The first-visit welcome card (S05a), over the already-loading map. It shows until this
 * device has a passing 18+ attestation, or the under-age lock screen while a lock holds, and
 * nothing for a returning player. There is no close button and Escape does nothing: the card is
 * the way in. Loaded as a boot island by WelcomeMount (DEC-11).
 */
export function WelcomeGate() {
  const status = useSyncExternalStore(onboardingStore.subscribe, gateStatus, serverGateStatus)
  const open = status === 'welcome' || status === 'locked'
  const [view, setView] = useState<'card' | 'login'>('card')
  // Client-only (the gate renders nothing on the server), so reading sessionStorage here is safe.
  const [handoff] = useState(readAccountHandoff)
  const [account, setAccount] = useState<AccountAttestation | null>(handoff?.attestation ?? null)
  /** This tab logged in to an account before finishing the card (here, or via /auth/callback). */
  const loggedIn = useRef(handoff !== null)
  const [accounts] = useState(accountsConfigured)
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
    // A returning player's session starts on boot; a new one's when the card is completed.
    if (onboardingStore.getState().record?.status === 'complete') startGuestSession()
  }, [])

  // The hand-off from /auth/callback is spent once the card is done.
  useEffect(() => {
    if (status !== 'pending' && !open && loggedIn.current) clearAccountHandoff()
  }, [status, open])

  // An under-age answer after logging in (a brand-new Google account has no 18+ check yet): the
  // account's session is dropped from this device, so nothing under it runs here.
  useEffect(() => {
    if (status !== 'locked' || !loggedIn.current) return
    loggedIn.current = false
    clearAccountHandoff()
    const env = supabaseEnv()
    if (env === null) return
    void import('@/lib/supabase/accountAuth').then((auth) => auth.signOutLocal(env))
  }, [status])

  // Closed: an empty marker records that the boot island has decided (e2e specs wait for it
  // before driving the page, which stays inert while the island loads).
  if (!open) return <span hidden data-welcome-gate={status} />

  const ids =
    status === 'welcome'
      ? { title: 'welcome-title', description: 'welcome-intro' }
      : { title: 'age-gate-title', description: 'age-gate-body' }

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby={ids.title}
      aria-describedby={ids.description}
      data-welcome-dialog={status}
      data-welcome-gate={status}
      data-cc-feature="cc-feature:welcome"
      className="pointer-events-auto max-h-full w-full max-w-[var(--overlay-sheet-max-w)] self-center overflow-y-auto overscroll-contain rounded-3xl border border-line glass p-5 shadow-2xl"
    >
      {status === 'welcome' && view === 'login' ? (
        <WelcomeLogin
          titleId={ids.title}
          introId={ids.description}
          onBack={() => setView('card')}
          onLoggedIn={(attestation) => {
            loggedIn.current = true
            setAccount(attestation)
            setView('card')
          }}
        />
      ) : status === 'welcome' ? (
        <WelcomeCard
          titleId={ids.title}
          introId={ids.description}
          account={account}
          onLogin={accounts ? () => setView('login') : undefined}
        />
      ) : (
        <AgeLockNotice titleId={ids.title} bodyId={ids.description} />
      )}
    </div>
  )
}
