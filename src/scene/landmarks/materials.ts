/**
 * The landmark materials, shared by every landmark and level: one toon body material painted
 * by vertex colour (on the city's shared gradient ramp, so tones step exactly like the rest of
 * the city), flat unlit windows, a back-face outline for the inverted hull, and a dimmed body
 * for landmarks shown muted. Four materials in all, however many landmarks are drawn.
 */
import { BackSide, MeshBasicMaterial, MeshToonMaterial, type Texture } from 'three'
import type { LandmarkPalette } from './types'

export interface LandmarkMaterials {
  readonly body: MeshToonMaterial
  readonly windows: MeshBasicMaterial
  readonly outline: MeshBasicMaterial
  readonly dimmed: MeshToonMaterial
  /** Disposes the four materials; the ramp belongs to the caller and is left alone. */
  dispose(): void
}

/** `ramp` is the city's toon gradient (S04a createToonRamp), reused, never copied. */
export function createLandmarkMaterials(
  ramp: Texture,
  palette: LandmarkPalette,
): LandmarkMaterials {
  const body = new MeshToonMaterial({ vertexColors: true, gradientMap: ramp })
  const windows = new MeshBasicMaterial({ vertexColors: true })
  const outline = new MeshBasicMaterial({ color: palette.outline, side: BackSide })
  const dimmed = new MeshToonMaterial({ color: palette.dimmed, gradientMap: ramp })
  return {
    body,
    windows,
    outline,
    dimmed,
    dispose() {
      for (const material of [body, windows, outline, dimmed]) material.dispose()
    },
  }
}
