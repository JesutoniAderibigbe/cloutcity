'use client'

import { copy, type CopyKey } from '@/lib/copy'
import { useModalPresence } from './modalState'

/** Where a lazy island renders: an overlay zone, or the modal layer. */
export type IslandZone = 'sheet' | 'modal'

interface ZoneStateProps {
  readonly zone: IslandZone
  /** Names what is loading ("Loading this place"); also the status's accessible name. */
  readonly labelKey: CopyKey
}

// The modal layer sits in a grid cell that ignores touches; its card takes them back.
const CARD: Readonly<Record<IslandZone, string>> = {
  sheet: 'm-2 rounded-2xl border border-night-700 bg-night-900/95 p-3 shadow-lg backdrop-blur',
  modal:
    'pointer-events-auto w-full max-w-[var(--overlay-sheet-max-w)] self-center rounded-3xl border border-night-700 bg-night-900 p-5 shadow-2xl',
}

/** A modal placeholder keeps the page behind it inert: the gate fails closed while it loads. */
function ModalPresence({ zone }: { readonly zone: IslandZone }) {
  useModalPresence(zone === 'modal')
  return null
}

/**
 * The loading state of a lazy feature, drawn inside its own zone (UX-1). The status is
 * announced at once; the skeleton only appears after the reveal delay (`.cc-reveal`), so a fast
 * load shows nothing.
 */
export function ZoneLoading({ zone, labelKey }: ZoneStateProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={copy(labelKey)}
      data-zone-loading={zone}
      className={CARD[zone]}
    >
      <ModalPresence zone={zone} />
      <div aria-hidden="true" className="cc-reveal flex flex-col gap-2">
        <div className="h-4 w-1/2 rounded-full bg-night-700 motion-safe:animate-pulse" />
        <div className="h-3 w-5/6 rounded-full bg-night-800 motion-safe:animate-pulse" />
        <div className="h-11 w-full rounded-xl bg-night-800 motion-safe:animate-pulse" />
      </div>
    </div>
  )
}

/** A feature that failed to load (offline, a dropped chunk), with a retry, inside its zone. */
export function ZoneLoadFailed({
  zone,
  onRetry,
}: {
  readonly zone: IslandZone
  readonly onRetry: () => void
}) {
  return (
    <div data-zone-error={zone} className={`${CARD[zone]} flex flex-col gap-2`}>
      <ModalPresence zone={zone} />
      <p className="text-sm text-ink-50">{copy('loading.failed')}</p>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-11 self-start rounded-full bg-taxi-400 px-5 text-sm font-extrabold text-night-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-50"
      >
        {copy('loading.retry')}
      </button>
    </div>
  )
}
