'use client'

import { useEffect, useRef, useState } from 'react'
import { PANEL_BUTTON } from '@/components/hud/PanelDialog'
import { writeAccountHandoff } from '@/lib/account/handoff'
import { GOOGLE_INTENT_KEY, parseCallback, type ParsedCallback } from '@/lib/account/callback'
import { copy, type CopyKey } from '@/lib/copy'
import { log } from '@/lib/log'
import { AUTH_CALLBACK_PATH } from '@/lib/supabase/env'
import { accountEnv, loadAccountAuth } from './accountEnv'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/account'

type View =
  | { readonly step: 'reading' }
  | {
      readonly step: 'ready'
      readonly parsed: Extract<ParsedCallback, { kind: 'finish' }>
      /** Why the last tap did not finish (offline), shown above the Finish button. */
      readonly notice: CopyKey | null
    }
  | { readonly step: 'working' }
  | { readonly step: 'done'; readonly kind: 'saved' | 'login' }
  | { readonly step: 'failed'; readonly key: CopyKey }

const ERROR_KEY = {
  'identity-exists': 'account.error.identityExists',
  expired: 'account.callback.expired',
  google: 'account.callback.googleFailed',
  invalid: 'account.callback.invalid',
} as const satisfies Record<string, CopyKey>

function takeGoogleIntent(): 'save' | 'login' {
  try {
    const intent = sessionStorage.getItem(GOOGLE_INTENT_KEY)
    sessionStorage.removeItem(GOOGLE_INTENT_KEY)
    return intent === 'save' ? 'save' : 'login'
  } catch {
    return 'login'
  }
}

/**
 * /auth/callback (S19). The URL is read once and wiped from the address bar and history at
 * once (`replaceState`), so the token never lingers or leaks. An email link waits for the
 * player's tap on Finish before using its one-time token (a mail scanner that opens the link
 * uses nothing up); Google's code is exchanged at once (only this browser can). Then the account
 * is this browser's, and "Back to the game" goes to the map: the game picks the session up, and
 * the welcome card asks only what the account does not already hold.
 */
export function AuthCallback() {
  const [view, setView] = useState<View>({ step: 'reading' })
  const title = useRef<HTMLHeadingElement>(null)

  const finish = async (parsed: Extract<ParsedCallback, { kind: 'finish' }>) => {
    const config = accountEnv()
    if (config === null) {
      setView({ step: 'failed', key: 'account.callback.unavailable' })
      return
    }
    setView({ step: 'working' })
    try {
      const auth = await loadAccountAuth()
      const result = await auth.finishCallback(config.env, parsed.params)
      if (!result.ok) {
        log.info('An account link did not finish', { code: result.code })
        if (result.code === 'offline' && parsed.params.kind === 'token') {
          // The token is still good: tap Finish again once back online.
          setView({ step: 'ready', parsed, notice: 'account.callback.offline' })
          return
        }
        setView({
          step: 'failed',
          key:
            result.code === 'offline'
              ? 'account.callback.offline'
              : parsed.params.kind === 'code'
                ? ERROR_KEY.google
                : ERROR_KEY.expired,
        })
        return
      }
      const kind =
        parsed.params.kind === 'token'
          ? parsed.params.type === 'email_change'
            ? 'saved'
            : 'login'
          : takeGoogleIntent() === 'save'
            ? 'saved'
            : 'login'
      const attestation = await auth.readServerAttestation(config.env)
      writeAccountHandoff({
        attestation:
          attestation?.attested === true && attestation.attestedAt !== null
            ? {
                attestedAt: attestation.attestedAt,
                consentVersion: attestation.consentVersion,
                consentedAt: attestation.consentedAt,
              }
            : null,
      })
      log.info('An account link finished', { kind })
      setView({ step: 'done', kind })
    } catch (error) {
      log.info('An account link did not finish', {
        error: error instanceof Error ? error.name : typeof error,
      })
      setView({ step: 'failed', key: 'account.callback.offline' })
    }
  }

  const loginWithGoogle = async () => {
    const config = accountEnv()
    if (config === null) return
    try {
      sessionStorage.setItem(GOOGLE_INTENT_KEY, 'login')
    } catch {
      // Without it the page still finishes the log-in; it only words the result as one.
    }
    const result = await (await loadAccountAuth()).signInWithGoogle(config.env, config.callback)
    if (!result.ok) setView({ step: 'failed', key: ERROR_KEY.google })
  }

  useEffect(() => {
    const parsed = parseCallback(window.location.search, window.location.hash)
    // The token is in the URL: out of the address bar and history before anything else runs.
    window.history.replaceState(null, '', AUTH_CALLBACK_PATH)
    if (parsed.kind === 'error') {
      log.info('An account link came back refused', { error: parsed.error })
      // The URL is only readable in the browser, after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of the URL on arrival
      setView({ step: 'failed', key: ERROR_KEY[parsed.error] })
    } else if (parsed.params.kind === 'code') {
      void finish(parsed)
    } else {
      setView({ step: 'ready', parsed, notice: null })
    }
  }, [])

  useEffect(() => title.current?.focus(), [view.step])

  const heading = (() => {
    switch (view.step) {
      case 'reading':
      case 'working':
        return copy('account.callback.working')
      case 'ready':
        return view.parsed.params.kind === 'token' && view.parsed.params.type === 'email_change'
          ? copy('account.callback.finishSave')
          : copy('account.callback.finishLogin')
      case 'done':
        return view.kind === 'saved'
          ? copy('account.saved.title')
          : copy('account.welcomeBack.title')
      case 'failed':
        return copy(view.key)
    }
  })()

  return (
    <section
      aria-labelledby="auth-callback-title"
      data-auth-callback={view.step}
      data-cc-feature="cc-feature:auth-callback"
      className="flex w-full max-w-md flex-col gap-3 rounded-3xl border border-line glass p-5 shadow-2xl"
    >
      <h1
        ref={title}
        id="auth-callback-title"
        tabIndex={-1}
        className="text-xl font-extrabold text-fg focus:outline-none"
      >
        {heading}
      </h1>
      {view.step === 'done' ? (
        <p role="status" className="text-sm text-fg">
          {view.kind === 'saved' ? copy('account.saved.body') : copy('account.welcomeBack.body')}
        </p>
      ) : null}
      {view.step === 'ready' && view.notice !== null ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {copy(view.notice)}
        </p>
      ) : null}
      {view.step === 'failed' && view.key === ERROR_KEY['identity-exists'] ? (
        <button
          type="button"
          onClick={() => void loginWithGoogle()}
          className={`${PANEL_BUTTON} bg-taxi text-on-taxi`}
        >
          {copy('account.error.googleLoginInstead')}
        </button>
      ) : null}
      {view.step === 'ready' ? (
        <button
          type="button"
          data-auth-finish=""
          onClick={() => void finish(view.parsed)}
          className={`${PANEL_BUTTON} bg-taxi text-on-taxi`}
        >
          {copy('account.callback.finish')}
        </button>
      ) : null}
      {view.step === 'working' || view.step === 'reading' ? (
        <p role="status" className="sr-only">
          {copy('account.callback.finishing')}
        </p>
      ) : null}
      {view.step === 'done' || view.step === 'failed' || view.step === 'ready' ? (
        // A full page load: the game boots fresh with the account's session.
        // eslint-disable-next-line @next/next/no-html-link-for-pages -- the game must boot anew
        <a
          href="/"
          data-auth-back=""
          className={`${PANEL_BUTTON} text-center ${view.step === 'done' ? 'bg-taxi text-on-taxi' : 'bg-raised text-fg'}`}
        >
          {copy('account.callback.back')}
        </a>
      ) : null}
    </section>
  )
}
