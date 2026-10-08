/**
 * Traffic signals of the living city (S04l): a fixed two-phase cycle per junction. The junction's
 * first street sets axis 0; approaches within `axisCos` of it ride axis 0, the rest axis 1.
 * Axis 0 is green for the first `greenShare` of the cycle, axis 1 for the same share from half
 * way; the gaps between are all-red, so crossing traffic never shares a green.
 *
 * Pure: the phase is the city clock plus the junction's hashed offset.
 */
import type { LightsConfig, Signal } from './types'

export type SignalAxis = 0 | 1

/** Which axis an approach travelling in direction (dx, dy) rides. */
export function approachAxis(
  signal: Signal,
  dx: number,
  dy: number,
  lights: Pick<LightsConfig, 'axisCos'>,
): SignalAxis {
  const length = Math.hypot(dx, dy) || 1
  const cos = Math.abs((dx * signal.axisX + dy * signal.axisY) / length)
  return cos >= lights.axisCos ? 0 : 1
}

const phaseOf = (signal: Signal, tS: number, cycleS: number) =>
  (((tS + signal.offsetS) % cycleS) + cycleS) % cycleS

/** Seconds into the cycle at which `axis` turns green. */
const greenStart = (axis: SignalAxis, cycleS: number) => (axis === 0 ? 0 : cycleS / 2)

export function isGreen(
  signal: Signal,
  axis: SignalAxis,
  tS: number,
  lights: Pick<LightsConfig, 'cycleS' | 'greenShare'>,
): boolean {
  const { cycleS, greenShare } = lights
  const into = phaseOf(signal, tS, cycleS) - greenStart(axis, cycleS)
  const wrapped = ((into % cycleS) + cycleS) % cycleS
  return wrapped < greenShare * cycleS
}

/** The earliest time at or after `tS` when `axis` is green. */
export function nextGreen(
  signal: Signal,
  axis: SignalAxis,
  tS: number,
  lights: Pick<LightsConfig, 'cycleS' | 'greenShare'>,
): number {
  if (isGreen(signal, axis, tS, lights)) return tS
  const { cycleS } = lights
  const into = phaseOf(signal, tS, cycleS) - greenStart(axis, cycleS)
  const wrapped = ((into % cycleS) + cycleS) % cycleS
  return tS + (cycleS - wrapped)
}
