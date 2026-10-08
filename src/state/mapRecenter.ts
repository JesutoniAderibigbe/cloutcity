/**
 * The Map tab's "back to me" request: tapped while the map already has the screen, it asks the
 * 3D map to glide back to the player at the default view. Session-only and tiny like
 * sceneFocus.ts: the shell's tab bar sends it and the city's 3D chunk listens, without either
 * importing the other.
 */
const listeners = new Set<() => void>()

/** Asks the map camera to glide back to the player at the default view. */
export function requestMapRecenter(): void {
  for (const listener of listeners) listener()
}

/** Listens for recentre requests; returns the function that stops listening. */
export function onMapRecenter(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
