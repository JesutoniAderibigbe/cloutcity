'use client'

import { useModalOpen } from '@/components/overlay/modalState'
import { copy, type CopyKey } from '@/lib/copy'
import { closeHudPanel, openHudPanel, useHudPanel, type HudPanel } from '@/state/hudPanel'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/hud'

/** Stroke icons (24 px box) shown in place of the labels where the wide HUD is still narrow. */
const BUTTONS = [
  {
    panel: 'inventory',
    labelKey: 'hud.inventory',
    icon: 'M6 8h12l-1 12H7L6 8Zm3 0V6a3 3 0 0 1 6 0v2',
  },
  {
    panel: 'rent',
    labelKey: 'hud.rent',
    icon: 'M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21V3Zm3 5h4m-4 4h4',
  },
  { panel: 'home', labelKey: 'hud.home', icon: 'M4 11l8-7 8 7v9h-5v-6H9v6H4v-9Z' },
] as const satisfies readonly { panel: HudPanel; labelKey: CopyKey; icon: string }[]

const BUTTON =
  'min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-taxi-400'

const toggle = (panel: HudPanel, open: HudPanel | null) =>
  open === panel ? closeHudPanel() : openHudPanel(panel)

/**
 * The HUD's panel buttons in the actions cell (S10a; S05 layout; Home, S16). On wide screens,
 * Inventory, Rent and Home (icons with their labels as accessible names below `lg`, labels from
 * `lg`). At every width, the More button that opens a
 * panel holding Inventory, Rent, Home, the sound settings (Q3) and Help (S06). Toggle buttons: tapping the open
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
      {BUTTONS.map(({ panel, labelKey, icon }) => (
        <button
          key={panel}
          type="button"
          data-hud-panel={panel}
          aria-expanded={open === panel}
          onClick={() => toggle(panel, open)}
          // From 640 px the HUD holds Inventory, Rent and Home beside the sound control, Places
          // and More; below `lg` their labels do not fit, so they show an icon and keep the label
          // as their accessible name.
          className={`${BUTTON} hidden lg:px-3 hud-wide:flex hud-short:hidden ${shade(panel)}`}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5 fill-none stroke-current stroke-2 lg:hidden"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={icon} />
          </svg>
          <span className="sr-only lg:not-sr-only">{copy(labelKey)}</span>
        </button>
      ))}
      <button
        type="button"
        data-hud-panel="more"
        aria-label={copy('hud.more')}
        aria-expanded={open === 'more'}
        onClick={() => toggle('more', open)}
        className={`${BUTTON} flex ${shade('more')}`}
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
