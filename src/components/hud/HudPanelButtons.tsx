'use client'

import { useModalOpen } from '@/components/overlay/modalState'
import { copy, type CopyKey } from '@/lib/copy'
import { closeHudPanel, openHudPanel, useHudPanel, type HudPanel } from '@/state/hudPanel'

const BUTTONS = [
  { panel: 'inventory', labelKey: 'hud.inventory' },
  { panel: 'rent', labelKey: 'hud.rent' },
] as const satisfies readonly { panel: HudPanel; labelKey: CopyKey }[]

/**
 * HUD buttons that open the inventory and rent panels in the sheet zone (S10a). Toggle
 * buttons: tapping the open panel's button closes it. Hidden while a modal (the welcome card)
 * is open, since everything behind it is inert anyway.
 */
export function HudPanelButtons() {
  const open = useHudPanel()
  const modalOpen = useModalOpen()
  if (modalOpen) return null
  return (
    <div className="flex shrink-0 gap-1.5">
      {BUTTONS.map(({ panel, labelKey }) => (
        <button
          key={panel}
          type="button"
          data-hud-panel={panel}
          aria-expanded={open === panel}
          onClick={() => (open === panel ? closeHudPanel() : openHudPanel(panel))}
          className={`min-h-11 min-w-11 rounded-xl px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-taxi-400 ${
            open === panel ? 'bg-pink-400 text-night-950' : 'bg-night-800 text-ink-50'
          }`}
        >
          {copy(labelKey)}
        </button>
      ))}
    </div>
  )
}
