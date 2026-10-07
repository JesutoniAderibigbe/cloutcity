/**
 * Randomness for the engine. The engine never reads Math.random: callers inject a source, so a
 * seed replays the same outcomes in tests, saves and (later) server checks.
 */

/** Returns a number in [0, 1) on each call. */
export type Rng = () => number

const UINT32 = 2 ** 32

/**
 * Mulberry32: a small, fast 32-bit generator. Not cryptographic; good enough for game rolls.
 * Equal seeds give equal sequences.
 */
export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / UINT32
  }
}

/** A whole number in [min, max], from one draw. */
export function rollInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}
