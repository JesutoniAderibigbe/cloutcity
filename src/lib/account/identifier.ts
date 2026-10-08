/**
 * The log-in identifier (S19, DEC-61): an email (something before an `@`) or a username (`name`
 * or `@name`). Shared by the log-in form and POST /api/auth/login, so both read it the same way.
 */
export function looksLikeEmail(identifier: string): boolean {
  return /^[^@\s]+@/.test(identifier.trim())
}

/** A username as typed, without a leading `@`. */
export function usernameOf(identifier: string): string {
  return identifier.trim().replace(/^@+/, '')
}
