'use client'

import type { ReactNode } from 'react'
import { copy } from '@/lib/copy'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/phone'

/** A 44 px control inside the phone (A11Y: thumb-sized, with the focus ring the HUD uses). */
export const PHONE_BUTTON =
  'min-h-11 min-w-11 rounded-xl px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'

/** The taxi-yellow call to action ("Get there"). */
export const PHONE_PRIMARY = `${PHONE_BUTTON} shrink-0 bg-taxi text-center text-on-taxi enabled:hover:brightness-95`

/** A quiet control on a card. */
export const PHONE_SECONDARY = `${PHONE_BUTTON} shrink-0 bg-raised text-center text-fg enabled:hover:bg-pressed`

/** A card in an app screen: a heading and its content. */
export function PhoneCard({
  title,
  children,
  tone = 'plain',
}: {
  readonly title?: string
  readonly children: ReactNode
  /** `accent`: the one taxi-yellow card on a screen (the Bank balance). */
  readonly tone?: 'plain' | 'accent'
}) {
  const shade = tone === 'accent' ? 'bg-taxi text-on-taxi' : 'border border-line bg-surface text-fg'
  return (
    <section className={`flex flex-col gap-2 rounded-2xl p-3 shadow-sm ${shade}`}>
      {title === undefined ? null : (
        <h4
          className={`text-xs font-bold uppercase ${tone === 'accent' ? 'text-on-taxi' : 'text-muted'}`}
        >
          {title}
        </h4>
      )}
      {children}
    </section>
  )
}

/**
 * An honest "coming later" card (UX-3): what is missing and why, never placeholder data that
 * looks real.
 */
export function LaterCard({ title, body }: { readonly title: string; readonly body: string }) {
  return (
    <section
      data-phone-later=""
      className="flex items-start gap-3 rounded-2xl border border-dashed border-line-strong bg-canvas p-3"
    >
      <span aria-hidden="true" className="text-2xl leading-none">
        🚧
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h4 className="text-sm font-bold text-fg">{title}</h4>
        <p className="text-sm text-muted">{body}</p>
      </div>
    </section>
  )
}

/** The Messages app (S58): chat comes with friends, so for now it says so (UX-3). */
export function MessagesApp() {
  return (
    <div data-cc-feature="cc-feature:phone-messages" className="flex flex-col gap-3">
      <LaterCard title={copy('phone.later.title')} body={copy('phone.later.messages')} />
    </div>
  )
}
