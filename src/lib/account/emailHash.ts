/**
 * A fingerprint of an email address for the device's own marks (S19 review N1 and the
 * pre-hijack fix): the SHA-256 of the address lower-cased and trimmed, so this device can tell
 * whether a link is for the address *it* asked about without ever storing the address.
 * Web Crypto only (browser and Node), no dependency.
 */
export async function emailHash(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase())
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
