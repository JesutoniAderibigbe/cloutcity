'use client'

/**
 * The map style chip (S04m): "Game map" or "Real NYC", in the map's bottom-start corner above
 * the tab bar, opposite the Map data chip (and in the free scene row's corner while a sheet is
 * open, like that chip: globals.css `.map-style-row`). Phone → Settings holds the same choice
 * (src/components/phone/SettingsApp.tsx). Loaded lazily by the canvas once the city is playable
 * (`cc-feature:map-style`, never precached); the switch applies live through the style store.
 */
import { useState } from 'react'
import { copy } from '@/lib/copy'
import { MAP_STYLES } from '@/lib/world/mapStyleIds'
import { setMapStyle, useMapStyle } from '@/state/mapStyle'
import { FREE_SCENE_ROW_SELECTOR } from '../types'
// Copy namespaces this module renders (DEC-11: they load with this module's chunk).
import '@/lib/copy/ns/map'

/** Marker text the budget's optional-chunk filter finds in this chunk (lazyChunks.ts). */
export const MAP_STYLE_FEATURE = 'cc-feature:map-style'

/** The overlay grid's rows, read from the scene's own status grid (CitySceneClient.tsx). */
function overlayRows(): string {
  const row = document.querySelector<HTMLElement>(FREE_SCENE_ROW_SELECTOR)
  return row?.parentElement?.style.gridTemplateRows ?? ''
}

export default function MapStyleChip() {
  const style = useMapStyle()
  // Mounted on the client only (lazily, once the city is playable): the grid is in the DOM.
  const [rows] = useState(overlayRows)
  if (rows === '') return null
  return (
    <div
      data-cc-feature={MAP_STYLE_FEATURE}
      className="pointer-events-none absolute inset-0 grid grid-cols-1"
      style={{ gridTemplateRows: rows }}
    >
      <div className="map-style-row flex min-h-0 items-end justify-start overflow-hidden px-1">
        <div
          role="group"
          aria-label={copy('map.style.label')}
          data-map-style={style}
          className="pointer-events-auto flex rounded-full glass p-0.5 text-[11px] font-semibold"
        >
          {MAP_STYLES.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={style === id}
              data-map-style-option={id}
              onClick={() => setMapStyle(id)}
              className={`min-h-11 rounded-full px-3 focus-visible:outline-2 focus-visible:outline-focus ${
                style === id ? 'bg-taxi text-on-taxi' : 'text-fg'
              }`}
            >
              {copy(id === 'game' ? 'map.style.game' : 'map.style.real')}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
