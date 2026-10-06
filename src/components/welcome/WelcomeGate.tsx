'use client'

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useModalPresence } from '@/components/overlay/modalState'
import { deriveGateStatus, type GateStatus } from '@/engine/ageGate'
import { onboardingStore } from '@/state/onboarding'
import { startGuestSession } from '@/state/session'
import { AgeLockNotice } from './AgeLockNotice'
import { WelcomeCard } from './WelcomeCard'

const gateStatus = (): GateStatus => deriveGateStatus(onboardingStore.getState().record, Date.now())
// The server cannot know what this device stored; render nothing until the client reads it,
// so a returning player never sees the card flash.
const serverGateStatus = (): GateStatus => 'pending'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Keeps Tab and Shift+Tab inside the dialog. The rest of the page is inert, but without this
 * focus would leave for the browser's own UI after the last control.
 */
function trapTab(dialog: HTMLElement, event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
  const first = focusables[0]
  const last = focusables.at(-1)
  if (first === undefined || last === undefined) {
    event.preventDefault()
    return
  }
  const active = document.activeElement
  const inside = focusables.some((element) => element === active)
  if (event.shiftKey && (active === first || !inside)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

/**
 * The first-visit welcome card (S05a), over the already-loading map. It shows until this
 * device has a passing 18+ attestation, or the under-age lock screen while a lock holds, and
 * nothing for a returning player. There is no close button and Escape does nothing: the card is
 * the way in.
 */
export function WelcomeGate() {
  const status = useSyncExternalStore(onboardingStore.subscribe, gateStatus, serverGateStatus)
  const open = status === 'welcome' || status === 'locked'
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

  if (!open) return null

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
      className="pointer-events-auto max-h-full w-full max-w-[var(--overlay-sheet-max-w)] self-center overflow-y-auto overscroll-contain rounded-3xl border border-night-700 bg-night-900 p-5 shadow-2xl"
    >
      {status === 'welcome' ? (
        <WelcomeCard titleId={ids.title} introId={ids.description} />
      ) : (
        <AgeLockNotice titleId={ids.title} bodyId={ids.description} />
      )}
    </div>
  )
}
