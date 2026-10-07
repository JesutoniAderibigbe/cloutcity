/**
 * The apartment's lights for a personal-clock minute (S16). Static for now: the same ambient and
 * directional light at every minute. S04f (day/night on the personal game clock) replaces the
 * body of `lightingAt` with its keyframes; the room only ever reads lights through this seam, so
 * that change touches nothing else.
 */
import type { ApartmentConfig, RoomPalette } from './data'

export interface RoomLighting {
  readonly ambient: { readonly color: string; readonly intensity: number }
  readonly sun: {
    readonly color: string
    readonly intensity: number
    /** Towards the light, in room axes (x right, y up, z toward the camera). */
    readonly direction: { readonly x: number; readonly y: number; readonly z: number }
  }
}

export function lightingAt(
  _minute: number,
  lights: ApartmentConfig['lights'],
  palette: Pick<RoomPalette, 'ambientLight' | 'sunLight'>,
): RoomLighting {
  return {
    ambient: { color: palette.ambientLight, intensity: lights.ambientIntensity },
    sun: {
      color: palette.sunLight,
      intensity: lights.sunIntensity,
      direction: lights.sunDirection,
    },
  }
}
