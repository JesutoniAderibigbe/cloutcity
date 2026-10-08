/**
 * Which ambient instances are drawn (S04l): the candidates in the view, nearest the camera first,
 * up to the tier's cap. The runtime passes its frustum test; the sim's poses give the rest.
 * Nothing is allocated per call: indices go into the caller's buffer.
 */

export interface DrawCandidates {
  /** How many candidates there are. */
  readonly count: number
  /** Squared distance of candidate i to the camera. */
  distanceSq(i: number): number
  /** Whether candidate i should be drawn at all (active, faded in, in the view). */
  visible(i: number): boolean
}

/**
 * Writes the indices of the drawn candidates into `out` (nearest first, ties by index) and
 * returns how many: at most `cap`, and at most `out.length`.
 */
export function selectDrawn(candidates: DrawCandidates, cap: number, out: Int32Array): number {
  const limit = Math.min(cap, out.length)
  if (limit <= 0) return 0
  let n = 0
  // Insertion into a sorted prefix of at most `limit`: candidate counts are a few hundred.
  for (let i = 0; i < candidates.count; i++) {
    if (!candidates.visible(i)) continue
    const d = candidates.distanceSq(i)
    if (n === limit && d >= candidates.distanceSq(out[n - 1] ?? 0)) continue
    let j = n < limit ? n++ : n - 1
    while (j > 0) {
      const prev = out[j - 1] ?? 0
      if (candidates.distanceSq(prev) <= d) break
      out[j] = prev
      j--
    }
    out[j] = i
  }
  return n
}
