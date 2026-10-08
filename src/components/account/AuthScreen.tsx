'use client'

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { birthYearOptions, currentCityYear, isAdultBirthYear } from '@/engine/ageGate'
import { routeAfterLogin } from '@/lib/account/afterLogin'
import { unlockAudioFromGesture } from '@/lib/audio/unlock'
import { copy, copyParts, type CopyKey } from '@/lib/copy'
import { fieldErrors, firstInvalid, type FieldErrors } from '@/lib/forms/errors'
import {
  ACCOUNT_ERROR_KEY,
  CREATE_FIELD_OF,
  LOGIN_FIELDS,
  accountConfig,
  createAccountSchema,
  createLoginSchema,
  emailToSend,
  usernameToSend,
} from '@/lib/forms/account'
import { handlesConfig } from '@/lib/forms/handle'
import { AUDIO_CHOICES, createWelcomeSchema, type AudioChoice } from '@/lib/forms/welcome'
import { formatCount } from '@/lib/format'
import { log } from '@/lib/log'
import type { AccountCode, AttestationInput, ServerAttestation } from '@/lib/supabase/accountAuth'
import { toAttestationArgs } from '@/lib/supabase/attestation'
import { openCreator } from '@/state/creatorOpen'
import { setSignedIn } from '@/state/entry'
import { onboardingConfig, onboardingStore } from '@/state/onboarding'
import { openRoomAfterCreator } from '@/state/onboardingFlow'
import { startGuestSession } from '@/state/session'
import { accountEnv, loadAccountAuth } from './accountEnv'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/account'
import '@/lib/copy/ns/profile'
import '@/lib/copy/ns/welcome'

const INPUT =
  'min-h-12 w-full rounded-2xl border border-line bg-raised px-4 text-base text-fg focus-visible:outline-2 focus-visible:outline-focus'
const LABEL = 'text-sm font-semibold text-fg'
const HINT = 'text-xs text-muted'
const ERROR = 'text-sm font-semibold text-danger'
const PRIMARY =
  'min-h-12 w-full rounded-full bg-taxi px-6 text-base font-extrabold text-on-taxi focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'
const CHOICE_INPUT = 'h-6 w-6 shrink-0 accent-taxi-ink'

const AUDIO_LABEL: Readonly<Record<AudioChoice, CopyKey>> = {
  ours: 'welcome.audio.ours',
  own: 'welcome.audio.own',
}

type Mode = 'signup' | 'login'

/** The answers a finished sign-up or log-in carries to the sound step. */
type Pending =
  | { readonly kind: 'signup'; readonly attestedAt: number }
  | { readonly kind: 'login'; readonly account: ServerAttestation }

function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}

function errorProps(id: string, error: CopyKey | undefined) {
  return error === undefined ? {} : { 'aria-invalid': true as const, 'aria-describedby': id }
}

function FieldError({ id, error }: { readonly id: string; readonly error: CopyKey | undefined }) {
  if (error === undefined) return null
  return (
    <p id={id} className={ERROR}>
      {copy(error)}
    </p>
  )
}

/** Terms and Privacy open in a new tab: the form keeps what the player typed. */
function ConsentText() {
  return (
    <span>
      {copyParts('account.consent.label').map((part, index) => {
        if (part.kind === 'text') return part.text
        const href = part.name === 'terms' ? '/terms' : '/privacy'
        return (
          <a
            key={index}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-taxi-ink underline underline-offset-2"
          >
            {copy(part.name === 'terms' ? 'account.consent.terms' : 'account.consent.privacy')}
            <span className="sr-only"> {copy('welcome.newTab')}</span>
          </a>
        )
      })}
    </span>
  )
}

/** A native password field with a show/hide toggle (the field itself is never covered, GR-8). */
function PasswordField({
  id,
  value,
  onChange,
  autoComplete,
  describedBy,
  invalid,
  inputRef,
}: {
  readonly id: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly autoComplete: 'new-password' | 'current-password'
  readonly describedBy: string | undefined
  readonly invalid: boolean
  readonly inputRef: React.RefObject<HTMLInputElement | null>
}) {
  const [shown, setShown] = useState(false)
  return (
    <div className="flex gap-2">
      <input
        ref={inputRef}
        id={id}
        name="password"
        type={shown ? 'text' : 'password'}
        autoComplete={autoComplete}
        autoCapitalize="none"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={describedBy}
        aria-invalid={invalid ? true : undefined}
        className={INPUT}
      />
      <button
        type="button"
        aria-pressed={shown}
        aria-label={shown ? copy('account.password.hide') : copy('account.password.show')}
        onClick={() => setShown((value) => !value)}
        className="min-h-12 min-w-12 shrink-0 rounded-2xl border border-line bg-raised text-fg focus-visible:outline-2 focus-visible:outline-focus"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="mx-auto h-5 w-5 fill-current">
          {shown ? (
            <path d="M2 4.3 3.3 3 21 20.7 19.7 22l-3.2-3.2A10.8 10.8 0 0 1 12 20C6.5 20 2.5 16 1 12a12 12 0 0 1 4.3-5.6zm10 4.2a3.5 3.5 0 0 1 3.5 3.5l-.1.7L11.3 8.6zM12 4c5.5 0 9.5 4 11 8a12.4 12.4 0 0 1-3.3 4.7l-1.4-1.4A10 10 0 0 0 20.9 12C19.6 9 16.2 6 12 6c-1 0-1.9.2-2.8.5L7.6 4.9A10.9 10.9 0 0 1 12 4z" />
          ) : (
            <path d="M12 4c5.5 0 9.5 4 11 8-1.5 4-5.5 8-11 8S2.5 16 1 12c1.5-4 5.5-8 11-8zm0 2C7.8 6 4.4 9 3.1 12c1.3 3 4.7 6 8.9 6s7.6-3 8.9-6C19.6 9 16.2 6 12 6zm0 2.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z" />
          )}
        </svg>
      </button>
    </div>
  )
}

/** What the server refused, under its field (or as one line when it has none). */
function useRefusal() {
  const [refused, setRefused] = useState<AccountCode | null>(null)
  return { refused, setRefused }
}

/**
 * Create account (DEC-61, DEC-62): username, email, password, the neutral year-of-birth picker
 * and the Terms/Privacy consent, one form (GR-1, GR-2, GR-6, GR-8). An under-age answer locks the
 * gate before anything is sent: no account is ever made for it.
 */
function SignUpForm({ onDone }: { readonly onDone: (pending: Pending) => void }) {
  const [currentYear] = useState(() => currentCityYear(Date.now()))
  const years = useMemo(
    () => birthYearOptions(currentYear, onboardingConfig.birthYearSpan),
    [currentYear],
  )
  const ids = {
    username: useId(),
    email: useId(),
    password: useId(),
    birthYear: useId(),
    consent: useId(),
  }
  const usernameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const birthYearRef = useRef<HTMLSelectElement>(null)
  const consentRef = useRef<HTMLInputElement>(null)
  const refs = {
    username: usernameRef,
    email: emailRef,
    password: passwordRef,
    birthYear: birthYearRef,
    consent: consentRef,
  }
  const [values, setValues] = useState({
    username: '',
    email: '',
    password: '',
    birthYear: '',
    consent: false,
  })
  const [attempted, setAttempted] = useState(false)
  const [working, setWorking] = useState(false)
  const [created, setCreated] = useState<{ attestedAt: number } | null>(null)
  const { refused, setRefused } = useRefusal()

  const accountSchema = useMemo(() => createAccountSchema(), [])
  const welcomeSchema = useMemo(
    () => createWelcomeSchema(currentYear, onboardingConfig, 'full'),
    [currentYear],
  )
  const errors = useMemo(() => {
    const welcome = fieldErrors(welcomeSchema, {
      birthYear: values.birthYear,
      consent: values.consent,
      audio: 'own',
    })
    return {
      ...fieldErrors(accountSchema, {
        username: values.username,
        email: values.email,
        password: values.password,
      }),
      birthYear: welcome.birthYear,
      consent: welcome.consent,
    } as FieldErrors<'username' | 'email' | 'password' | 'birthYear' | 'consent'>
  }, [accountSchema, welcomeSchema, values])
  const shown = attempted ? errors : {}
  const serverField = refused === null ? undefined : CREATE_FIELD_OF[refused]
  const fieldError = (field: keyof typeof ids): CopyKey | undefined =>
    shown[field] ??
    (serverField === field && refused !== null ? ACCOUNT_ERROR_KEY[refused] : undefined)
  const preview = usernameToSend(values.username)

  const update = (patch: Partial<typeof values>) => {
    setValues((previous) => ({ ...previous, ...patch }))
    setRefused(null)
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (working) return
    setAttempted(true)
    setRefused(null)
    // Once the account exists (only the username was refused), only the username matters.
    const order =
      created === null
        ? (['username', 'email', 'password', 'birthYear', 'consent'] as const)
        : (['username'] as const)
    const invalid = firstInvalid(order, errors)
    if (invalid !== undefined) {
      refs[invalid].current?.focus()
      return
    }
    const now = Date.now()
    if (created === null && !isAdultBirthYear(Number(values.birthYear), now, onboardingConfig)) {
      // Locked on this device; nothing was sent and no account exists for this answer.
      onboardingStore.getState().refuseUnderAge(now)
      return
    }
    const env = accountEnv()
    if (env === null) {
      setRefused('not-configured')
      return
    }
    if (!navigator.onLine) {
      setRefused('offline')
      return
    }
    setWorking(true)
    const auth = await loadAccountAuth().catch(() => null)
    if (auth === null) {
      setWorking(false)
      setRefused('offline')
      return
    }
    const username = usernameToSend(values.username)
    if (created !== null) {
      const result = await auth.saveUsername(env, username)
      setWorking(false)
      log.info('Account step done', { step: 'username', ok: result.ok })
      if (result.ok) onDone({ kind: 'signup', attestedAt: created.attestedAt })
      else setRefused(result.code)
      return
    }
    const attestation: AttestationInput = {
      ...toAttestationArgs({
        status: 'complete',
        attested: true,
        attestedAt: now,
        consentVersion: onboardingConfig.consentVersion,
        consentedAt: now,
        // The sound choice comes next (GR-13); the account starts muted-music until then.
        audioChoice: 'own',
      }),
    }
    const result = await auth.signUpAccount(
      env,
      { username, email: emailToSend(values.email), password: values.password },
      attestation,
    )
    setWorking(false)
    log.info('Account step done', { step: 'sign-up', ok: result.ok })
    if (result.ok) {
      onDone({ kind: 'signup', attestedAt: now })
      return
    }
    if ('accountCreated' in result) setCreated({ attestedAt: now })
    setRefused(result.code)
    const field = CREATE_FIELD_OF[result.code]
    if (field !== undefined) refs[field].current?.focus()
  }

  const alert = refused !== null && serverField === undefined ? ACCOUNT_ERROR_KEY[refused] : null
  const locked = created !== null
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4" data-auth-form="signup">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.username} className={LABEL}>
          {copy('account.username.label')}
        </label>
        <input
          ref={usernameRef}
          id={ids.username}
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={values.username}
          onChange={(event) => update({ username: event.target.value })}
          {...errorProps(`${ids.username}-error`, fieldError('username'))}
          className={INPUT}
        />
        <p className={HINT}>
          {copy('account.username.hint', {
            min: formatCount(handlesConfig.minLength),
            max: formatCount(handlesConfig.maxLength),
          })}
        </p>
        {preview === '' ? null : (
          <p data-username-preview={preview} className="text-sm font-semibold text-taxi-ink">
            {copy('account.username.preview', { handle: preview })}
            {preview === values.username.trim() ? null : (
              <span className="block font-normal text-muted">
                {copy('account.username.previewChanged')}
              </span>
            )}
          </p>
        )}
        <FieldError id={`${ids.username}-error`} error={fieldError('username')} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.email} className={LABEL}>
          {copy('account.email.label')}
        </label>
        <input
          ref={emailRef}
          id={ids.email}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          disabled={locked}
          value={values.email}
          onChange={(event) => update({ email: event.target.value })}
          {...errorProps(`${ids.email}-error`, fieldError('email'))}
          className={INPUT}
        />
        <p className={HINT}>{copy('account.email.hint')}</p>
        <FieldError id={`${ids.email}-error`} error={fieldError('email')} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.password} className={LABEL}>
          {copy('account.password.label')}
        </label>
        <PasswordField
          id={ids.password}
          inputRef={passwordRef}
          value={values.password}
          onChange={(password) => update({ password })}
          autoComplete="new-password"
          describedBy={`${ids.password}-rules${fieldError('password') === undefined ? '' : ` ${ids.password}-error`}`}
          invalid={fieldError('password') !== undefined}
        />
        <p id={`${ids.password}-rules`} className={HINT}>
          {copy('account.password.rules', {
            min: formatCount(accountConfig.password.minLength),
          })}
        </p>
        <FieldError id={`${ids.password}-error`} error={fieldError('password')} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.birthYear} className={LABEL}>
          {copy('welcome.birthYear.label')}
        </label>
        <select
          ref={birthYearRef}
          id={ids.birthYear}
          name="birthYear"
          disabled={locked}
          value={values.birthYear}
          onChange={(event) => update({ birthYear: event.target.value })}
          {...errorProps(`${ids.birthYear}-error`, fieldError('birthYear'))}
          className={INPUT}
        >
          <option value="">{copy('welcome.birthYear.placeholder')}</option>
          {years.map((year) => (
            <option key={year} value={String(year)}>
              {String(year)}
            </option>
          ))}
        </select>
        <FieldError id={`${ids.birthYear}-error`} error={fieldError('birthYear')} />
      </div>

      <div>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm text-fg">
          <input
            ref={consentRef}
            id={ids.consent}
            type="checkbox"
            name="consent"
            disabled={locked}
            checked={values.consent}
            onChange={(event) => update({ consent: event.target.checked })}
            {...errorProps(`${ids.consent}-error`, fieldError('consent'))}
            className={CHOICE_INPUT}
          />
          <ConsentText />
        </label>
        <FieldError id={`${ids.consent}-error`} error={fieldError('consent')} />
      </div>

      {locked ? (
        <p role="status" className="text-sm font-semibold text-taxi-ink">
          {copy('account.signup.created')}
        </p>
      ) : null}
      {alert === null ? null : (
        <p role="alert" data-auth-error={refused ?? ''} className={ERROR}>
          {copy(alert)}
        </p>
      )}
      <button type="submit" aria-disabled={working ? true : undefined} className={PRIMARY}>
        {working ? copy('account.signup.working') : copy('account.signup.submit')}
      </button>
    </form>
  )
}

/** Log in (DEC-61): username or email, and the password. One answer for every wrong pair. */
function LoginForm({ onDone }: { readonly onDone: (pending: Pending) => void }) {
  const ids = { identifier: useId(), password: useId() }
  const identifierRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const refs = { identifier: identifierRef, password: passwordRef }
  const [values, setValues] = useState({ identifier: '', password: '' })
  const [attempted, setAttempted] = useState(false)
  const [working, setWorking] = useState(false)
  const { refused, setRefused } = useRefusal()
  const schema = useMemo(() => createLoginSchema(), [])
  const errors = useMemo(() => fieldErrors(schema, values), [schema, values])
  const shown = attempted ? errors : {}

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (working) return
    setAttempted(true)
    setRefused(null)
    const invalid = firstInvalid(LOGIN_FIELDS, errors)
    if (invalid !== undefined) {
      refs[invalid].current?.focus()
      return
    }
    const env = accountEnv()
    if (env === null) {
      setRefused('not-configured')
      return
    }
    if (!navigator.onLine) {
      setRefused('offline')
      return
    }
    setWorking(true)
    const auth = await loadAccountAuth().catch(() => null)
    const result =
      auth === null
        ? ({ ok: false, code: 'offline' } as const)
        : await auth.logIn(env, values.identifier, values.password)
    log.info('Account step done', { step: 'log-in', ok: result.ok })
    if (!result.ok || auth === null) {
      setWorking(false)
      setRefused(result.ok ? 'error' : result.code)
      return
    }
    const account = (await auth.readServerAttestation(env)) ?? {
      attested: false,
      attestedAt: null,
      consentVersion: null,
      consentedAt: null,
    }
    setWorking(false)
    onDone({ kind: 'login', account })
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4" data-auth-form="login">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.identifier} className={LABEL}>
          {copy('account.identifier.label')}
        </label>
        <input
          ref={identifierRef}
          id={ids.identifier}
          name="identifier"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={values.identifier}
          onChange={(event) => {
            setValues((previous) => ({ ...previous, identifier: event.target.value }))
            setRefused(null)
          }}
          {...errorProps(`${ids.identifier}-error`, shown.identifier)}
          className={INPUT}
        />
        <FieldError id={`${ids.identifier}-error`} error={shown.identifier} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.password} className={LABEL}>
          {copy('account.password.label')}
        </label>
        <PasswordField
          id={ids.password}
          inputRef={passwordRef}
          value={values.password}
          onChange={(password) => {
            setValues((previous) => ({ ...previous, password }))
            setRefused(null)
          }}
          autoComplete="current-password"
          describedBy={shown.password === undefined ? undefined : `${ids.password}-error`}
          invalid={shown.password !== undefined}
        />
        <FieldError id={`${ids.password}-error`} error={shown.password} />
      </div>
      {refused === null ? null : (
        <p role="alert" data-auth-error={refused} className={ERROR}>
          {copy(ACCOUNT_ERROR_KEY[refused])}
        </p>
      )}
      <button type="submit" aria-disabled={working ? true : undefined} className={PRIMARY}>
        {working ? copy('account.login.working') : copy('account.login.submit')}
      </button>
      <p className="text-center text-xs text-muted">{copy('account.login.footer')}</p>
    </form>
  )
}

/**
 * The 18+ check and consent for a logged-in account the server holds none for (DEC-62 keeps the
 * attestation guarantee: every account has one before it plays). An under-age answer locks the
 * device and signs the account out of it.
 */
function AttestStep({ onDone }: { readonly onDone: (pending: Pending) => void }) {
  const [currentYear] = useState(() => currentCityYear(Date.now()))
  const years = useMemo(
    () => birthYearOptions(currentYear, onboardingConfig.birthYearSpan),
    [currentYear],
  )
  const ids = { birthYear: useId(), consent: useId() }
  const yearRef = useRef<HTMLSelectElement>(null)
  const consentRef = useRef<HTMLInputElement>(null)
  const [values, setValues] = useState({ birthYear: '', consent: false })
  const [attempted, setAttempted] = useState(false)
  const { refused, setRefused } = useRefusal()
  const schema = useMemo(
    () => createWelcomeSchema(currentYear, onboardingConfig, 'full'),
    [currentYear],
  )
  const errors = useMemo(() => fieldErrors(schema, { ...values, audio: 'own' }), [schema, values])
  const shown = attempted ? errors : {}

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAttempted(true)
    const invalid = firstInvalid(['birthYear', 'consent'] as const, errors)
    if (invalid !== undefined) {
      ;(invalid === 'birthYear' ? yearRef : consentRef).current?.focus()
      return
    }
    const env = accountEnv()
    const now = Date.now()
    if (!isAdultBirthYear(Number(values.birthYear), now, onboardingConfig)) {
      onboardingStore.getState().refuseUnderAge(now)
      if (env !== null) void loadAccountAuth().then((auth) => auth.signOutLocal(env))
      setSignedIn(false)
      return
    }
    if (env === null) return
    const auth = await loadAccountAuth()
    const args: AttestationInput = {
      ...toAttestationArgs({
        status: 'complete',
        attested: true,
        attestedAt: now,
        consentVersion: onboardingConfig.consentVersion,
        consentedAt: now,
        audioChoice: 'own',
      }),
    }
    const result = await auth.recordAttestation(env, args)
    if (!result.ok) {
      setRefused(result.code)
      return
    }
    onDone({ kind: 'signup', attestedAt: now })
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4" data-auth-form="attest">
      <p className="text-sm text-muted">{copy('account.attest.intro')}</p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.birthYear} className={LABEL}>
          {copy('welcome.birthYear.label')}
        </label>
        <select
          ref={yearRef}
          id={ids.birthYear}
          value={values.birthYear}
          onChange={(event) => setValues((v) => ({ ...v, birthYear: event.target.value }))}
          {...errorProps(`${ids.birthYear}-error`, shown.birthYear)}
          className={INPUT}
        >
          <option value="">{copy('welcome.birthYear.placeholder')}</option>
          {years.map((year) => (
            <option key={year} value={String(year)}>
              {String(year)}
            </option>
          ))}
        </select>
        <FieldError id={`${ids.birthYear}-error`} error={shown.birthYear} />
      </div>
      <div>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm text-fg">
          <input
            ref={consentRef}
            id={ids.consent}
            type="checkbox"
            checked={values.consent}
            onChange={(event) => setValues((v) => ({ ...v, consent: event.target.checked }))}
            {...errorProps(`${ids.consent}-error`, shown.consent)}
            className={CHOICE_INPUT}
          />
          <ConsentText />
        </label>
        <FieldError id={`${ids.consent}-error`} error={shown.consent} />
      </div>
      {refused === null ? null : (
        <p role="alert" className={ERROR}>
          {copy(ACCOUNT_ERROR_KEY[refused])}
        </p>
      )}
      <button type="submit" className={PRIMARY}>
        {copy('account.attest.submit')}
      </button>
    </form>
  )
}

/**
 * The sound choice (GR-13): a deliberate tap, after the account is ready. Starting play here is
 * the gesture that unlocks audio, with music muted from the start under "I'll bring my own".
 */
function SoundStep({
  pending,
  onFinished,
}: {
  readonly pending: Pending
  readonly onFinished: () => void
}) {
  const [choice, setChoice] = useState<AudioChoice | ''>('')
  const [attempted, setAttempted] = useState(false)
  const firstRadio = useRef<HTMLInputElement>(null)
  const error = attempted && choice === '' ? ('welcome.audio.error' as const) : undefined

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAttempted(true)
    if (choice === '') {
      firstRadio.current?.focus()
      return
    }
    const now = Date.now()
    const onboarding = onboardingStore.getState()
    const chosen = { consentVersion: onboardingConfig.consentVersion, audioChoice: choice }
    const recorded =
      pending.kind === 'signup'
        ? onboarding.completeFromAccount(
            {
              attestedAt: pending.attestedAt,
              consent: { version: chosen.consentVersion, at: pending.attestedAt },
            },
            chosen,
            now,
          )
        : onboarding.completeFromAccount(
            {
              attestedAt: pending.account.attestedAt ?? now,
              consent:
                pending.account.consentVersion === onboardingConfig.consentVersion &&
                pending.account.consentedAt !== null
                  ? { version: pending.account.consentVersion, at: pending.account.consentedAt }
                  : null,
            },
            chosen,
            now,
          )
    if (!recorded) return
    // Synchronously, still inside the submit gesture: Safari only starts audio there.
    unlockAudioFromGesture()
    setSignedIn(true)
    startGuestSession()
    const env = accountEnv()
    if (env !== null) {
      void loadAccountAuth().then((auth) => auth.recordAudioChoice(env, choice))
      void import('@/lib/supabase/accountSession').then((module) =>
        module.ensureAccountSession(env),
      )
    }
    if (pending.kind === 'signup') {
      // DEC-62: the character creator straight away, then the furnished room and the tour.
      openRoomAfterCreator()
      openCreator()
    } else {
      routeAfterLogin()
    }
    onFinished()
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4" data-auth-form="sound">
      <p className="text-sm text-muted">{copy('account.sound.intro')}</p>
      <fieldset
        role="radiogroup"
        className="flex flex-col"
        {...errorProps('auth-sound-error', error)}
      >
        <legend className={LABEL}>{copy('welcome.audio.legend')}</legend>
        {AUDIO_CHOICES.map((value, index) => (
          <label
            key={value}
            className="flex min-h-11 cursor-pointer items-center gap-3 py-2.5 text-base text-fg"
          >
            <input
              ref={index === 0 ? firstRadio : undefined}
              type="radio"
              name="audio"
              value={value}
              checked={choice === value}
              onChange={() => setChoice(value)}
              className={CHOICE_INPUT}
            />
            {copy(AUDIO_LABEL[value])}
          </label>
        ))}
        <FieldError id="auth-sound-error" error={error} />
      </fieldset>
      <button type="submit" className={PRIMARY}>
        {copy('account.sound.submit')}
      </button>
    </form>
  )
}

/**
 * The sign-up and log-in screen (DEC-61, DEC-62, like Lagos Life's): "Back to the city", the
 * brand, and one card with "Create account" and "Log in". Signing up makes the account (with the
 * 18+ check and consent on the server) and goes on to the sound choice, then the character
 * creator; logging in restores the account's game and goes to the player's room. Offline, it
 * says a connection is needed: a returning signed-in player never sees this screen.
 */
export function AuthScreen({
  titleId,
  introId,
  start,
  onBack,
  onSwitch,
  onFinished,
}: {
  readonly titleId: string
  readonly introId: string
  /** `finish`: an account is signed in here but its welcome steps are not done yet. */
  readonly start: Mode | 'finish'
  readonly onBack: () => void
  readonly onSwitch: (mode: Mode) => void
  /** The last step is done: the screen can close. */
  readonly onFinished: () => void
}) {
  const online = useOnline()
  const title = useRef<HTMLHeadingElement>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [attest, setAttest] = useState(false)
  useEffect(() => title.current?.focus(), [])

  // An account signed in here whose sound choice this device has not made yet (or with no 18+
  // check on the server) finishes those steps.
  useEffect(() => {
    if (start !== 'finish') return
    const env = accountEnv()
    if (env === null) return
    let live = true
    void loadAccountAuth().then(async (auth) => {
      const account = await auth.readServerAttestation(env)
      if (!live) return
      if (account?.attested === true) setPending({ kind: 'login', account })
      else setAttest(true)
    })
    return () => {
      live = false
    }
  }, [start])

  const onDone = (next: Pending) => {
    if (next.kind === 'login' && !next.account.attested) {
      setAttest(true)
      return
    }
    setAttest(false)
    setPending(next)
  }

  const step: 'form' | 'attest' | 'sound' = pending !== null ? 'sound' : attest ? 'attest' : 'form'
  const mode: Mode = start === 'login' ? 'login' : 'signup'
  let body: ReactNode
  if (step === 'sound' && pending !== null)
    body = <SoundStep pending={pending} onFinished={onFinished} />
  else if (step === 'attest') body = <AttestStep onDone={onDone} />
  else if (start === 'finish') body = null
  else body = mode === 'signup' ? <SignUpForm onDone={onDone} /> : <LoginForm onDone={onDone} />

  return (
    <div
      data-auth-screen={step === 'form' ? mode : step}
      className="flex min-h-full flex-col items-center gap-4 bg-gradient-to-b from-raised to-canvas px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-8"
    >
      <div className="w-full max-w-md">
        {step === 'form' && start !== 'finish' ? (
          <button
            type="button"
            onClick={onBack}
            className="min-h-11 text-sm font-semibold text-taxi-ink focus-visible:outline-2 focus-visible:outline-focus"
          >
            <span aria-hidden="true">← </span>
            {copy('account.auth.back')}
          </button>
        ) : null}
      </div>
      <header className="flex flex-col items-center gap-1 text-center">
        <span aria-hidden="true" className="text-4xl">
          🚕
        </span>
        <h2
          ref={title}
          id={titleId}
          tabIndex={-1}
          className="flex items-center gap-2 text-3xl font-extrabold tracking-tight text-fg focus:outline-none"
        >
          {copy('account.auth.title')}
          <span
            aria-label={copy('account.auth.adultBadgeLabel')}
            className="rounded-full bg-fg px-2 py-0.5 text-xs font-extrabold text-canvas"
          >
            {copy('account.auth.adultBadge')}
          </span>
        </h2>
        <p id={introId} className="text-sm text-muted">
          {step === 'sound'
            ? copy('account.sound.title')
            : step === 'attest'
              ? copy('account.attest.title')
              : copy('account.auth.tagline')}
        </p>
      </header>
      <div className="flex w-full max-w-md flex-col gap-4 rounded-3xl border border-line glass p-5 shadow-xl">
        {step === 'form' && start !== 'finish' ? (
          <div className="grid grid-cols-2 gap-1 rounded-full bg-raised p-1" role="group">
            {(['signup', 'login'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                aria-pressed={mode === tab}
                data-auth-tab={tab}
                onClick={() => onSwitch(tab)}
                className={`min-h-11 rounded-full text-sm font-bold focus-visible:outline-2 focus-visible:outline-focus ${
                  mode === tab ? 'bg-canvas text-fg shadow' : 'text-muted'
                }`}
              >
                {tab === 'signup' ? copy('account.auth.tabSignup') : copy('account.auth.tabLogin')}
              </button>
            ))}
          </div>
        ) : null}
        {!online && step === 'form' ? (
          <p role="status" data-auth-offline="" className="text-sm font-semibold text-fg">
            {copy('account.auth.offline')}
          </p>
        ) : null}
        {body}
      </div>
    </div>
  )
}
