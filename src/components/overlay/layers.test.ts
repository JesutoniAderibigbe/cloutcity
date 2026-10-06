import { describe, expect, it } from 'vitest'
import {
  OVERLAY_LAYER_ORDER,
  OVERLAY_ZONES,
  ZONE_GRID_ROW,
  layerZIndex,
  overlayGridTracks,
  overlayLayout,
} from './layers'

describe('overlay layers', () => {
  it('gives every zone its own grid row', () => {
    const rows = OVERLAY_ZONES.map((zone) => ZONE_GRID_ROW[zone])
    expect(new Set(rows).size).toBe(OVERLAY_ZONES.length)
  })

  it('puts zones in top-to-bottom order around the free scene row', () => {
    const tracks = overlayGridTracks(overlayLayout)
    expect(tracks).toHaveLength(7)
    expect(tracks[3]).toBe('minmax(0, 1fr)')
    expect(ZONE_GRID_ROW.banner).toBeLessThan(ZONE_GRID_ROW.hud)
    expect(ZONE_GRID_ROW.hud).toBeLessThan(4)
    expect(ZONE_GRID_ROW.toast).toBeGreaterThan(4)
    expect(ZONE_GRID_ROW.toast).toBeLessThan(ZONE_GRID_ROW.sheet)
    expect(ZONE_GRID_ROW.sheet).toBeLessThan(ZONE_GRID_ROW.tabs)
  })

  it('reserves a fixed tab bar and HUD at least 44 px tall', () => {
    const tracks = overlayGridTracks(overlayLayout)
    expect(tracks[2]).toBe(`${overlayLayout.hudHeightPx}px`)
    expect(overlayLayout.tabBarHeightPx).toBeGreaterThanOrEqual(44)
    expect(tracks[6]).toContain('env(safe-area-inset-bottom')
  })

  it('stacks the scene below every zone', () => {
    for (const layer of OVERLAY_LAYER_ORDER.filter((l) => l !== 'scene')) {
      expect(layerZIndex(layer)).toBeGreaterThan(layerZIndex('scene'))
    }
  })
})
