'use client'

import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { PANEL_BUTTON, PanelDialog } from '@/components/hud/PanelDialog'
import { copy } from '@/lib/copy'
import { accountIdentityStore, accountStore } from '@/state/account'
import { accountSheetStore, openAccountSheet, useAccountSheet } from '@/state/accountSheet'
import { guestSessionStore, type GuestSessionState } from '@/state/guestSession'
import { closeHudPanel } from '@/state/hudPanel'
import { CarryOver, GuestWarning } from './AccountBits'
import { AccountFlow } from './AccountFlow'
import { accountEnv } from './accountEnv'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/account'

function Done({ kind }: { readonly kind: 'saved' | 'login' }) {
  return (
    <section
      aria-labelledby="account-done-title"
      data-account-done={kind}
      className="flex flex-col gap-2"
    >
      <h3 id="account-done-title" className="font-bold text-fg">
        {kind === 'saved' ? copy('account.saved.title') : copy('account.welcomeBack.title')}
      </h3>
      <p role="status" className="text-sm text-fg">
        {kind === 'saved' ? copy('account.saved.body') : copy('account.welcomeBack.body')}
      </p>
      <button
        type="button"
        onClick={closeHudPanel}
        className={`${PANEL_BUTTON} self-start bg-taxi text-on-taxi`}
      >
        {copy('account.done')}
      </button>
    </section>
  )
}

/** Why the sheet cannot act yet (or at all), in plain words; null when it can. */
function blockedKey(session: GuestSessionState, mode: 'save' | 'login') {
  if (accountEnv() === null || session.reason === 'no-config') return 'account.sheet.unavailable'
  if (session.status === 'local' && session.reason === 'offline') return 'account.sheet.offlineNow'
  if (mode === 'login') return null
  if (session.status === 'idle' || session.status === 'connecting') return 'account.sheet.preparing'
  if (session.status === 'local' && session.reason === null) return 'account.sheet.preparing'
  if (session.status === 'local') return 'account.sheet.offlineNow'
  return null
}

/**
 * The account sheet (S19) in the sheet zone, opened as "Create account" (save mode: the guest's
 * progress, attestation and consent move to an account with the same user id) or "Log in" (this
 * device switches to an existing account; S18c's conflict sheet asks when both have progress).
 * Google or an email link; logging in also takes the emailed 6-digit code.
 */
export function AccountSheet() {
  const { mode, email } = useAccountSheet()
  const session = useStore(guestSessionStore)
  const identity = useStore(accountIdentityStore, (state) => state.identity)
  const pendingAt = useStore(accountStore, (state) => state.pendingUpgradeAt)
  const [done, setDone] = useState<'saved' | 'login' | null>(null)
  const seen = useRef(identity)

  // The account changed while the sheet was open: a guest's link was opened (here or on another
  // device), Google was linked, or this device logged in, so the sheet says so.
  useEffect(() => {
    const before = seen.current
    seen.current = identity
    if (before === null || identity === null || !identity.permanent) return
    if (before.userId === identity.userId && !before.permanent) setDone('saved')
    else if (before.userId !== identity.userId) setDone('login')
  }, [identity])

  const title = mode === 'save' ? copy('account.sheet.saveTitle') : copy('account.sheet.loginTitle')
  const blocked = blockedKey(session, mode)
  const signedOut = session.reason === 'signed-out'
  const pending = mode === 'save' && pendingAt !== null

  const body = (() => {
    if (done !== null) return <Done kind={done} />
    if (mode === 'save' && session.status === 'permanent') {
      return <p className="text-sm text-fg">{copy('account.sheet.alreadySaved')}</p>
    }
    if (mode === 'save' && signedOut) {
      return (
        <>
          <p className="text-sm text-fg">{copy('account.me.signedOutBody')}</p>
          <button
            type="button"
            onClick={() => openAccountSheet('login')}
            className={`${PANEL_BUTTON} self-start bg-taxi text-on-taxi`}
          >
            {copy('account.me.login')}
          </button>
        </>
      )
    }
    if (blocked !== null) {
      return (
        <p role="status" data-account-blocked={blocked} className="text-sm text-fg">
          {copy(blocked)}
        </p>
      )
    }
    return (
      <>
        <p className="text-sm text-fg">
          {mode === 'save' ? copy('account.sheet.saveIntro') : copy('account.sheet.loginIntro')}
        </p>
        {mode === 'save' ? (
          <GuestWarning />
        ) : session.status === 'anonymous' ? (
          <p className="text-sm text-muted">{copy('account.sheet.loginSwitch')}</p>
        ) : null}
        {pending ? (
          <p data-account-pending="" className="text-sm text-muted">
            {copy('account.me.pendingNoEmail')}
          </p>
        ) : null}
        <AccountFlow
          key={`${mode}:${email ?? ''}`}
          mode={mode}
          initialEmail={email}
          onLoginInstead={(typed) => openAccountSheet('login', typed)}
          onLinkSent={() => {
            accountStore.getState().setPendingUpgrade(Date.now())
            void import('@/lib/supabase/accountSession').then((module) =>
              module.runningAccountSession()?.watchUpgrade(),
            )
          }}
          onLoggedIn={() => {
            setDone('login')
            // A signed-out device has no coordinator yet: the account just logged in starts one.
            const config = accountEnv()
            if (config === null) return
            void import('@/lib/supabase/accountSession').then((module) =>
              module.ensureAccountSession(config.env),
            )
          }}
        />
        {mode === 'save' ? <CarryOver /> : null}
        {mode === 'save' ? (
          <button
            type="button"
            onClick={() => openAccountSheet('login', accountSheetStore.getState().email)}
            className="min-h-11 self-start text-sm font-semibold text-taxi-ink underline underline-offset-2"
          >
            {copy('account.sheet.toLogin')}
          </button>
        ) : session.status === 'anonymous' ? (
          <button
            type="button"
            onClick={() => openAccountSheet('save')}
            className="min-h-11 self-start text-sm font-semibold text-taxi-ink underline underline-offset-2"
          >
            {copy('account.sheet.toSave')}
          </button>
        ) : null}
      </>
    )
  })()

  return (
    <PanelDialog
      title={title}
      panel="account"
      feature="cc-feature:account-sheet"
      onClose={closeHudPanel}
      scrollBody
    >
      <div data-account-sheet={mode} className="flex flex-col gap-2">
        {body}
      </div>
    </PanelDialog>
  )
}
