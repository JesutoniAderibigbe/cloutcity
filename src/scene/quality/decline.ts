/**
 * What one PerformanceMonitor decline does (S04b): asks stepDecision whether the tier steps
 * down, with the continuous window (continuity.ts) and the store's session state, and records
 * the step-down in the quality store when it may. The living city's density steps down first
 * (S04l, DEC-52): while a density level remains (ambientSteps.ts), a decline that would count
 * lowers it instead, on any tier, under the same window and a shared cooldown.
 */
import type { FpsStepDown } from '@/lib/data/schemas/config'
import { log, type Logger } from '@/lib/log'
import { stepDecision, type StepDecision } from '@/lib/quality/stepDown'
import { selectActiveTier, type QualityState, type QualityStore } from '@/state/quality'
import { ambientSteps } from './ambientSteps'
import { continuousSince } from './continuity'

/**
 * Whether a decline could step anything down: a living city density level left, or the tier
 * (automatic, no data saver, above low and under the session's step limit). Otherwise there is
 * nothing to measure, so the monitor stays off and never forces frames.
 */
export function canStepDown(state: QualityState, stepDown: FpsStepDown): boolean {
  const active = selectActiveTier(state)
  const ambient = ambientSteps.get()
  return (
    active !== null &&
    (ambient.steps < ambient.max ||
      (active !== 'low' &&
        state.override === null &&
        !state.dataSaver &&
        state.steps < stepDown.maxSteps))
  )
}

export function onMonitorDecline(
  store: QualityStore,
  stepDown: FpsStepDown,
  nowMs: number,
  logger: Logger = log,
): StepDecision | null {
  const state = store.getState()
  const active = selectActiveTier(state)
  if (active === null) return null
  const ambient = ambientSteps.get()
  const since = continuousSince()
  const last = Math.max(state.lastStepAtMs ?? -Infinity, ambient.lastStepAtMs ?? -Infinity)
  const lastStepAtMs = last === -Infinity ? null : last
  if (
    ambient.steps < ambient.max &&
    since !== null &&
    nowMs - since >= stepDown.sustainMs &&
    (lastStepAtMs === null || nowMs - lastStepAtMs >= stepDown.cooldownMs)
  ) {
    ambientSteps.record(nowMs)
    logger.info('3D map ambient density stepped down for frame rate', { level: ambient.steps + 1 })
    return { action: 'ambient-down', level: ambient.steps + 1 }
  }
  const decision = stepDecision(
    {
      event: 'decline',
      nowMs,
      continuousSinceMs: since,
      lastStepAtMs,
      steps: state.steps,
      active,
      overrideActive: state.override !== null,
      dataSaver: state.dataSaver,
    },
    stepDown,
  )
  if (decision.action === 'step-down') {
    state.recordStepDown(nowMs)
    logger.info('3D map quality stepped down for frame rate', { from: active, to: decision.to })
  }
  return decision
}
