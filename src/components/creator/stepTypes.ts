/**
 * What a creator step tells the modal (S16a): `commit` runs when the player presses Next (or
 * Done) and saves the step's choice through the store, returning player-facing text: the error
 * that keeps the player on the step, or null to move on (with `saved`, a line to announce).
 * `ready` false keeps Next disabled (the roll before it is rolled).
 */
export interface StepBinding {
  readonly ready: boolean
  readonly commit: () => StepCommit
}

export type StepCommit =
  | { readonly ok: true; readonly saved: string | null }
  | { readonly ok: false; readonly error: string }

export interface StepProps {
  /** Called whenever the step's binding changes. */
  readonly bind: (binding: StepBinding) => void
}

export const MOVE_ON: StepCommit = { ok: true, saved: null }

/** The creator's button frame (44 px targets, the S04g focus ring). */
export const CREATOR_BUTTON =
  'min-h-11 min-w-11 rounded-xl px-4 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60'
