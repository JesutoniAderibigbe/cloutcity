import { layout } from '@/lib/data/config'
import type { LayoutConfig } from '@/lib/data/schemas/config'

/**
 * The overlay layer system (UX-1). Every piece of UI drawn over the scene lives in exactly one
 * named zone. Zones are rows of one CSS grid, so they can never overlap each other however much
 * content a zone holds: a zone clips or scrolls its own content instead of growing.
 *
 * Top to bottom: banner, HUD, free scene area, toast, sheet, tab bar.
 */
export const OVERLAY_ZONES = ['banner', 'hud', 'toast', 'sheet', 'tabs'] as const
export type OverlayZone = (typeof OVERLAY_ZONES)[number]

/**
 * Stacking order, lowest first. The scene sits underneath every zone; a modal (the welcome card,
 * later dialogs) sits above them all, in its own grid (see {@link MODAL_GRID_ROW}).
 */
export const OVERLAY_LAYER_ORDER = [
  'scene',
  'hud',
  'toast',
  'sheet',
  'banner',
  'tabs',
  'modal',
] as const
export type OverlayLayer = (typeof OVERLAY_LAYER_ORDER)[number]

export function layerZIndex(layer: OverlayLayer): number {
  return OVERLAY_LAYER_ORDER.indexOf(layer)
}

export type OverlayLayoutConfig = Readonly<LayoutConfig['overlay']>

export const overlayLayout: OverlayLayoutConfig = layout.overlay

/** Grid row for each zone (1-based, matching {@link overlayGridTracks}). */
export const ZONE_GRID_ROW: Readonly<Record<OverlayZone, number>> = {
  banner: 2,
  hud: 3,
  toast: 5,
  sheet: 6,
  tabs: 7,
}

/**
 * Where a modal sits: from the free scene row down to the top of the tab bar (rows 4-6), so it
 * never covers the banner, HUD or tab bar.
 */
export const MODAL_GRID_ROW = `4 / ${ZONE_GRID_ROW.tabs}`

/**
 * Rows: top safe-area inset, banner, HUD, free scene area, toast, sheet, tab bar (which also
 * absorbs the bottom safe-area inset so its background reaches the screen edge).
 *
 * Banner, toast and sheet are `minmax(0, max)`: the grid fills them to their max before the free
 * area gets anything, and on a short viewport (landscape phone) they shrink instead of pushing
 * the tab bar off screen. HUD and tab bar never shrink.
 */
export function overlayGridTracks(config: OverlayLayoutConfig): readonly string[] {
  return [
    'env(safe-area-inset-top, 0px)',
    `minmax(0, ${config.bannerHeightPx}px)`,
    `${config.hudHeightPx}px`,
    'minmax(0, 1fr)',
    `minmax(0, ${config.toastHeightPx}px)`,
    `minmax(0, ${config.sheetMaxHeightVh}dvh)`,
    `calc(${config.tabBarHeightPx}px + env(safe-area-inset-bottom, 0px))`,
  ]
}

export function overlayGridTemplateRows(config: OverlayLayoutConfig): string {
  return overlayGridTracks(config).join(' ')
}
