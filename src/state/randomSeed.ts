/**
 * A fresh uint32 seed for the engine's seeded randomness (src/engine/rng.ts), drawn here because
 * the engine never reads a random source itself. Used for a guest's random starting look and
 * the creator's rolls and "Surprise me" (S16a). `crypto.getRandomValues` exists in every
 * supported browser and in Node, so there is no weaker fallback.
 */
export function randomSeed(): number {
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
}
