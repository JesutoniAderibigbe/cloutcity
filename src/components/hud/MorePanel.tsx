'use client'

import { setSoundSheetOpen } from '@/components/audio/soundSheet'
import { resumeTour } from '@/components/tour/tourControl'
import { copy } from '@/lib/copy'
import { closeHudPanel, openHudPanel } from '@/state/hudPanel'
import { PANEL_BUTTON, PanelDialog } from './PanelDialog'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/hud'

/**
 * The HUD's More panel (S05, Q3; S06): Inventory and Rent (which also have their own buttons on
 * wide screens), the sound settings and Help, which brings back the tour. The More button shows
 * at every width. Each item opens its own sheet in place of this one, or closes it; Escape or
 * Close returns focus to the More button.
 */
export function MorePanel() {
  const items = [
    { key: 'inventory', label: copy('hud.inventory'), open: () => openHudPanel('inventory') },
    { key: 'rent', label: copy('hud.rent'), open: () => openHudPanel('rent') },
    {
      key: 'sound',
      label: copy('hud.soundSettings'),
      open: () => {
        closeHudPanel()
        setSoundSheetOpen(true)
      },
    },
    {
      // S06: Help resumes the tour (or replays it), over the map with nothing in the way.
      key: 'help',
      label: copy('hud.help'),
      open: () => {
        closeHudPanel()
        resumeTour()
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
