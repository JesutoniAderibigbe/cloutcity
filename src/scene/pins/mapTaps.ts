/**
 * Taps on the map that something drawn over the pins claims first (S04o: a tap on a local opens
 * their card instead of the place behind them). Every claimer sees every tap, so one can also
 * react to a tap it does not claim (the open card closes when the map is tapped elsewhere).
 * Coordinates are CSS px relative to the canvas.
 */
export type MapTapClaim = (x: number, y: number, width: number, height: number) => boolean

const claims = new Set<MapTapClaim>()

/** Registers a claimer; returns the unregister function. */
export function claimMapTaps(claim: MapTapClaim): () => void {
  claims.add(claim)
  return () => {
    claims.delete(claim)
  }
}

/** Whether any claimer took the tap (all of them see it). */
export function mapTapClaimed(x: number, y: number, width: number, height: number): boolean {
  let claimed = false
  for (const claim of claims) if (claim(x, y, width, height)) claimed = true
  return claimed
}
