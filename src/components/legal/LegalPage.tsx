import Link from 'next/link'
import { copy, type CopyKey } from '@/lib/copy'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/legal'

interface LegalPageProps {
  readonly titleKey: CopyKey
  readonly paragraphKeys: readonly CopyKey[]
}

/**
 * A static legal page (Terms, Privacy). The shell locks page scroll, so the page scrolls inside
 * its own <main>. Not gated by the welcome card: players read these before agreeing.
 */
export function LegalPage({ titleKey, paragraphKeys }: LegalPageProps) {
  return (
    <main className="h-full overflow-y-auto overscroll-contain px-4 py-8">
      <article className="mx-auto flex max-w-prose flex-col gap-4">
        <p
          role="note"
          className="rounded-xl border border-taxi-400 px-3 py-2 text-sm font-semibold text-taxi-400"
        >
          {copy('legal.placeholderNotice')}
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight text-pink-400">{copy(titleKey)}</h1>
        {paragraphKeys.map((key) => (
          <p key={key} className="text-ink-50">
            {copy(key)}
          </p>
        ))}
        <Link
          href="/"
          className="flex min-h-11 items-center self-start font-semibold text-taxi-400 underline underline-offset-2"
        >
          {copy('legal.back')}
        </Link>
      </article>
    </main>
  )
}
