import { localStack } from './stack'

/**
 * The local mail catcher (Mailpit, `supabase status` MAILPIT_URL) for `*.supabase.spec.ts`: the
 * newest email to an address, the link in it (our templates link to `/auth/callback` or `/mod`
 * with a `token_hash`; a first sign-up's confirmation links to GoTrue's `/auth/v1/verify`) and
 * the 6-digit log-in code (S19).
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

/** The 6-digit code in a log-in email. */
export function codeIn(mail: Mail): string {
  const code = /<strong>(\d{6})<\/strong>/.exec(mail.html)?.[1]
  if (code === undefined) throw new Error('no code in the email')
  return code
}

/** Deletes every email to `email`, so the next one found is new. */
export async function clearMail(email: string): Promise<void> {
  const query = encodeURIComponent(`to:"${email}"`)
  await fetch(`${mailpit()}/api/v1/search?query=${query}`, { method: 'DELETE' })
}
