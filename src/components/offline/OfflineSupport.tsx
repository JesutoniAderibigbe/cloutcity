'use client'

import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { useModalOpen } from '@/components/overlay/modalState'
import { copy } from '@/lib/copy'
import { log } from '@/lib/log'
import { offlineConfig } from '@/lib/offline/config'
import { startOfflineSupport, type OfflineSupportHandle } from '@/lib/offline/serviceWorker'
import { readDeviceSignals, startTierWarm } from '@/lib/offline/tierWarm'
import { updateNoticeShown } from '@/lib/offline/updateNotice'
import { qualityStore, selectActiveTier } from '@/state/quality'
import { tourStore } from '@/state/tour'
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
 * browser is idle, has it warm the quality tier's district assets once it is active (and again
 * when the tier changes; skipped under data saver and on low memory), and shows the update notice
 * in the banner zone when a new build is waiting. The notice never covers a modal (the welcome
 * card, the Icon moment) or the first-run tour (GR-9); it waits until they are gone.
 */
export function OfflineSupport() {
  const [waiting, setWaiting] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const handle = useRef<OfflineSupportHandle | null>(null)
  const modalOpen = useModalOpen()
  const touring = useStore(tourStore, (state) => state.record?.status === 'active')

  useEffect(() => {
    let active = true
    let stopWarm = () => {}
    const cancel = whenIdle(offlineConfig.registration.idleTimeoutMs, () => {
      void startOfflineSupport({
        production: process.env.NODE_ENV === 'production',
        onUpdateWaiting: () => {
          if (active) setWaiting(true)
        },
      }).then((started) => {
        handle.current = started
        if (!active || started === null) return
        stopWarm = startTierWarm({
          ready: navigator.serviceWorker.ready,
          quality: () => {
            const state = qualityStore.getState()
            return { tier: selectActiveTier(state), dataSaver: state.dataSaver }
          },
          subscribe: (listener) => qualityStore.subscribe(listener),
          device: () => readDeviceSignals(navigator),
          config: offlineConfig.tierWarm,
          logger: log,
        })
      })
    })
    return () => {
      active = false
      cancel()
      stopWarm()
    }
  }, [])

  if (!updateNoticeShown({ waiting, dismissed, modalOpen, touring })) return null

  return (
    <div
      data-cc-notice="update"
      role="status"
      className="mx-2 flex h-full items-center gap-2 rounded-2xl border border-taxi-400 bg-night-900/95 px-3 text-sm text-ink-50 shadow-lg backdrop-blur"
    >
      <p className="line-clamp-2 min-w-0 flex-1">{copy('offline.update.message')}</p>
      <button
        type="button"
        onClick={() => handle.current?.applyUpdate()}
        className="min-h-11 shrink-0 rounded-xl bg-taxi-400 px-3 font-semibold text-night-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-taxi-400"
      >
        {copy('offline.update.action')}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="min-h-11 shrink-0 rounded-xl bg-night-800 px-3 font-semibold text-ink-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-taxi-400"
      >
        {copy('offline.update.dismiss')}
      </button>
    </div>
  )
}
