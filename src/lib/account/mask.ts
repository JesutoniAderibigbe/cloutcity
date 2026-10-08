/**
 * An email as the game shows it back (S19): `j•••@gmail.com`, enough for the player to recognise
 * their own address, never the whole of it. Pure, so the account UI can use it without loading
 * supabase-js.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at <= 0) return '•••'
  return `${email.slice(0, 1)}•••${email.slice(at)}`
}
