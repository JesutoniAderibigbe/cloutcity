/**
 * The /mod console's sign-in link (S18b, S19): the magic-link template sends moderators to
 * `<site>/mod#token_hash=…&type=email`, the one-time token in the fragment so it never reaches a
 * server log. Parsed from untrusted URL data with zod/mini; anything else is no link.
 */
import * as z from 'zod/mini'

const LinkSchema = z.object({
  token_hash: z.string().check(z.minLength(8), z.maxLength(512), z.regex(/^[A-Za-z0-9._~-]+$/)),
  type: z.enum(['email', 'magiclink']),
})

export interface ModLink {
  readonly tokenHash: string
  readonly type: 'email' | 'magiclink'
}

/** The token hash and type in a URL fragment, or null. */
export function parseModLink(hash: string): ModLink | null {
  const fragment = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const parsed = LinkSchema.safeParse(Object.fromEntries(fragment.entries()))
  return parsed.success ? { tokenHash: parsed.data.token_hash, type: parsed.data.type } : null
}
