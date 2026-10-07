'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { copy } from '@/lib/copy'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/place'

export const PANEL_BUTTON =
  'min-h-11 min-w-11 rounded-xl px-3 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-taxi-400'

/**
 * The frame of a HUD panel in the sheet zone (S10a): a non-modal dialog like the place sheet,
 * so the map and HUD stay usable. Focus moves to the title on open and back to its HUD button
 * on close; Escape and the Close button close it.
 */
export function PanelDialog({
  title,
  panel,
  feature,
  onClose,
  children,
}: {
  readonly title: string
  readonly panel: string
  /** The panel's lazy-feature marker (`cc-feature:<id>`, DEC-11), written literally by the caller. */
  readonly feature: string
  readonly onClose: () => void
  readonly children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()

  // On close, focus goes back to the panel's own HUD button rather than whatever was focused
  // on open: switching panels would otherwise hand it to the other panel's button.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('h2')?.focus()
    return () => {
      const selector = `[data-hud-panel="${CSS.escape(panel)}"]`
      const target = document.querySelector<HTMLElement>(selector) ?? document.querySelector('main')
      target?.focus()
    }
  }, [panel])

  // Listened to directly: jsx-a11y does not allow key handlers on a non-interactive role.
  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    dialog.addEventListener('keydown', onKeyDown)
    return () => dialog.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={titleId}
      data-hud-panel-dialog={panel}
      data-cc-feature={feature}
      className="m-2 flex flex-col gap-2 rounded-2xl border border-night-700 bg-night-900/95 p-3 shadow-lg backdrop-blur"
    >
      <div className="flex items-start justify-between gap-2">
        <h2
          id={titleId}
          tabIndex={-1}
          className="text-base leading-tight font-extrabold text-pink-400 focus:outline-none"
        >
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={copy('place.sheet.closeLabel', { place: title })}
          className={`${PANEL_BUTTON} shrink-0 bg-night-800 text-center text-ink-50`}
        >
          {copy('place.sheet.close')}
        </button>
      </div>
      {children}
    </div>
  )
}

/** The panel's live result line: what the last action did, in voice. */
export function PanelStatus({ text }: { readonly text: string | null }) {
  return (
    <p role="status" className="min-h-5 text-sm font-semibold text-taxi-400">
      {text}
    </p>
  )
}
