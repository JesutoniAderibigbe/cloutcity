/**
 * Ambient density (S04l): what share of the living city's slots is active. The FPS step-down
 * lowers the level before it drops a quality tier (`density.steps`), and night thins the streets
 * (`density.night`, from the personal game clock's day/night).
 *
 * A slot is active when its own seeded hash is below the share: the same slots stay active at a
 * level, and a lower level only ever removes slots (the active set is nested).
 */
import type { DensityConfig } from './types'

/** The highest step-down level the config allows. */
export const maxDensityLevel = (density: Pick<DensityConfig, 'steps'>) =>
  Math.max(0, density.steps.length - 1)

/**
 * The active share at a step-down `level` (clamped to the steps), times `density.night` at
 * night. `nightBlend` runs 0 (day) to 1 (full night), so dusk thins traffic gradually.
 */
export function densityShare(density: DensityConfig, level: number, nightBlend: number): number {
  const steps = density.steps
  const at = Math.max(0, Math.min(steps.length - 1, Math.floor(level)))
  const step = steps[at] ?? 1
  const blend = Math.max(0, Math.min(1, nightBlend))
  return step * (1 - blend + blend * density.night)
}

/** Whether a slot with hash `h` in [0, 1) is active at `share`. */
export const slotActive = (h: number, share: number) => h < share
