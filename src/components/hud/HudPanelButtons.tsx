'use client'

import { useModalOpen } from '@/components/overlay/modalState'
import { copy, type CopyKey } from '@/lib/copy'
import { closeHudPanel, openHudPanel, useHudPanel, type HudPanel } from '@/state/hudPanel'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/hud'

const BUTTONS = [
  { panel: 'inventory', labelKey: 'hud.inventory' },
  { panel: 'rent', labelKey: 'hud.rent' },
] as const satisfies readonly { panel: HudPanel; labelKey: CopyKey }[]

const BUTTON =
  'min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-taxi-400'

const toggle = (panel: HudPanel, open: HudPanel | null) =>
  open === panel ? closeHudPanel() : openHudPanel(panel)

/**
 * The HUD's panel buttons in the actions cell (S10a; S05 layout). On wide screens, Inventory
 * and Rent with their labels; on phones and landscape phones, one More button that opens a
 * panel holding Inventory, Rent and the sound settings (Q3). Toggle buttons: tapping the open
 * panel's button closes it. Hidden while a modal (the welcome card) is open, since everything
 * behind it is inert anyway.
 */
export function HudPanelButtons() {
  const open = useHudPanel()
  const modalOpen = useModalOpen()
  if (modalOpen) return null
  const shade = (panel: HudPanel) =>
    open === panel ? 'bg-pink-400 text-night-950' : 'bg-night-800 text-ink-50'
  return (
    <div data-cc-feature="cc-feature:hud-panel-buttons" className="flex shrink-0 gap-1">
      {BUTTONS.map(({ panel, labelKey }) => (
        <button
          key={panel}
          type="button"
          data-hud-panel={panel}
          aria-expanded={open === panel}
          onClick={() => toggle(panel, open)}
          className={`${BUTTON} hidden px-3 hud-wide:flex hud-short:hidden ${shade(panel)}`}
        >
          {copy(labelKey)}
        </button>
      ))}
      <button
        type="button"
        data-hud-panel="more"
        aria-label={copy('hud.more')}
        aria-expanded={open === 'more'}
        onClick={() => toggle('more', open)}
        className={`${BUTTON} flex hud-wide:hidden hud-short:flex ${shade('more')}`}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-current">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
    </div>
  )
}
