'use client'

import Link from 'next/link'
import { copy, copyParts } from '@/lib/copy'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/account'

const LEGAL: Readonly<
  Record<string, { href: string; label: 'account.sheet.terms' | 'account.sheet.privacy' }>
> = {
  terms: { href: '/terms', label: 'account.sheet.terms' },
  privacy: { href: '/privacy', label: 'account.sheet.privacy' },
}

/** "Your 18+ check and Terms consent come with you" (GR-5), with the Terms and Privacy links. */
export function CarryOver() {
  return (
    <p className="text-xs text-muted">
      {copyParts('account.sheet.carryOver').map((part, index) => {
        if (part.kind === 'text') return part.text
        const link = LEGAL[part.name]
        if (link === undefined) throw new Error(`No link for carry-over slot {${part.name}}`)
        return (
          <Link
            key={index}
            href={link.href}
            className="font-semibold text-taxi-ink underline underline-offset-2"
          >
            {copy(link.label)}
          </Link>
        )
      })}
    </p>
  )
}

/** The guest warning (GR-4): a guest game lives only in this browser. */
export function GuestWarning() {
  return (
    <p data-account-warning="" className="text-sm font-semibold text-fg">
      {copy('account.sheet.warning')}
    </p>
  )
}
