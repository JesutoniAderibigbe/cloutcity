'use client'

import { useEffect, useRef, useState } from 'react'
import { PANEL_BUTTON } from '@/components/hud/PanelDialog'
import type { AccountAttestation } from '@/lib/account/handoff'
import { copy } from '@/lib/copy'
import { log } from '@/lib/log'
import { AccountFlow } from './AccountFlow'
import { accountEnv, loadAccountAuth } from './accountEnv'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/account'

/**
 * The welcome card's "Have an account? Log in" view (S19), inside the welcome dialog: logging in
 * to an existing account before playing, with no guest created first. Google, or an emailed link
 * and 6-digit code. Once signed in (the code here, or the link opened in another tab of this
 * browser), the account's 18+ check and consent are read from the server and handed back, so the
 * card asks only what is still missing (GR-13: the sound choice is always the player's tap).
 */
export function WelcomeLogin({
  titleId,
  introId,
  onBack,
  onLoggedIn,
}: {
  readonly titleId: string
  readonly introId: string
  readonly onBack: () => void
  readonly onLoggedIn: (attestation: AccountAttestation | null) => void
}) {
  const title = useRef<HTMLHeadingElement>(null)
  const [finishing, setFinishing] = useState(false)
  const done = useRef(false)

  useEffect(() => title.current?.focus(), [])

  const finish = async () => {
    if (done.current) return
    done.current = true
    setFinishing(true)
    const config = accountEnv()
    const attestation =
      config === null
        ? null
        : await loadAccountAuth()
            .then((auth) => auth.readServerAttestation(config.env))
            .catch(() => null)
    log.info('Logged in from the welcome card', { attested: attestation?.attested === true })
    onLoggedIn(
      attestation?.attested === true && attestation.attestedAt !== null
        ? {
            attestedAt: attestation.attestedAt,
            consentVersion: attestation.consentVersion,
            consentedAt: attestation.consentedAt,
          }
        : null,
    )
  }

  // The link opened in another tab of this browser signs this one in too.
  useEffect(() => {
    const config = accountEnv()
    if (config === null) return
    let stop: (() => void) | null = null
    let live = true
    void loadAccountAuth()
      .then((auth) => {
        if (live) stop = auth.onSignedIn(config.env, () => void finish())
      })
      .catch(() => undefined)
    return () => {
      live = false
      stop?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- subscribes once; finish guards itself with a ref
  }, [])

  return (
    <div className="flex flex-col gap-4" data-welcome-login="">
      <header className="flex flex-col gap-1">
        <h2
          ref={title}
          id={titleId}
          tabIndex={-1}
          className="text-2xl font-extrabold tracking-tight text-fg focus:outline-none"
        >
          {copy('account.welcome.loginTitle')}
        </h2>
        <p id={introId} className="text-sm text-muted">
          {copy('account.welcome.loginIntro')}
        </p>
      </header>
      {finishing ? (
        <p role="status" className="text-sm text-fg">
          {copy('account.callback.working')}
        </p>
      ) : (
        <AccountFlow mode="login" initialEmail={null} onLoggedIn={() => void finish()} />
      )}
      <button
        type="button"
        onClick={onBack}
        className={`${PANEL_BUTTON} self-start bg-raised text-fg`}
      >
        {copy('account.welcome.back')}
      </button>
    </div>
  )
}
