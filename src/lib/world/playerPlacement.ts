/**
 * Where real players stand on the map (S42 phase 1): around the pin of the place the server says
 * they are at, in rings of `perRing`, facing the pin. Pure and deterministic: the same players at
 * the same place stand in the same spots on every device and every frame, so a fresh snapshot
 * never shuffles them. Their real position is never known or used: only the place.
 */

export interface PlacementConfig {
  readonly ringStartOfHeight: number
  readonly ringStepOfHeight: number
  readonly perRing: number
}

export interface PlacedPlayer {
  readonly id: string
  readonly x: number
  readonly y: number
  /** Turns the model's +z towards the pin (the townsfolk's convention: atan2(dx, -dy)). */
  readonly yaw: number
}

/** A stable angle offset for a place, so neighbouring pins' rings do not line up. */
function placeTurn(place: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < place.length; i++) {
    hash ^= place.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return ((hash >>> 0) / 0x1_0000_0000) * Math.PI * 2
}

/**
 * Stands `players` around their place's pin, `heightM` tall. Players at a place with no pin in
 * `pins` (a forged or unknown id, a place this map style hides) are left out.
 */
export function placePlayers(
  players: readonly { readonly id: string; readonly place: string }[],
  pins: ReadonlyMap<string, { readonly x: number; readonly y: number }>,
  heightM: number,
  config: PlacementConfig,
): PlacedPlayer[] {
  const byPlace = new Map<string, string[]>()
  for (const player of players) {
    if (!pins.has(player.place)) continue
    const list = byPlace.get(player.place)
    if (list === undefined) byPlace.set(player.place, [player.id])
    else list.push(player.id)
  }
  const out: PlacedPlayer[] = []
  const perRing = Math.max(1, Math.floor(config.perRing))
  for (const [place, ids] of byPlace) {
    const pin = pins.get(place)
    if (pin === undefined) continue
    const turn = placeTurn(place)
    ids.sort()
    ids.forEach((id, i) => {
      const ring = Math.floor(i / perRing)
      const slot = i % perRing
      const radius = heightM * (config.ringStartOfHeight + ring * config.ringStepOfHeight)
      // Every other ring sits half a slot round, so the rings interleave.
      const angle = turn + ((slot + (ring % 2) * 0.5) / perRing) * Math.PI * 2
      const x = pin.x + Math.cos(angle) * radius
      const y = pin.y + Math.sin(angle) * radius
      out.push({ id, x, y, yaw: Math.atan2(pin.x - x, -(pin.y - y)) })
    })
  }
  return out
}
