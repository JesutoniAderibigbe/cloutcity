/**
 * Registers the service worker (S04e) from the lazily loaded offline-support chunk, once the map
 * is playable and the browser is idle (src/components/offline/OfflineSupportMount.tsx).
 *
 * - Production builds register /serwist/sw.js. A new build waits (the worker never skips
 *   waiting on its own); `onUpdateWaiting` lets the page offer the update, and `applyUpdate()`
 *   activates it (Serwist's SKIP_WAITING message) and reloads this tab once it is active.
 * - Development builds unregister any worker left from a production run on the same origin, so
 *   `next dev` never serves stale precached chunks.
 *
 * Offline support is an enhancement: no service worker support, a refused registration (private
 * modes, blocked storage, test browsers) or a failed script fetch are expected and logged at
 * info; play goes on without it.
 */
import { Serwist } from '@serwist/window'
import { log } from '@/lib/log'

export const SERVICE_WORKER_URL = '/serwist/sw.js'
export const SERVICE_WORKER_SCOPE = '/'

export interface OfflineSupportOptions {
  /** True in production builds (`process.env.NODE_ENV === 'production'`). */
  readonly production: boolean
  /** Called when a new build's worker is installed and waiting. */
  readonly onUpdateWaiting: () => void
}

export interface OfflineSupportHandle {
  /** Activates the waiting worker; the tab reloads once it takes control. */
  applyUpdate(): void
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}

async function unregisterAll(container: ServiceWorkerContainer): Promise<void> {
  const registrations = await container.getRegistrations()
  await Promise.all(registrations.map((registration) => registration.unregister()))
  if (registrations.length > 0) {
    log.info('Removed service workers in a development build', { count: registrations.length })
  }
}

export async function startOfflineSupport(
  options: OfflineSupportOptions,
): Promise<OfflineSupportHandle | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    log.info('Offline support unavailable: no service worker support')
    return null
  }
  const container = navigator.serviceWorker
  if (!options.production) {
    await unregisterAll(container).catch((error: unknown) => {
      log.info('Could not remove service workers in a development build', {
        error: errorName(error),
      })
    })
    return null
  }

  const serwist = new Serwist(SERVICE_WORKER_URL, { scope: SERVICE_WORKER_SCOPE })
  serwist.addEventListener('waiting', () => options.onUpdateWaiting())
  let registration: ServiceWorkerRegistration | undefined
  try {
    // The page has loaded and gone idle by now, so there is no load event to wait for.
    registration = await serwist.register({ immediate: true })
  } catch (error: unknown) {
    log.info('Offline support unavailable: the service worker did not register', {
      error: errorName(error),
    })
    return null
  }
  if (registration === undefined) {
    log.info('Offline support unavailable: the service worker did not register')
    return null
  }
  const current = registration
  return {
    applyUpdate() {
      const waiting = current.waiting
      if (waiting === null) return
      // Reload once the new worker is active. Not on `controllerchange`: a page loaded before
      // any worker was active has no controller to change (the worker never claims clients).
      // Only this tab reloads; another tab's update leaves this one alone.
      waiting.addEventListener('statechange', () => {
        if (waiting.state === 'activated') window.location.reload()
      })
      waiting.postMessage({ type: 'SKIP_WAITING' })
    },
  }
}
