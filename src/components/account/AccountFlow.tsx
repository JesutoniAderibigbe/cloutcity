'use client'

import accountJson from '@data/config/account.json'
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { PANEL_BUTTON } from '@/components/hud/PanelDialog'
import { copy } from '@/lib/copy'
import { GOOGLE_INTENT_KEY } from '@/lib/account/callback'
import { maskEmail } from '@/lib/account/mask'
import type { AccountConfig } from '@/lib/data/schemas/config'
import { fieldErrors } from '@/lib/forms/errors'
import {
  ACCOUNT_ERROR_KEY,
  EMAIL_FIELD_CODES,
  codeToSend,
  createCodeSchema,
  createEmailSchema,
  emailToSend,
} from '@/lib/forms/account'
import { formatCount, formatCountdown } from '@/lib/format'
import { log } from '@/lib/log'
import type { AccountCode, AccountResult } from '@/lib/supabase/accountAuth'
import type { AccountSheetMode } from '@/state/accountSheet'
import { accountEnv, loadAccountAuth } from './accountEnv'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/account'

/** data/config/account.json, validated by AccountConfigSchema in src/lib/data/data.test.ts. */
const CONFIG: AccountConfig = accountJson

const INPUT =
  'min-h-11 w-full rounded-xl border border-line bg-canvas px-3 text-base text-fg focus-visible:outline-2 focus-visible:outline-focus'

/** A failure as the player sees it: the code, and whether it belongs under the email field. */
type Shown = { readonly code: AccountCode } | null

async function run(action: () => Promise<AccountResult>, what: string): Promise<AccountResult> {
  let result: AccountResult
  try {
    result = await action()
  } catch (error) {
    // The account chunk itself did not load: the same as no network.
    log.info('The account code did not load', {
      error: error instanceof Error ? error.name : typeof error,
    })
    result = { ok: false, code: navigator.onLine ? 'error' : 'offline' }
  }
  if (result.ok) log.info('Account step done', { step: what })
  else log.info('Account step refused', { step: what, code: result.code })
  return result
}

/** "Continue with Google": leaves the page for Google, coming back to /auth/callback. */
function GoogleButton({ mode }: { readonly mode: AccountSheetMode }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AccountCode | null>(null)
  const onClick = async () => {
    if (busy) return
    const config = accountEnv()
    if (config === null) {
      setError('not-configured')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // /auth/callback words the result by what this tab set out to do.
      sessionStorage.setItem(GOOGLE_INTENT_KEY, mode)
    } catch {
      // Without it the callback still finishes; it only words the result as a log-in.
    }
    const result = await run(
      () =>
        loadAccountAuth().then((auth) =>
          mode === 'save'
            ? auth.linkGoogle(config.env, config.callback)
            : auth.signInWithGoogle(config.env, config.callback),
        ),
      mode === 'save' ? 'link-google' : 'login-google',
    )
    // On success the browser is on its way to Google; the button stays busy until it leaves.
    if (!result.ok) {
      setBusy(false)
      setError(result.code)
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        data-account-google=""
        onClick={() => void onClick()}
        aria-disabled={busy ? true : undefined}
        className={`${PANEL_BUTTON} flex items-center justify-center gap-2 border border-line bg-canvas text-fg`}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
          <path
            fill="currentColor"
            d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3zM12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22zm-5.6-8a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9l3.3-2.6zM12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.8 9.4 6 12 6z"
          />
        </svg>
        {copy('account.google')}
      </button>
      {error === null ? null : (
        <p role="alert" data-account-error={error} className="text-sm font-semibold text-danger">
          {copy(ACCOUNT_ERROR_KEY[error])}
        </p>
      )}
    </div>
  )
}

/**
 * The email step (GR-1, GR-2, GR-6, GR-8): one native field, errors from the shared schema
 * recomputed on every change and shown after the first submit, the exact address that will be
 * sent shown before sending, and the server's refusals under the field.
 */
function EmailStep({
  mode,
  initialEmail,
  onSent,
  onLoginInstead,
}: {
  readonly mode: AccountSheetMode
  readonly initialEmail: string | null
  readonly onSent: (email: string) => void
  readonly onLoginInstead?: (email: string) => void
}) {
  const inputId = useId()
  const hintId = useId()
  const previewId = useId()
  const errorId = useId()
  const input = useRef<HTMLInputElement>(null)
  const [raw, setRaw] = useState(initialEmail ?? '')
  const [attempted, setAttempted] = useState(false)
  const [refused, setRefused] = useState<Shown>(null)
  const [sending, setSending] = useState(false)

  const schema = useMemo(() => createEmailSchema(), [])
  const errors = useMemo(() => fieldErrors(schema, { email: raw }), [schema, raw])
  const email = emailToSend(raw)

  const fieldError =
    attempted && errors.email !== undefined
      ? errors.email
      : refused !== null && EMAIL_FIELD_CODES.has(refused.code)
        ? ACCOUNT_ERROR_KEY[refused.code]
        : null
  const alertCode = refused !== null && !EMAIL_FIELD_CODES.has(refused.code) ? refused.code : null

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending) return
    setAttempted(true)
    setRefused(null)
    if (errors.email !== undefined) {
      input.current?.focus()
      return
    }
    const config = accountEnv()
    if (config === null) {
      setRefused({ code: 'not-configured' })
      return
    }
    setSending(true)
    const result = await run(
      () =>
        loadAccountAuth().then((auth) =>
          mode === 'save'
            ? auth.upgradeWithEmail(config.env, email, config.callback)
            : auth.sendLoginLink(config.env, email, config.callback),
        ),
      mode === 'save' ? 'send-save-link' : 'send-login-link',
    )
    setSending(false)
    if (result.ok) {
      onSent(email)
      return
    }
    setRefused({ code: result.code })
    if (EMAIL_FIELD_CODES.has(result.code)) input.current?.focus()
  }

  const describedBy = [
    hintId,
    email === '' ? null : previewId,
    fieldError === null ? null : errorId,
  ]
    .filter((id) => id !== null)
    .join(' ')

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-semibold text-fg">
        {copy('account.email.label')}
      </label>
      <input
        ref={input}
        id={inputId}
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        value={raw}
        onChange={(event) => {
          setRaw(event.target.value)
          setRefused(null)
        }}
        aria-describedby={describedBy}
        aria-invalid={fieldError === null ? undefined : true}
        className={INPUT}
      />
      <p id={hintId} className="text-xs text-muted">
        {copy('account.email.hint')}
      </p>
      {email === '' ? null : (
        <p id={previewId} data-account-email-preview={email} className="text-sm text-muted">
          {copy('account.email.willSend', { email })}
        </p>
      )}
      {fieldError === null ? null : (
        <div id={errorId} className="flex flex-col items-start gap-1">
          <p data-account-field-error="" className="text-sm font-semibold text-danger">
            {copy(fieldError)}
          </p>
          {refused?.code === 'email-exists' && onLoginInstead !== undefined ? (
            <button
              type="button"
              data-account-login-instead=""
              onClick={() => onLoginInstead(email)}
              className={`${PANEL_BUTTON} bg-raised text-fg`}
            >
              {copy('account.error.loginInstead')}
            </button>
          ) : null}
        </div>
      )}
      {alertCode === null ? null : (
        <p
          role="alert"
          data-account-error={alertCode}
          className="text-sm font-semibold text-danger"
        >
          {copy(ACCOUNT_ERROR_KEY[alertCode])}
        </p>
      )}
      <button
        type="submit"
        aria-disabled={sending ? true : undefined}
        className={`${PANEL_BUTTON} bg-taxi text-on-taxi`}
      >
        {sending
          ? copy('account.email.sending')
          : mode === 'save'
            ? copy('account.email.sendSave')
            : copy('account.email.sendLogin')}
      </button>
    </form>
  )
}

/**
 * The 6-digit code from the email (works where the link would open another browser): a log-in
 * code, or a save code typed on the device that asked to save (the only place it counts).
 */
function CodeForm({
  mode,
  email,
  onDone,
}: {
  readonly mode: AccountSheetMode
  readonly email: string
  readonly onDone: () => void
}) {
  const inputId = useId()
  const errorId = useId()
  const input = useRef<HTMLInputElement>(null)
  const [raw, setRaw] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [refused, setRefused] = useState<AccountCode | null>(null)
  const [verifying, setVerifying] = useState(false)
  const schema = useMemo(() => createCodeSchema(), [])
  const errors = useMemo(() => fieldErrors(schema, { code: raw }), [schema, raw])
  const shown =
    attempted && errors.code !== undefined
      ? errors.code
      : refused === null
        ? null
        : ACCOUNT_ERROR_KEY[refused]

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (verifying) return
    setAttempted(true)
    setRefused(null)
    if (errors.code !== undefined) {
      input.current?.focus()
      return
    }
    const config = accountEnv()
    if (config === null) {
      setRefused('not-configured')
      return
    }
    setVerifying(true)
    const result = await run(
      () =>
        loadAccountAuth().then((auth) =>
          mode === 'save'
            ? auth.verifySaveCode(config.env, email, codeToSend(raw))
            : auth.verifyLoginCode(config.env, email, codeToSend(raw)),
        ),
      mode === 'save' ? 'verify-save-code' : 'verify-code',
    )
    setVerifying(false)
    if (result.ok) {
      onDone()
      return
    }
    setRefused(result.code)
    input.current?.focus()
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-semibold text-fg">
        {copy('account.code.label')}
      </label>
      <input
        ref={input}
        id={inputId}
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        value={raw}
        onChange={(event) => {
          setRaw(event.target.value)
          setRefused(null)
        }}
        aria-describedby={shown === null ? undefined : errorId}
        aria-invalid={shown === null ? undefined : true}
        className={INPUT}
      />
      {shown === null ? null : (
        <p id={errorId} data-account-code-error="" className="text-sm font-semibold text-danger">
          {copy(shown)}
        </p>
      )}
      <button
        type="submit"
        aria-disabled={verifying ? true : undefined}
        className={`${PANEL_BUTTON} bg-taxi text-on-taxi`}
      >
        {verifying
          ? copy('account.code.verifying')
          : mode === 'save'
            ? copy('account.code.save')
            : copy('account.code.verify')}
      </button>
    </form>
  )
}

/** The resend button, disabled with its wait in the accessible name until the cooldown ends. */
function Resend({ sentAt, onResend }: { readonly sentAt: number; readonly onResend: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  const remaining = Math.max(0, (sentAt + CONFIG.resendCooldownMs - now) / 1000)
  useEffect(() => {
    if (remaining <= 0) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [remaining])
  const waiting = remaining > 0
  return (
    <button
      type="button"
      data-account-resend=""
      disabled={waiting}
      onClick={onResend}
      aria-label={
        waiting
          ? copy('account.sent.resendInLabel', { seconds: formatCount(Math.ceil(remaining)) })
          : undefined
      }
      className={`${PANEL_BUTTON} bg-raised text-fg disabled:text-muted`}
    >
      {waiting
        ? copy('account.sent.resendIn', { time: formatCountdown(remaining) })
        : copy('account.sent.resend')}
    </button>
  )
}

/**
 * The email-and-Google part of saving progress or logging in (S19), shared by the account sheet
 * and the welcome card's log-in view. Saving ends at "Check your inbox" (the sheet then waits for
 * the link to be opened, here or on another device); logging in ends when the code is accepted
 * or the link is opened in this browser (`onLoggedIn`; the account coordinator or the welcome
 * view takes it from there).
 */
export function AccountFlow({
  mode,
  initialEmail,
  onLoginInstead,
  onLinkSent,
  onSaved,
  onLoggedIn,
}: {
  readonly mode: AccountSheetMode
  readonly initialEmail: string | null
  /** "That email already has an account": switch to log-in with the email as typed. */
  readonly onLoginInstead?: (email: string) => void
  /** A save link went out to `email` (the sheet starts waiting for it). */
  readonly onLinkSent?: (email: string) => void
  /** The save code was accepted on this device: the guest is saved. */
  readonly onSaved?: () => void
  readonly onLoggedIn: () => void
}) {
  const [sent, setSent] = useState<{ readonly email: string; readonly at: number } | null>(null)
  const [draft, setDraft] = useState(initialEmail)
  const [resendError, setResendError] = useState<AccountCode | null>(null)

  if (sent === null) {
    return (
      <div className="flex flex-col gap-3">
        <GoogleButton mode={mode} />
        <p className="text-center text-xs font-semibold text-muted">{copy('account.or')}</p>
        <EmailStep
          mode={mode}
          initialEmail={draft}
          onLoginInstead={onLoginInstead}
          onSent={(email) => {
            setDraft(email)
            setSent({ email, at: Date.now() })
            if (mode === 'save') onLinkSent?.(email)
          }}
        />
      </div>
    )
  }

  const resend = async () => {
    const config = accountEnv()
    if (config === null) return
    setResendError(null)
    const result = await run(
      () =>
        loadAccountAuth().then((auth) =>
          mode === 'save'
            ? auth.upgradeWithEmail(config.env, sent.email, config.callback)
            : auth.sendLoginLink(config.env, sent.email, config.callback),
        ),
      'resend',
    )
    if (result.ok) setSent({ email: sent.email, at: Date.now() })
    else setResendError(result.code)
  }

  return (
    <section
      aria-labelledby="account-sent-title"
      data-account-sent={mode}
      className="flex flex-col gap-2"
    >
      <h3 id="account-sent-title" className="font-bold text-fg">
        {copy('account.sent.title')}
      </h3>
      <p role="status" className="text-sm text-fg">
        {mode === 'save'
          ? copy('account.sent.save', { email: maskEmail(sent.email) })
          : copy('account.sent.login', { email: maskEmail(sent.email) })}
      </p>
      {mode === 'save' ? (
        <p className="text-sm text-muted">{copy('account.sent.waiting')}</p>
      ) : null}
      <CodeForm
        mode={mode}
        email={sent.email}
        onDone={mode === 'save' ? (onSaved ?? (() => {})) : onLoggedIn}
      />
      {resendError === null ? null : (
        <p role="alert" className="text-sm font-semibold text-danger">
          {copy(ACCOUNT_ERROR_KEY[resendError])}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Resend sentAt={sent.at} onResend={() => void resend()} />
        <button
          type="button"
          onClick={() => setSent(null)}
          className={`${PANEL_BUTTON} bg-raised text-fg`}
        >
          {copy('account.sent.otherEmail')}
        </button>
      </div>
    </section>
  )
}
