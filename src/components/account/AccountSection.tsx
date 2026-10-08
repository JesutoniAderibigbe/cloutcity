'use client'

import { useState } from 'react'
import { useStore } from 'zustand'
import { PANEL_BUTTON, PanelStatus } from '@/components/hud/PanelDialog'
import { copy } from '@/lib/copy'
import { ACCOUNT_ERROR_KEY } from '@/lib/forms/account'
import { log } from '@/lib/log'
import { syncStatusText } from '@/components/sync/syncCopy'
import { accountIdentityStore } from '@/state/account'
import type { GuestSessionState } from '@/state/guestSession'
import { useSyncStatus } from '@/state/syncStatus'
import { accountEnv } from './accountEnv'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/account'

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

/**
 * The Me panel's account section (S19, DEC-62), at its top: who is signed in (the email masked)
 * and "Sign out", which first gives unsent progress a moment to reach the account. Signing out
 * brings the landing back: nobody plays on as a guest. Nothing shows without accounts in this
 * build or before the session connects.
 */
export function AccountSection({ session }: { readonly session: GuestSessionState }) {
  if (accountEnv() === null || session.status !== 'permanent') return null
  return (
    <section
      data-me-account="account"
      aria-labelledby="me-account-title"
      className="flex flex-col gap-1.5 rounded-xl bg-raised p-3"
    >
      <SignedIn />
    </section>
  )
}
