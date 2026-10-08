/**
 * Home actions the room's Sim should act out (S40c): the Home panel reports each one the engine
 * accepted, and the room avatar (src/scene/apartment/RoomAvatar.tsx) walks to the bed, the stove
 * or a seat to do it. Session-only and tiny like apartmentView.ts; imported only by those two
 * lazy chunks. The action has already been applied in full (clock, stats) when it is reported:
 * this is what the player sees, never a timer.
 */

const listeners = new Set<(actionId: string) => void>()

/** Reports home action `actionId`, just done, to the room. */
export function playRoomActivity(actionId: string): void {
  for (const listener of listeners) listener(actionId)
}

/** Listens for home actions done; returns the function that stops listening. */
export function onRoomActivity(listener: (actionId: string) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
