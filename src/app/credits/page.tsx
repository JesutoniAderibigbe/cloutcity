import type { Metadata } from 'next'
import Link from 'next/link'
import { copy, type CopyKey } from '@/lib/copy'

export const metadata: Metadata = { title: copy('credits.title') }

const SECTIONS: readonly { heading: CopyKey; body: readonly CopyKey[] }[] = [
  { heading: 'credits.nyc.heading', body: ['credits.nyc.body', 'credits.nyc.disclaimer'] },
  { heading: 'credits.mta.heading', body: ['credits.mta.body'] },
  { heading: 'credits.osm.heading', body: ['credits.osm.body'] },
]

/** Data sources and their required attribution (data/geo/SOURCES.md), linked from the map. */
export default function CreditsPage() {
  return (
    // The shell locks page scroll (globals.css), so this page scrolls inside its own box.
    <div className="h-full overflow-y-auto overscroll-contain">
      <main className="mx-auto max-w-2xl px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <h1 className="text-2xl font-extrabold tracking-tight text-pink-400">
          {copy('credits.title')}
        </h1>
        <p className="mt-2 text-sm text-ink-300">{copy('credits.intro')}</p>
        {SECTIONS.map((section) => (
          <section key={section.heading} className="mt-6">
            <h2 className="text-lg font-bold text-ink-50">{copy(section.heading)}</h2>
            {section.body.map((key) => (
              <p key={key} className="mt-2 text-sm leading-relaxed text-ink-300">
                {copy(key)}
              </p>
            ))}
          </section>
        ))}
        <Link
          href="/"
          className="mt-8 inline-flex min-h-11 items-center rounded-lg bg-night-800 px-4 font-semibold text-taxi-400 focus-visible:outline-2 focus-visible:outline-taxi-400"
        >
          {copy('credits.back')}
        </Link>
      </main>
    </div>
  )
}
