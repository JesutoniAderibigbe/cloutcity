'use client'

import { useModalOpen } from '@/components/overlay/modalState'
import { copy, type CopyKey } from '@/lib/copy'
import { closeHudPanel, openHudPanel, useHudPanel, type HudPanel } from '@/state/hudPanel'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/hud'

/** Icon paths (24×24, stroked): a bag for the inventory, a house for rent. */
const ICONS: Readonly<Record<HudPanel, string>> = {
  inventory: 'M6 8h12l-1 12H7L6 8Zm3 0V6a3 3 0 0 1 6 0v2',
  rent: 'M4 11 12 4l8 7M6 9.5V20h12V9.5M10 20v-5h4v5',
}

const BUTTONS = [
  { panel: 'inventory', labelKey: 'hud.inventory' },
  { panel: 'rent', labelKey: 'hud.rent' },
] as const satisfies readonly { panel: HudPanel; labelKey: CopyKey }[]

/**
 * HUD buttons that open the inventory and rent panels in the sheet zone (S10a). Toggle
 * buttons: tapping the open panel's button closes it. Hidden while a modal (the welcome card)
 * is open, since everything behind it is inert anyway.
 *
 * The HUD row is full at 390 px (title, clout meter, sound control), so below `sm` each is a
 * 44 px icon button whose label stays its accessible name; from `sm` up the label shows.
 */
export function HudPanelButtons() {
  const open = useHudPanel()
  const modalOpen = useModalOpen()
  if (modalOpen) return null
  return (
    <div data-cc-feature="cc-feature:hud-panel-buttons" className="flex shrink-0 gap-1.5">
      {BUTTONS.map(({ panel, labelKey }) => (
        <button
          key={panel}
          type="button"
          data-hud-panel={panel}
          aria-expanded={open === panel}
          onClick={() => (open === panel ? closeHudPanel() : openHudPanel(panel))}
          className={`flex min-h-11 min-w-11 items-center justify-center rounded-xl text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-taxi-400 sm:px-3 ${
            open === panel ? 'bg-pink-400 text-night-950' : 'bg-night-800 text-ink-50'
          }`}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5 fill-none stroke-current stroke-2 sm:hidden"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={ICONS[panel]} />
          </svg>
          <span className="sr-only sm:not-sr-only">{copy(labelKey)}</span>
        </button>
      ))}
    </div>
  )
}
