/**
 * The living city's density step-downs (S04l, DEC-52): the FPS step-down lowers ambient density
 * before it drops a tier. Session state kept here, in the 3D chunk, rather than in the quality
 * store the shell carries. The lazy ambient chunk registers how many levels it has and its own
 * FPS floor (for when it alone keeps the map animating); decline.ts takes the steps. A step
 * shares the tier step's cooldown and carries over a tier change.
 */

export interface AmbientStepsState {
  /** Density steps taken this session. */
  readonly steps: number
  /** Steps the living city allows (0 until it has loaded). */
  readonly max: number
  /** Its FPS floor while it alone keeps the map animating, or null. */
  readonly belowFps: number | null
  readonly lastStepAtMs: number | null
}

let state: AmbientStepsState = { steps: 0, max: 0, belowFps: null, lastStepAtMs: null }
const listeners = new Set<() => void>()

const write = (next: AmbientStepsState) => {
  state = next
  for (const listener of listeners) listener()
}

export const ambientSteps = {
  get: (): AmbientStepsState => state,
  /** The living city mounted (its levels and floor) or went (0, null). */
  register: (max: number, belowFps: number | null) => write({ ...state, max, belowFps }),
  record: (nowMs: number) => write({ ...state, steps: state.steps + 1, lastStepAtMs: nowMs }),
  /** @internal Tests start a fresh session. */
  reset: () => write({ steps: 0, max: 0, belowFps: null, lastStepAtMs: null }),
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}
