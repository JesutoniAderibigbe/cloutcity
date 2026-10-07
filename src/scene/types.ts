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
  readonly toonRamp: readonly number[]
}

export interface SceneCopy {
  readonly label: string
  readonly loading: string
  /** No WebGL on this device. */
  readonly errorDevice: string
  /** The geo download failed or was invalid, or the scene failed to start. */
  readonly errorLoad: string
}

export interface SceneProps {
  /** /geo/base?v=<geoVersion>. */
  readonly geoUrl: string
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

export type SceneStatus = 'loading' | 'ready' | 'error'

/** Why the 3D map is unavailable: the device (no WebGL) or loading (download, data, start). */
export type SceneFailure = 'device' | 'load'
