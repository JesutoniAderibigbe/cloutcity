/**
 * What one PerformanceMonitor decline does (S04b): asks stepDecision whether the tier steps
 * down, with the continuous window (continuity.ts) and the store's session state, and records
 * the step-down in the quality store when it may.
 */
import type { FpsStepDown } from '@/lib/data/schemas/config'
import { log, type Logger } from '@/lib/log'
import { stepDecision, type StepDecision } from '@/lib/quality/stepDown'
import { selectActiveTier, type QualityState, type QualityStore } from '@/state/quality'
import { continuousSince } from './continuity'

/**
 * Whether a decline could step anything down: a living city density level left (S04l), or
 * the tier (automatic, no data saver, above low and under the session's step limit). Otherwise there is nothing to measure, so the monitor
 * stays off and never forces frames (a low-tier device keeps rendering on demand only).
 */
export function canStepDown(state: QualityState, stepDown: FpsStepDown): boolean {
  const active = selectActiveTier(state)
  if (active === null) return false
  // The living city's density steps down first, on every tier (S04l).
  if (state.ambientSteps < state.ambientStepsMax) return true
  return (
    active !== 'low' &&
    state.override === null &&
    !state.dataSaver &&
    state.steps < stepDown.maxSteps
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
  const decision = stepDecision(
    {
      event: 'decline',
      nowMs,
      continuousSinceMs: continuousSince(),
      lastStepAtMs: state.lastStepAtMs,
      steps: state.steps,
      active,
      overrideActive: state.override !== null,
      dataSaver: state.dataSaver,
      ambientSteps: state.ambientSteps,
      ambientStepsMax: state.ambientStepsMax,
    },
    stepDown,
  )
  if (decision.action === 'ambient-down') {
    state.recordAmbientStep(nowMs)
    logger.info('3D map ambient density stepped down for frame rate', { level: decision.level })
  }
  if (decision.action === 'step-down') {
    state.recordStepDown(nowMs)
    logger.info('3D map quality stepped down for frame rate', { from: active, to: decision.to })
  }
  return decision
}
