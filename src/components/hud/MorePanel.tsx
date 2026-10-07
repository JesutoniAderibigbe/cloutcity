'use client'

import { setSoundSheetOpen } from '@/components/audio/soundSheet'
import { copy } from '@/lib/copy'
import { closeHudPanel, openHudPanel } from '@/state/hudPanel'
import { PANEL_BUTTON, PanelDialog } from './PanelDialog'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/hud'

/**
 * The HUD's More panel (S05, Q3): on phones and landscape phones the HUD has no room for
 * Inventory, Rent, Home (S16) and the sound settings gear, so they live here. Each opens its own sheet in
 * place of this one; Escape or Close returns focus to the More button.
 */
export function MorePanel() {
  const items = [
    { key: 'inventory', label: copy('hud.inventory'), open: () => openHudPanel('inventory') },
    { key: 'rent', label: copy('hud.rent'), open: () => openHudPanel('rent') },
    { key: 'home', label: copy('hud.home'), open: () => openHudPanel('home') },
    {
      key: 'sound',
      label: copy('hud.soundSettings'),
      open: () => {
        closeHudPanel()
        setSoundSheetOpen(true)
      },
    },
  ]
  return (
    <PanelDialog
      title={copy('hud.more')}
      panel="more"
      feature="cc-feature:more-panel"
      onClose={closeHudPanel}
    >
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              data-more-item={item.key}
              onClick={item.open}
              className={`${PANEL_BUTTON} w-full bg-night-800 text-left text-ink-50`}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </PanelDialog>
  )
}
