'use client'

/**
 * Frames the map so the camera target, where the player's avatar stands and where a flight to
 * a place lands (S04c `focusPose`), sits at the centre of the free scene area instead of the
 * canvas centre (S05).
 *
 * - On a phone the area is the free scene row: the canvas centre falls in the toast zone, so a
 *   level-up toast would cover the player.
 * - On a wide screen (`roomDockMinWidthPx` and up, S04p) the toast and sheet rows are a narrow
 *   centred column that is empty nearly always, so the free row alone would pin the target just
 *   under the HUD bar. There the area runs from the HUD down to the tab bar, or to the top of an
 *   open sheet, so a place flown to stays above its sheet. A toast sits between the HUD and the
 *   target, never over it.
 *
 * The canvas spans the whole screen under the overlay; `camera.setViewOffset` slides the
 * rendered window by the distance between the two centres, so the projection itself puts the
 * target in the area and every projection user (MapControls, pin picking, the e2e hooks) agrees.
 * The row is measured from the DOM (the scene status row, which repeats the overlay grid from
 * src/components/overlay/layers.ts), and observers re-frame on a resize, whenever the HUD
 * switches between its two-row and compact heights, and when a sheet opens or closes. Each
 * change requests one frame.
 */
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { PerspectiveCamera } from 'three'
// The raw file (validated by the data tests): the config loader would pull zod into the chunk.
import layoutJson from '@data/config/layout.json'
import { FREE_SCENE_ROW_SELECTOR } from '../types'

const SHEET_ZONE_SELECTOR = '[data-overlay-zone="sheet"]'
const TABS_ZONE_SELECTOR = '[data-overlay-zone="tabs"]'

/**
 * Whether a canvas this wide frames the map in the whole area between the HUD and the tab bar
 * (and starts the game map over the home's cluster, CityCanvas.tsx) rather than the free row.
 */
export function wideFraming(width: number): boolean {
  return width >= layoutJson.overlay.roomDockMinWidthPx
}

/** The top of what the sheet zone shows (an open sheet), or null while it shows nothing. */
function openSheetTop(zone: HTMLElement | null): number | null {
  let top: number | null = null
  for (const child of zone?.firstElementChild?.children ?? []) {
    if (child.hasAttribute('data-overlay-passive')) continue
    const rect = child.getBoundingClientRect()
    if (rect.height > 0) top = Math.min(top ?? rect.top, rect.top)
  }
  return top
}

export function FreeRowFraming() {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const size = useThree((state) => state.size)
  const invalidate = useThree((state) => state.invalidate)

  useEffect(() => {
    const row = document.querySelector<HTMLElement>(FREE_SCENE_ROW_SELECTOR)
    if (!(camera instanceof PerspectiveCamera) || row === null) return
    const canvas = gl.domElement
    const sheet = document.querySelector<HTMLElement>(SHEET_ZONE_SELECTOR)
    const tabs = document.querySelector<HTMLElement>(TABS_ZONE_SELECTOR)

    const apply = () => {
      const full = canvas.getBoundingClientRect()
      const free = row.getBoundingClientRect()
      if (full.width === 0 || full.height === 0) return
      let bottom = free.bottom
      if (wideFraming(full.width) && tabs !== null) {
        bottom = Math.max(free.bottom, openSheetTop(sheet) ?? tabs.getBoundingClientRect().top)
      }
      // Positive when the area's centre is below the canvas centre: slide the view window up by
      // that much so the scene, and the target with it, moves down into the area.
      const shift = Math.round((free.top + bottom) / 2 - (full.top + full.height / 2))
      camera.setViewOffset(full.width, full.height, 0, -shift, full.width, full.height)
      invalidate()
    }

    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(row)
    observer.observe(canvas)
    // A sheet opening or closing changes the zone's content, not its size.
    const mutations = new MutationObserver(apply)
    if (sheet !== null) mutations.observe(sheet, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      mutations.disconnect()
      camera.clearViewOffset()
      invalidate()
    }
  }, [camera, gl, size, invalidate])

  return null
}
