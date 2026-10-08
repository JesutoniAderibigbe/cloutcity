import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { localStack } from './stack'

/**
 * The local mail catcher (Mailpit, `supabase status` MAILPIT_URL) for `*.supabase.spec.ts`: the
 * newest email to an address and the link in it (the moderator log-in template links to `/mod`
 * with a `token_hash`; a first sign-up's confirmation links to GoTrue's `/auth/v1/verify`). Only
 * the /mod console sends email: players get none (DEC-61).
 */
interface MailpitSearch {
  readonly messages: readonly { readonly ID: string }[]
}

export interface Mail {
  readonly text: string
  readonly html: string
}

const mailpit = () => localStack().mailpitUrl

/** The newest email to `email`, waiting for it to arrive. */
export async function newestMail(email: string, timeoutMs = 20_000): Promise<Mail> {
  const query = encodeURIComponent(`to:"${email}"`)
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const search = (await (
      await fetch(`${mailpit()}/api/v1/search?query=${query}`)
    ).json()) as MailpitSearch
    const id = search.messages[0]?.ID
    if (id !== undefined) {
      const message = (await (await fetch(`${mailpit()}/api/v1/message/${id}`)).json()) as {
        Text: string
        HTML: string
      }
      return { text: message.Text, html: message.HTML }
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`no email arrived for ${email}`)
}

/** The first link in an email (our token-hash link, or GoTrue's verify link). */
export function linkIn(mail: Mail): string {
  const link = /href="([^"]+)"/.exec(mail.html)?.[1]?.replaceAll('&amp;', '&')
  if (link === undefined) throw new Error('no link in the email')
  return link
}

/** Deletes every email to `email`, so the next one found is new. */
export async function clearMail(email: string): Promise<void> {
  const query = encodeURIComponent(`to:"${email}"`)
  await fetch(`${mailpit()}/api/v1/search?query=${query}`, { method: 'DELETE' })
}

/** supabase/config.toml `site_url`: our templates link there, whatever redirect was asked. */
export const STACK_SITE_URL = (() => {
  const toml = readFileSync(join(import.meta.dirname, '../../../supabase/config.toml'), 'utf8')
  const found = /^site_url = "([^"]+)"/m.exec(toml)?.[1]
  if (found === undefined) throw new Error('supabase/config.toml has no site_url')
  return found
})()

/**
 * An emailed link of ours, checked (the stack's site URL, the given path, the token in the
 * fragment and never the query) and turned into the same path on the server under test (whose
 * port differs per lane): what the player's tap would open in production.
 */
export function ourLink(link: string, path: '/mod'): string {
  const url = new URL(link)
  if (`${url.origin}${url.pathname}` !== `${STACK_SITE_URL}${path}` || url.search !== '') {
    throw new Error(`not our ${path} link: ${url.origin}${url.pathname}${url.search ? '?…' : ''}`)
  }
  if (!url.hash.includes('token_hash=')) throw new Error('no token in the link fragment')
  return `${path}${url.hash}`
}
