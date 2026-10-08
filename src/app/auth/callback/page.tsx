import type { Metadata } from 'next'
import { AuthCallback } from '@/components/account/AuthCallback'
import { copy } from '@/lib/copy'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/account'

// Rendered per request, so Next.js answers with `Cache-Control: no-store`: the URL carries a
// one-time token. next.config.ts adds `Referrer-Policy: no-referrer` for /auth/*, and the
// service worker never handles it (src/sw/policy.ts).
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: copy('account.callback.title'),
  referrer: 'no-referrer',
  robots: { index: false, follow: false, nocache: true },
}

/** Where account links land (S19): an email link finishes on a tap, a Google code at once. */
export default function AuthCallbackPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <AuthCallback />
    </main>
  )
}
