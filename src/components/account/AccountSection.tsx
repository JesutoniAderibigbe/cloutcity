'use client'

import { useState } from 'react'
import { useStore } from 'zustand'
import { PANEL_BUTTON, PanelStatus } from '@/components/hud/PanelDialog'
import { copy } from '@/lib/copy'
import { ACCOUNT_ERROR_KEY } from '@/lib/forms/account'
import { log } from '@/lib/log'
import { accountIdentityStore, accountStore } from '@/state/account'
import { openAccountSheet } from '@/state/accountSheet'
import type { GuestSessionState } from '@/state/guestSession'
import { gameStore } from '@/state/store'
import { syncStatusText } from '@/components/sync/syncCopy'
import { useSyncStatus } from '@/state/syncStatus'
import { GuestWarning } from './AccountBits'
import { accountEnv } from './accountEnv'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/account'

const LINK_BUTTON =
  'min-h-11 self-start text-sm font-semibold text-taxi-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'

function Guest() {
  const pendingAt = useStore(accountStore, (state) => state.pendingUpgradeAt)
  return (
    <>
      <h3 id="me-account-title" className="font-bold text-fg">
        {copy('account.me.guestTitle')}
      </h3>
      <p className="text-sm text-muted">{copy('account.me.guestBody')}</p>
      <GuestWarning />
      {pendingAt !== null ? (
        <p data-account-pending="" className="text-sm text-muted">
          {copy('account.me.pendingNoEmail')}
        </p>
      ) : null}
      <button
        type="button"
        data-account-create=""
        onClick={() => openAccountSheet('save')}
        className={`${PANEL_BUTTON} self-start bg-taxi text-on-taxi`}
      >
        {copy('account.me.create')}
      </button>
      <button type="button" onClick={() => openAccountSheet('login')} className={LINK_BUTTON}>
        {copy('account.me.login')}
      </button>
    </>
  )
}

type SignOutState =
  | { readonly step: 'idle' }
  | { readonly step: 'working' }
  | { readonly step: 'unsent' }
  | {
      readonly step: 'failed'
      readonly key: (typeof ACCOUNT_ERROR_KEY)[keyof typeof ACCOUNT_ERROR_KEY]
    }

function SignedIn() {
  const identity = useStore(accountIdentityStore, (state) => state.identity)
  const sync = useSyncStatus()
  const [state, setState] = useState<SignOutState>({ step: 'idle' })

  const signOut = async (force: boolean) => {
    setState({ step: 'working' })
    try {
      const account = await import('@/lib/supabase/accountSession')
      const session = account.runningAccountSession()
      if (session === undefined) throw new Error('No account session is running')
      const result = await session.signOut(force)
      if (result.ok) return
      if (result.code === 'unsent') {
        setState({ step: 'unsent' })
        return
      }
      log.info('Sign-out did not go through', { code: result.code })
      setState({ step: 'failed', key: ACCOUNT_ERROR_KEY[result.code] })
    } catch (error) {
      log.info('Sign-out did not go through', {
        error: error instanceof Error ? error.name : typeof error,
      })
      setState({ step: 'failed', key: ACCOUNT_ERROR_KEY.error })
    }
  }

  const who =
    identity?.maskedEmail == null
      ? copy('account.me.signedIn')
      : identity.provider === 'google'
        ? copy('account.me.signedInGoogle', { email: identity.maskedEmail })
        : copy('account.me.signedInAs', { email: identity.maskedEmail })

  return (
    <>
      <h3 id="me-account-title" data-account-signed-in="" className="font-bold text-fg">
        {who}
      </h3>
      <p data-account-sync="" className="text-sm text-muted">
        {syncStatusText(sync.status, sync.identity)}
      </p>
      {state.step === 'unsent' ? (
        <div role="alert" className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-fg">{copy('account.me.unsent')}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void signOut(true)}
              className={`${PANEL_BUTTON} bg-raised text-fg`}
            >
              {copy('account.me.signOutAnyway')}
            </button>
            <button
              type="button"
              onClick={() => setState({ step: 'idle' })}
              className={`${PANEL_BUTTON} bg-taxi text-on-taxi`}
            >
              {copy('account.me.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          data-account-sign-out=""
          aria-disabled={state.step === 'working' ? true : undefined}
          onClick={() => {
            if (state.step !== 'working') void signOut(false)
          }}
          className={`${PANEL_BUTTON} self-start bg-raised text-fg`}
        >
          {state.step === 'working' ? copy('account.me.signingOut') : copy('account.me.signOut')}
        </button>
      )}
      <PanelStatus text={state.step === 'failed' ? copy(state.key) : null} />
    </>
  )
}

function SignedOut() {
  const [confirming, setConfirming] = useState(false)
  const startOver = () => {
    gameStore.getState().startNewGame()
    accountStore.getState().setSignedOut(false)
    log.info('Starting a new guest game after signing out')
    // A fresh page starts the new guest session the usual way (src/state/session.ts).
    window.location.reload()
  }
  return (
    <>
      <h3 id="me-account-title" className="font-bold text-fg">
        {copy('account.me.signedOutTitle')}
      </h3>
      <p className="text-sm text-muted">{copy('account.me.signedOutBody')}</p>
      <button
        type="button"
        onClick={() => openAccountSheet('login')}
        className={`${PANEL_BUTTON} self-start bg-taxi text-on-taxi`}
      >
        {copy('account.sheet.loginTitle')}
      </button>
      {confirming ? (
        <div role="alert" className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-fg">{copy('account.me.newGuestConfirm')}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-account-new-guest-confirm=""
              onClick={startOver}
              className={`${PANEL_BUTTON} bg-raised text-fg`}
            >
              {copy('account.me.newGuestYes')}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className={`${PANEL_BUTTON} bg-taxi text-on-taxi`}
            >
              {copy('account.me.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          data-account-new-guest=""
          onClick={() => setConfirming(true)}
          className={LINK_BUTTON}
        >
          {copy('account.me.newGuest')}
        </button>
      )}
    </>
  )
}

/**
 * The Me panel's account section (S19), at its top: a guest sees the warning that clearing
 * browser data wipes a guest game, "Create account" and "Have an account? Log in"; a saved
 * account sees who is signed in (the email masked) and "Sign out"; after signing out, "Log in"
 * and "Start a new guest game". Nothing shows when this build has no accounts or there is no
 * session for another reason (the panel's not-connected state says why).
 */
export function AccountSection({ session }: { readonly session: GuestSessionState }) {
  if (accountEnv() === null) return null
  const view =
    session.status === 'anonymous'
      ? 'guest'
      : session.status === 'permanent'
        ? 'account'
        : session.reason === 'signed-out'
          ? 'signed-out'
          : null
  if (view === null) return null
  return (
    <section
      data-me-account={view}
      aria-labelledby="me-account-title"
      className="flex flex-col gap-1.5 rounded-xl bg-raised p-3"
    >
      {view === 'guest' ? <Guest /> : view === 'account' ? <SignedIn /> : <SignedOut />}
    </section>
  )
}
