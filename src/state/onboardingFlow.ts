/**
 * Where a new player goes once the character creator closes (DEC-62: sign up → creator → their
 * furnished room → the tour). Set by the sign-up and log-in screens, read by the creator; both
 * load lazily, so this never reaches the shell.
 */
import { creatorOpenStore } from './creatorOpen'
import { openHudPanel } from './hudPanel'

let afterCreator: 'home' | null = null

/** The creator now open is part of onboarding: when it closes, the player's room opens. */
export function openRoomAfterCreator(): void {
  afterCreator = 'home'
}

/** Called by the creator as it closes: opens the room once, if onboarding asked for it. */
export function creatorClosed(): void {
  // Still open: a remount (React's development double effects), not a close.
  if (afterCreator !== 'home' || creatorOpenStore.getState().open) return
  afterCreator = null
  openHudPanel('home')
}
