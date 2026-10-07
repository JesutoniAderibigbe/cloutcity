'use client'

import { useEffect, useRef, useState } from 'react'
import { useModalOpen } from '@/components/overlay/modalState'
import { copy } from '@/lib/copy'
import { offlineConfig } from '@/lib/offline/config'
import { startOfflineSupport, type OfflineSupportHandle } from '@/lib/offline/serviceWorker'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/offline'

/** Runs `run` when the browser is next idle, or after `timeoutMs` at the latest. */
function whenIdle(timeoutMs: number, run: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: timeoutMs })
    return () => window.cancelIdleCallback(id)
  }
  // Safari before 18.4 has no requestIdleCallback: yield one task instead.
  const id = window.setTimeout(run, 0)
  return () => window.clearTimeout(id)
}

/**
 * Offline support (S04e), loaded once the map is playable: registers the service worker when the
 * browser is idle, and shows the update notice in the banner zone when a new build is waiting.
 * The notice never covers a modal (the welcome card, the Icon moment); it waits until it closes.
 */
export function OfflineSupport() {
  const [waiting, setWaiting] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const handle = useRef<OfflineSupportHandle | null>(null)
  const modalOpen = useModalOpen()

  useEffect(() => {
    let active = true
    const cancel = whenIdle(offlineConfig.registration.idleTimeoutMs, () => {
      void startOfflineSupport({
        production: process.env.NODE_ENV === 'production',
        onUpdateWaiting: () => {
          if (active) setWaiting(true)
        },
      }).then((started) => {
        handle.current = started
      })
    })
    return () => {
      active = false
      cancel()
    }
  }, [])

  if (!waiting || dismissed || modalOpen) return null

  return (
    <div
      data-cc-notice="update"
      role="status"
      className="mx-2 flex h-full items-center gap-2 rounded-2xl border border-taxi glass px-3 text-sm text-fg shadow-lg"
    >
      <p className="line-clamp-2 min-w-0 flex-1">{copy('offline.update.message')}</p>
      <button
        type="button"
        onClick={() => handle.current?.applyUpdate()}
        className="min-h-11 shrink-0 rounded-xl bg-taxi px-3 font-semibold text-on-taxi focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {copy('offline.update.action')}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="min-h-11 shrink-0 rounded-xl bg-raised px-3 font-semibold text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {copy('offline.update.dismiss')}
      </button>
    </div>
  )
}
