/**
 * Where the lazy living city (S04l, AmbientLife.tsx) reports to the test hook
 * (src/scene/testHooks.tsx `scene.ambient()`). Types and one slot only, so the 3D chunk never
 * pulls the ambient chunk in.
 */

export type AmbientHookStatus = 'off' | 'loading' | 'ready' | 'failed'
export type AmbientMode = 'live' | 'paused' | 'frozen'
export type AmbientPauseReason = 'hidden' | 'focus' | 'reduced-motion' | 'context' | 'test'

export interface AmbientHookState {
  readonly status: AmbientHookStatus
  readonly mode: AmbientMode
  readonly pauseReason: AmbientPauseReason | null
  /** The city clock the drawn positions are for (ms). */
  readonly clockMs: number
  /** Density step-down level (quality store `ambientSteps`). */
  readonly densityLevel: number
  readonly drawn: {
    readonly vehicles: number
    readonly buses: number
    readonly pedestrians: number
    readonly trainCars: number
  }
  readonly triangles: number
  readonly drawCalls: number
  /** Every ambient mesh draws with the blocks' shader program. */
  readonly sameProgramAsBlocks: boolean
  /** No ambient mesh uses three's raycast. */
  readonly raycastOff: boolean
  readonly inMemorialClearance: number
  readonly positionsHash: string
  /** Frames the ambient ticker has requested. */
  readonly ticks: number
  /** The townsfolk (S04o): what the last frame drew, and each drawn local's middle (client px). */
  readonly townsfolk: {
    readonly status: 'off' | 'loading' | 'ready' | 'failed'
    readonly drawn: number
    readonly triangles: number
    readonly drawCalls: number
    readonly kitsDrawn: number
    readonly points: readonly { readonly id: string; readonly x: number; readonly y: number }[]
  }
  /** The sky (S04q): what the last frame drew, and whether it added a shader program. */
  readonly planes: {
    readonly status: 'off' | 'ready'
    readonly planes: number
    readonly helicopters: number
    readonly drawCalls: number
    readonly triangles: number
    /** Bodies, livery and rotors draw with the blocks' program. */
    readonly sameProgramAsBlocks: boolean
    /** The lamps draw with the map pins' night-glow program. */
    readonly lampsSameProgramAsPins: boolean
  }
}

/** Set by AmbientLife for its life; read by the test hook. */
export const ambientHook: { current: (() => AmbientHookState) | null } = { current: null }

/** The `cc:test:ambient` init-script key (test-hook builds only): `live` or `frozen:<ms>`. */
export const AMBIENT_TEST_KEY = 'cc:test:ambient'
