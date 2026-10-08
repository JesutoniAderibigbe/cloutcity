/**
 * What /auth/callback tells the game page it hands over to (S19), in sessionStorage (this tab
 * only, gone when it closes): the 18+ check and consent the logged-in account holds on the
 * server, so the welcome card on this device asks only what is missing (the sound choice, and
 * the consent if the Terms changed). Never an email, a token or a user id.
 *
 * Tiny and zod-free on purpose: the welcome card's boot island reads it. Like the onboarding
 * record itself, it is the player's own device's word (the 18+ check is an attestation, CLAUDE.md
 * "Age"): forging it skips nothing a forged onboarding record would not, and the server keeps
 * the first attestation it recorded for the account.
 */

export const ACCOUNT_HANDOFF_KEY = 'cloutcity:account-attestation'

export interface AccountAttestation {
  readonly attestedAt: number
  readonly consentVersion: string | null
  readonly consentedAt: number | null
}

const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/**
 * A hand-off: this tab logged in to an account, and the 18+ check it holds (null: none yet, a
 * new Google account, so the card asks everything and the server records it then).
 */
export interface AccountHandoff {
  readonly attestation: AccountAttestation | null
}

/** Validates untrusted stored data; anything that does not fit is no hand-off. */
export function parseAccountHandoff(raw: unknown): AccountHandoff | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { attestation } = raw as Record<string, unknown>
  if (attestation === null) return { attestation: null }
  const parsed = parseAccountAttestation(attestation)
  return parsed === null ? null : { attestation: parsed }
}

function parseAccountAttestation(raw: unknown): AccountAttestation | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { attestedAt, consentVersion, consentedAt } = raw as Record<string, unknown>
  if (!isTime(attestedAt)) return null
  const version =
    typeof consentVersion === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(consentVersion)
      ? consentVersion
      : null
  const at = isTime(consentedAt) ? consentedAt : null
  return {
    attestedAt,
    consentVersion: version !== null && at !== null ? version : null,
    consentedAt: version !== null && at !== null ? at : null,
  }
}

function session(): Storage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch {
    return undefined
  }
}

export function writeAccountHandoff(value: AccountHandoff): void {
  try {
    session()?.setItem(ACCOUNT_HANDOFF_KEY, JSON.stringify(value))
  } catch {
    // Storage refused: the welcome card then asks everything, as for a new player.
  }
}

export function readAccountHandoff(): AccountHandoff | null {
  try {
    const raw = session()?.getItem(ACCOUNT_HANDOFF_KEY)
    return raw == null ? null : parseAccountHandoff(JSON.parse(raw))
  } catch {
    return null
  }
}

export function clearAccountHandoff(): void {
  try {
    session()?.removeItem(ACCOUNT_HANDOFF_KEY)
  } catch {
    // Nothing to clear.
  }
}
