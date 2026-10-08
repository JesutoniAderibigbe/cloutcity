'use client'

import accountJson from '@data/config/account.json'
import { useEffect, useRef, useState } from 'react'
import { PANEL_BUTTON } from '@/components/hud/PanelDialog'
import { writeAccountHandoff } from '@/lib/account/handoff'
import {
  GOOGLE_INTENT_KEY,
  parseCallback,
  takeLoginRequested,
  type ParsedCallback,
} from '@/lib/account/callback'
import { maskEmail } from '@/lib/account/mask'
import { copy, type CopyKey } from '@/lib/copy'
import { log } from '@/lib/log'
import { AUTH_CALLBACK_PATH, type SupabaseEnv } from '@/lib/supabase/env'
import { accountEnv, loadAccountAuth } from './accountEnv'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/account'

type Finish = Extract<ParsedCallback, { kind: 'finish' }>
type DoneKind = 'saved' | 'saved-elsewhere' | 'open-elsewhere' | 'login' | 'declined'

type View =
  | { readonly step: 'reading' }
  | {
      readonly step: 'ready'
      readonly parsed: Finish
      /** Why the last tap did not finish (offline), shown above the Finish button. */
      readonly notice: CopyKey | null
    }
  | { readonly step: 'working' }
  | { readonly step: 'confirm'; readonly maskedEmail: string | null }
  | { readonly step: 'done'; readonly kind: DoneKind }
  | { readonly step: 'failed'; readonly key: CopyKey }

const ERROR_KEY = {
  'identity-exists': 'account.error.identityExists',
  expired: 'account.callback.expired',
  google: 'account.callback.googleFailed',
  invalid: 'account.callback.invalid',
} as const satisfies Record<string, CopyKey>

const DONE: Readonly<Record<DoneKind, { title: CopyKey; body: CopyKey }>> = {
  saved: { title: 'account.saved.title', body: 'account.saved.body' },
  'saved-elsewhere': { title: 'account.savedElsewhere.title', body: 'account.savedElsewhere.body' },
  'open-elsewhere': {
    title: 'account.callback.openElsewhereTitle',
    body: 'account.callback.openElsewhereBody',
  },
  login: { title: 'account.welcomeBack.title', body: 'account.welcomeBack.body' },
  declined: { title: 'account.callback.declinedTitle', body: 'account.callback.declinedBody' },
}

function takeGoogleIntent(): 'save' | 'login' {
  try {
    const intent = sessionStorage.getItem(GOOGLE_INTENT_KEY)
    sessionStorage.removeItem(GOOGLE_INTENT_KEY)
    return intent === 'save' ? 'save' : 'login'
  } catch {
    return 'login'
  }
}

/** Tells the game page this tab hands over to what the logged-in account already holds. */
async function handOff(env: SupabaseEnv): Promise<void> {
  const auth = await loadAccountAuth()
  const attestation = await auth.readServerAttestation(env)
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
}

/**
 * /auth/callback (S19). Our links carry their one-time token in the URL fragment (never sent to
 * a server); the page reads it once and wipes it from the address bar and history at once. An
 * email link waits for the player's tap on Finish, naming the address (masked) it is for, so a
 * mail scanner that opens the link uses nothing up. Then:
 *  - a save confirmation that is this browser's own guest saves it here; anyone else's (another
 *    device, or someone who asked to save *their* game with this address) is confirmed without
 *    this browser ever taking that account (review F1);
 *  - a log-in this browser asked for signs in; one it did not ask for asks "Log in as …?" first
 *    (review F2);
 *  - Google's code is exchanged at once (only the browser that started it can).
 * "Back to the game" goes to the map, which picks the session up.
 */
export function AuthCallback() {
  const [view, setView] = useState<View>({ step: 'reading' })
  const title = useRef<HTMLHeadingElement>(null)

  const finish = async (parsed: Finish) => {
    const config = accountEnv()
    if (config === null) {
      setView({ step: 'failed', key: 'account.callback.unavailable' })
      return
    }
    setView({ step: 'working' })
    try {
      const auth = await loadAccountAuth()
      const now = Date.now()
      const isLogin = parsed.params.kind === 'token' && parsed.params.type !== 'email_change'
      const { accountStore, upgradePending } = await import('@/state/account')
      const pending = accountStore.getState()
      const result = await auth.finishCallback(config.env, parsed.params, {
        loginHash: isLogin ? takeLoginRequested(now, accountJson.pendingUpgradeMaxAgeMs) : null,
        pendingHash: upgradePending(pending.pendingUpgradeAt, now)
          ? (pending.pendingUpgradeHash ?? null)
          : null,
        linkEmail: parsed.email,
      })
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
      log.info('An account link finished', { outcome: result.outcome })
      if (result.outcome === 'confirm-login') {
        setView({ step: 'confirm', maskedEmail: result.maskedEmail })
        return
      }
      if (result.outcome === 'saved-elsewhere' || result.outcome === 'open-elsewhere') {
        setView({ step: 'done', kind: result.outcome })
        return
      }
      const kind =
        result.outcome === 'saved' ||
        (parsed.params.kind === 'code' && takeGoogleIntent() === 'save')
          ? 'saved'
          : 'login'
      await handOff(config.env)
      setView({ step: 'done', kind })
    } catch (error) {
      log.info('An account link did not finish', {
        error: error instanceof Error ? error.name : typeof error,
      })
      setView({ step: 'failed', key: 'account.callback.offline' })
    }
  }

  const answer = async (yes: boolean) => {
    const config = accountEnv()
    if (config === null) return
    setView({ step: 'working' })
    const auth = await loadAccountAuth()
    if (!yes) {
      await auth.declinePendingLogin()
      log.info('A log-in link was turned down')
      setView({ step: 'done', kind: 'declined' })
      return
    }
    const result = await auth.confirmPendingLogin(config.env)
    if (!result.ok) {
      setView({ step: 'failed', key: ERROR_KEY.expired })
      return
    }
    await handOff(config.env)
    setView({ step: 'done', kind: 'login' })
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
      case 'confirm':
        return view.maskedEmail === null
          ? copy('account.callback.confirmTitleNoEmail')
          : copy('account.callback.confirmTitle', { email: view.maskedEmail })
      case 'done':
        return copy(DONE[view.kind].title)
      case 'failed':
        return copy(view.key)
    }
  })()

  // Only a save link names its address before the tap (it is used only where that address was
  // asked for); a log-in link's fragment is not trusted for display (review N1): the server's
  // address is shown after verifying.
  const readyFor =
    view.step === 'ready' &&
    view.parsed.email !== null &&
    view.parsed.params.kind === 'token' &&
    view.parsed.params.type === 'email_change'
      ? maskEmail(view.parsed.email)
      : null

  return (
    <section
      aria-labelledby="auth-callback-title"
      data-auth-callback={view.step === 'done' ? view.kind : view.step}
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
      {view.step === 'ready' && readyFor !== null ? (
        <p data-auth-for="" className="text-sm text-fg">
          {copy('account.callback.saveFor', { email: readyFor })}
        </p>
      ) : null}
      {view.step === 'done' ? (
        <p role="status" className="text-sm text-fg">
          {copy(DONE[view.kind].body)}
        </p>
      ) : null}
      {view.step === 'confirm' ? (
        <>
          <p className="text-sm text-fg">{copy('account.callback.confirmBody')}</p>
          <button
            type="button"
            data-auth-confirm="yes"
            onClick={() => void answer(true)}
            className={`${PANEL_BUTTON} bg-taxi text-on-taxi`}
          >
            {copy('account.callback.confirmYes')}
          </button>
          <button
            type="button"
            data-auth-confirm="no"
            onClick={() => void answer(false)}
            className={`${PANEL_BUTTON} bg-raised text-fg`}
          >
            {copy('account.callback.confirmNo')}
          </button>
        </>
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
