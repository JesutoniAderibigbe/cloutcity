import type { CSSProperties, ReactNode } from 'react'
import {
  OVERLAY_ZONES,
  ZONE_GRID_ROW,
  layerZIndex,
  overlayGridTemplateRows,
  overlayLayout,
  type OverlayZone,
} from './layers'

export type OverlaySlots = Partial<Record<OverlayZone, ReactNode>>

interface OverlayLayoutProps {
  /** The scene under every overlay (the 3D map from S04a). */
  readonly children: ReactNode
  /** Content for each named zone. A zone is reserved even when empty. */
  readonly slots: OverlaySlots
}

// Width rules per zone. The sheet and toasts stay readable on desktop instead of spanning
// 1280 px; the HUD, banner and tab bar span the full width.
const ZONE_CLASS: Readonly<Record<OverlayZone, string>> = {
  banner: 'w-full',
  hud: 'w-full',
  toast: 'mx-auto w-full max-w-[var(--overlay-sheet-max-w)]',
  sheet: 'mx-auto w-full max-w-[var(--overlay-sheet-max-w)]',
  tabs: 'w-full',
}

// Only toasts announce themselves; everything else is read in document order.
const ZONE_ARIA: Readonly<Partial<Record<OverlayZone, Record<string, string>>>> = {
  toast: { role: 'status', 'aria-live': 'polite' },
}

/**
 * The single way to put UI over the scene (UX-1). Each zone is a grid row, so zones cannot
 * overlap; content that does not fit is clipped to its zone and scrolls inside it. Empty zones
 * let touches fall through to the scene.
 */
export function OverlayLayout({ children, slots }: OverlayLayoutProps) {
  const rootStyle = {
    gridTemplateRows: overlayGridTemplateRows(overlayLayout),
    '--overlay-sheet-max-w': `${overlayLayout.sheetMaxWidthPx}px`,
  } as CSSProperties

  return (
    <div className="fixed inset-0 overflow-hidden">
      <main className="absolute inset-0" style={{ zIndex: layerZIndex('scene') }}>
        {children}
      </main>
      <div
        data-overlay-root=""
        className="pointer-events-none absolute inset-0 grid grid-cols-1"
        style={rootStyle}
      >
        {OVERLAY_ZONES.map((zone) => (
          <div
            key={zone}
            data-overlay-zone={zone}
            className={`min-h-0 overflow-hidden ${ZONE_CLASS[zone]}`}
            style={{ gridRow: ZONE_GRID_ROW[zone], zIndex: layerZIndex(zone) }}
            {...ZONE_ARIA[zone]}
          >
            {slots[zone] === undefined ? null : (
              <div className="pointer-events-auto h-full overflow-y-auto overscroll-contain">
                {slots[zone]}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
