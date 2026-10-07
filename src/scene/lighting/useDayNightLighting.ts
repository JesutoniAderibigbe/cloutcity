/**
 * The lighting for the personal game clock's minute (S04f), as a value whose identity changes
 * only when the lighting does: during a keyframe's hold (and in step mode, under reduced motion)
 * every minute maps to the keyframe itself, so readers that depend on it neither re-render the
 * scene nor redraw it.
 */
import { useMemo } from 'react'
import { lightingAt } from '@/lib/dayNight/lightingAt'
import type { DayNightModel, Lighting } from '@/lib/dayNight/types'
import { useReducedMotion } from '@/lib/useReducedMotion'
import { useMinuteOfDay } from '@/state/dayClock'

/**
 * The minute whose lighting stands for `minute`'s: the keyframe's own minute while it shows
 * unblended, else the quantised minute. Equal results mean equal lighting.
 */
export function canonicalMinute(minute: number, model: DayNightModel, step: boolean): number {
  const lighting = lightingAt(minute, model, { step })
  if (lighting.t !== 0) return lighting.minute
  const keyframe = model.keyframes.find((entry) => entry.id === lighting.keyframe)
  return keyframe === undefined ? lighting.minute : keyframe.atMinute
}

/** `unknownMinute` stands in until the HUD has read the save. */
export function useDayNightLighting(model: DayNightModel, unknownMinute: number): Lighting {
  const minute = useMinuteOfDay() ?? unknownMinute
  const step = useReducedMotion()
  const canonical = canonicalMinute(minute, model, step)
  return useMemo(() => lightingAt(canonical, model, { step }), [canonical, model, step])
}
