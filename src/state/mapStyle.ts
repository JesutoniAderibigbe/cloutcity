/**
 * The player's map style choice (S04m): the Lagos-style game map or the realistic city,
 * persisted to localStorage under `cloutcity:map-style` in the stores' `{ state, version }`
 * shape. Only an explicit choice is stored; with none, the scene uses scene.json
 * `mapStyles.default`.
 *
 * Kept free of zustand and zod so the 3D chunk, the map's style chip and Phone → Settings share
 * a few hundred bytes, not a store runtime. Stored data is untrusted: anything but a known style
 * reads as no choice, and storage problems (private mode, quota) never throw.
 */
import { useSyncExternalStore } from 'react'
import type { MapStyleId } from '@/lib/world/mapStyleIds'

export const MAP_STYLE_KEY = 'cloutcity:map-style'
const VERSION = 1

const listeners = new Set<() => void>()
let choice: MapStyleId | null = null
let loaded = false
/**
 * The scene's default (scene.json `mapStyles.default`), as the 3D map reports it
 * ({@link registerMapStyleDefault}); 'game' (that file's value, held equal by mapStyle.test.ts)
 * until then.
 */
let sceneDefault: MapStyleId = 'game'

function parse(raw: string | null): MapStyleId | null {
  if (raw === null) return null
  try {
    const style = (JSON.parse(raw) as { state?: { style?: unknown } } | null)?.state?.style
    return style === 'game' || style === 'real' ? style : null
  } catch {
    return null
  }
}

/** The stored choice, or null when the player has not picked one. */
export function mapStyleChoice(): MapStyleId | null {
  if (!loaded && typeof window !== 'undefined') {
    loaded = true
    try {
      choice = parse(window.localStorage.getItem(MAP_STYLE_KEY))
    } catch {
      choice = null
    }
  }
  return choice
}

/** Records the choice (persisted when storage allows) and tells every subscriber. */
export function setMapStyle(style: MapStyleId): void {
  if (mapStyleChoice() === style) return
  choice = style
  try {
    window.localStorage.setItem(
      MAP_STYLE_KEY,
      JSON.stringify({ state: { style }, version: VERSION }),
    )
  } catch {
    // Not persisted (storage blocked or full): the choice still holds for this session.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The 3D map reports scene.json `mapStyles.default`, for settings and the chip. */
export function registerMapStyleDefault(style: MapStyleId): void {
  if (sceneDefault === style) return
  sceneDefault = style
  for (const listener of listeners) listener()
}

/**
 * The style in use: the player's choice, else `fallback` (the 3D map passes scene.json
 * `mapStyles.default`), else the default the map registered.
 */
export function useMapStyle(fallback?: MapStyleId): MapStyleId {
  return useSyncExternalStore(
    subscribe,
    () => mapStyleChoice() ?? fallback ?? sceneDefault,
    () => fallback ?? sceneDefault,
  )
}
