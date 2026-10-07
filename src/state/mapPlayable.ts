/**
 * Whether the map is playable (S05b): the scene has drawn, or failed and left the Places panel
 * as the way to play. Audio waits for it so sound never competes with the map for bandwidth
 * (CLAUDE.md "Performance budgets": audio is excluded from the bytes to playable).
 *
 * Until S04a lands, the scene placeholder marks the map playable on mount; then the 3D scene's
 * ready and error callbacks do.
 */

export interface MapPlayableSignal {
  markMapPlayable(): void
  isMapPlayable(): boolean
  /** Resolves once the map is playable (at once if it already is). */
  whenMapPlayable(): Promise<void>
}

export function createMapPlayableSignal(): MapPlayableSignal {
  let playable = false
  let resolve: () => void = () => undefined
  const ready = new Promise<void>((done) => {
    resolve = done
  })
  return {
    markMapPlayable: () => {
      playable = true
      resolve()
    },
    isMapPlayable: () => playable,
    whenMapPlayable: () => ready,
  }
}

const signal = createMapPlayableSignal()

export const markMapPlayable = signal.markMapPlayable
export const isMapPlayable = signal.isMapPlayable
export const whenMapPlayable = signal.whenMapPlayable
