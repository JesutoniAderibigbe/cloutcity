/**
 * Serialisable props the server scene mount (CityScene.tsx) hands to the client scene. Types
 * only, so the client never imports a config loader.
 */
import type { HomeIdLiteral } from '@/lib/data/homes'
import type { SceneConfig } from '@/lib/data/schemas/scene'
import type { LocalPoint } from '@/lib/geo/projection'
import type { LocalBounds } from './camera/limits'
import type { BoroughId } from './geo/schema'

/** Scene colours as hex, resolved from theme.json tokens on the server (src/lib/theme.ts). */
export interface ScenePalette {
  readonly background: string
  readonly water: string
  readonly land: Readonly<Record<BoroughId, string>>
  readonly park: string
  readonly cemetery: string
  readonly subwayLines: readonly string[]
  readonly subwayCasing: string
  readonly station: string
  /** The player's avatar placeholder and its ring (S05). */
  readonly player: string
  readonly labelInk: string
  readonly ambientLight: string
  readonly sunLight: string
  readonly pins: {
    readonly venue: string
    readonly landmark: string
    readonly teaser: string
    /** Memorial pins: a muted, respectful colour. */
    readonly muted: string
    readonly selected: string
  }
  readonly chip: { readonly fill: string; readonly ink: string }
  readonly toonRamp: readonly number[]
}

export interface SceneCopy {
  readonly label: string
  readonly loading: string
  /** No WebGL on this device. */
  readonly errorDevice: string
  /** The geo download failed or was invalid, or the scene failed to start. */
  readonly errorLoad: string
  /** The WebGL context was lost: the map is paused until the browser restores it. */
  readonly lost: string
  /** Alt text of the static fallback map shown while the 3D map is unavailable. */
  readonly fallback: string
  /** The ground label on "expanding soon" boroughs. */
  readonly expandingSoon: string
}

export interface SceneProps {
  /** /geo/base?v=<geoVersion>. */
  readonly geoUrl: string
  /** /geo/fallback?v=<geoVersion>: the static stylised map for when the 3D map is unavailable. */
  readonly fallbackUrl: string
  readonly palette: ScenePalette
  readonly config: SceneConfig
  /** Every home (data/homes/homes.json) projected to local metres. */
  readonly homesLocal: Readonly<Record<HomeIdLiteral, LocalPoint>>
  /**
   * The new player's home (balance.json `start.home`): where the camera and avatar start until
   * the HUD has read the save (src/state/playerHome.ts).
   */
  readonly startHome: HomeIdLiteral
  /** data/geo/bounds.json in local metres: the camera target never leaves it. */
  readonly boundsLocal: LocalBounds
  readonly dprCap: number
  /** The overlay grid rows (src/components/overlay/layers.ts), for the scene's own status row. */
  readonly overlayRows: string
  /** The free scene row of that grid (no overlay zone covers it). */
  readonly freeRow: number
  readonly copy: SceneCopy
}

/** `lost`: the WebGL context was lost after the map drew; it returns to `ready` once restored. */
export type SceneStatus = 'loading' | 'ready' | 'error' | 'lost'

/** Why the 3D map is unavailable: the device (no WebGL) or loading (download, data, start). */
export type SceneFailure = 'device' | 'load'

/**
 * Marks the scene's own status row, which repeats the overlay grid's free scene row: the camera
 * frames the target at its centre (src/scene/camera/FreeRowFraming.tsx).
 */
export const FREE_SCENE_ROW_SELECTOR = '[data-free-scene-row]'
