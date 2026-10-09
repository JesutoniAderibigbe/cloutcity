/**
 * Flat normals for the baked character kits (S04q): their frames are rewritten in place, so the
 * normals are recomputed per triangle from the new positions. Shared by the townsfolk
 * (townsfolk.ts) and the venue interiors' locals (src/scene/venue/crowdLayer.ts).
 */

/** Flat per-triangle normals of a non-indexed position array (9 floats a triangle). */
export function flatNormals(positions: ArrayLike<number>, out: Float32Array): void {
  for (let i = 0; i + 8 < positions.length; i += 9) {
    const ax = positions[i] ?? 0
    const ay = positions[i + 1] ?? 0
    const az = positions[i + 2] ?? 0
    const ux = (positions[i + 3] ?? 0) - ax
    const uy = (positions[i + 4] ?? 0) - ay
    const uz = (positions[i + 5] ?? 0) - az
    const vx = (positions[i + 6] ?? 0) - ax
    const vy = (positions[i + 7] ?? 0) - ay
    const vz = (positions[i + 8] ?? 0) - az
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const length = Math.hypot(nx, ny, nz)
    if (length > 0) {
      nx /= length
      ny /= length
      nz /= length
    } else {
      nx = 0
      ny = 1
      nz = 0
    }
    for (let k = 0; k < 9; k += 3) {
      out[i + k] = nx
      out[i + k + 1] = ny
      out[i + k + 2] = nz
    }
  }
}
