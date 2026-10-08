import type { Metadata } from 'next'
import { AuthCallback } from '@/components/account/AuthCallback'
import { copy } from '@/lib/copy'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/account'

// A static page: the one-time token is in the URL fragment, which only the browser reads
// (review F5), so no server render ever sees it. next.config.ts still sends `Cache-Control:
// no-store` and `Referrer-Policy: no-referrer` for /auth/*, and the service worker never handles
// it (src/sw/policy.ts).

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
