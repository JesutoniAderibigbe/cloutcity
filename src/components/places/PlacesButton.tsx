'use client'

import { useModalOpen } from '@/components/overlay/modalState'
import { copy } from '@/lib/copy'
import { closePlacesPanel, openPlacesPanel, usePlacesPanel } from '@/state/placesPanel'

/** A map pin (24×24, stroked). */
const ICON =
  'M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z'

/**
 * The HUD's Places button (S04c): opens the Places panel, the DOM and keyboard path to every
 * place on the map (A11Y-3). Part of the shell, so it works before (and without) the 3D map;
 * its label is boot copy (`nav`). A toggle: tapping it while the panel is open closes it.
 *
 * Self-contained so S05's two-row HUD can move it: below `sm` it is a 44 px icon button whose
 * label stays its accessible name; from `sm` up the label shows. Hidden while a modal (the
 * welcome card) is open, like the other HUD buttons.
 */
export function PlacesButton() {
  const panel = usePlacesPanel()
  const modalOpen = useModalOpen()
  if (modalOpen) return null
  return (
    <button
      type="button"
      data-places-button=""
      aria-expanded={panel.open}
      onClick={() => (panel.open ? closePlacesPanel() : openPlacesPanel())}
      className={`flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-taxi-400 sm:px-3 ${
        panel.open ? 'bg-pink-400 text-night-950' : 'bg-night-800 text-ink-50'
      }`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-5 w-5 fill-none stroke-current stroke-2 sm:hidden"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={ICON} />
      </svg>
      <span className="sr-only sm:not-sr-only">{copy('nav.places')}</span>
    </button>
  )
}
