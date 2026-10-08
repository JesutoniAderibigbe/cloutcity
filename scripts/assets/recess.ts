/**
 * GLOW-1 "recessed pane" rule (S04i): which triangles of a glass token are real window glass.
 *
 * Kenney's commercial buildings paint glass, frames and trim bands with one grey, so glowing the
 * whole token lit up every frame at night. Real panes are set back into the facade: a pane is a
 * vertical, coplanar patch of glass-token triangles whose border is (almost) all reveal faces,
 * which are faces perpendicular to the patch that stand out from it, towards its normal. Frame
 * steps and trim bands fail: part of their border meets a deeper surface (an inward reveal) or
 * runs flush into the wall. Pure geometry, no Blender and no added triangles, so it applies to
 * any future model whose windows are recessed.
 */

/** Tuning of the rule; the defaults fit Kenney's packs at model scale (metres). */
export interface RecessOptions {
  /** A triangle is vertical when |normal.y| is below this. */
  readonly maxNormalY: number
  /** Share of the patch border (by length) that must meet an outward reveal. */
  readonly minRevealShare: number
  /** Largest share of the border allowed to meet an inward reveal (a deeper surface). */
  readonly maxInwardShare: number
  /** Distance below which points count as on a plane or edge (metres). */
  readonly epsM: number
  /** Smaller patches are slivers left by simplification, not panes (square metres). */
  readonly minPaneAreaM2: number
}

export const RECESS_DEFAULTS: RecessOptions = {
  maxNormalY: 0.3,
  minRevealShare: 0.6,
  maxInwardShare: 0.1,
  epsM: 1e-3,
  minPaneAreaM2: 0.3,
}

type V3 = readonly [number, number, number]

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const length = (a: V3) => Math.hypot(a[0], a[1], a[2])

/** Endpoint key quantised to 1e-4 m, so welded and unwelded corners match. */
const key = (p: V3) =>
  `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`

interface Tri {
  readonly v: readonly [V3, V3, V3]
  readonly n: V3
  readonly area: number
}

function triangles(positions: ArrayLike<number>): Tri[] {
  const out: Tri[] = []
  for (let i = 0; i + 8 < positions.length; i += 9) {
    const p = (k: number): V3 => [
      positions[i + k] ?? 0,
      positions[i + k + 1] ?? 0,
      positions[i + k + 2] ?? 0,
    ]
    const v: [V3, V3, V3] = [p(0), p(3), p(6)]
    const c = cross(sub(v[1], v[0]), sub(v[2], v[0]))
    const l = length(c)
    out.push({ v, n: l > 0 ? [c[0] / l, c[1] / l, c[2] / l] : [0, 0, 0], area: l / 2 })
  }
  return out
}

/** Whether point `p` lies inside triangle `t` (or on its border), within `eps` of its plane. */
function contains(t: Tri, p: V3, eps: number): boolean {
  if (t.area === 0 || Math.abs(dot(sub(p, t.v[0]), t.n)) > eps) return false
  for (let k = 0; k < 3; k++) {
    const a = t.v[k] ?? t.v[0]
    const b = t.v[(k + 1) % 3] ?? t.v[0]
    const edge = sub(b, a)
    // Signed distance of p from the edge line, inside the triangle's plane.
    const inward = cross(t.n, edge)
    const l = length(inward)
    if (l > 0 && dot(sub(p, a), inward) / l < -eps) return false
  }
  return true
}

/**
 * One flag per triangle of a flat triangle soup (`positions`: 9 numbers per triangle): true
 * when the triangle is a `candidate` (a glass-token triangle) inside a recessed pane.
 */
export function recessedPanes(
  positions: ArrayLike<number>,
  candidate: ArrayLike<boolean | number>,
  options: RecessOptions = RECESS_DEFAULTS,
): boolean[] {
  const tris = triangles(positions)
  const eps = options.epsM
  const isCandidate = tris.map(
    (t, i) => Boolean(candidate[i]) && t.area > 0 && Math.abs(t.n[1]) < options.maxNormalY,
  )

  // Coplanar candidate triangles sharing a corner form one patch (union-find).
  const parent = tris.map((_, i) => i)
  const find = (i: number): number => {
    let r = i
    while (parent[r] !== r) r = parent[r] ?? r
    while (parent[i] !== r) {
      const next = parent[i] ?? r
      parent[i] = r
      i = next
    }
    return r
  }
  const byCorner = new Map<string, number[]>()
  tris.forEach((t, i) => {
    if (!isCandidate[i]) return
    for (const p of t.v) {
      const k = key(p)
      const list = byCorner.get(k)
      if (list === undefined) byCorner.set(k, [i])
      else list.push(i)
    }
  })
  const coplanar = (a: Tri, b: Tri) =>
    dot(a.n, b.n) > 0.999 && Math.abs(dot(sub(b.v[0], a.v[0]), a.n)) <= eps
  for (const list of byCorner.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const i = list[x] ?? 0
        const j = list[y] ?? 0
        const ti = tris[i]
        const tj = tris[j]
        if (ti !== undefined && tj !== undefined && coplanar(ti, tj)) parent[find(j)] = find(i)
      }
    }
  }

  const patches = new Map<number, number[]>()
  tris.forEach((_, i) => {
    if (!isCandidate[i]) return
    const r = find(i)
    const list = patches.get(r)
    if (list === undefined) patches.set(r, [i])
    else list.push(i)
  })

  const result = tris.map(() => false)
  for (const members of patches.values()) {
    // Border edges: edges used by exactly one triangle of the patch.
    const edges = new Map<string, { a: V3; b: V3; uses: number }>()
    for (const i of members) {
      const t = tris[i]
      if (t === undefined) continue
      for (let k = 0; k < 3; k++) {
        const a = t.v[k] ?? t.v[0]
        const b = t.v[(k + 1) % 3] ?? t.v[0]
        const ka = key(a)
        const kb = key(b)
        const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
        const edge = edges.get(id)
        if (edge === undefined) edges.set(id, { a, b, uses: 1 })
        else edge.uses++
      }
    }
    const normal = tris[members[0] ?? 0]?.n ?? [0, 0, 0]
    const memberSet = new Set(members)
    let border = 0
    let outward = 0
    let inward = 0
    for (const { a, b, uses } of edges.values()) {
      if (uses !== 1) continue
      const edgeLength = length(sub(b, a))
      border += edgeLength
      const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
      let out = false
      let back = false
      for (let j = 0; j < tris.length && !(out && back); j++) {
        const t = tris[j]
        if (t === undefined || memberSet.has(j) || t.area === 0) continue
        if (Math.abs(dot(t.n, normal)) > 0.1) continue
        if (!contains(t, mid, eps)) continue
        let hi = -Infinity
        let lo = Infinity
        for (const p of t.v) {
          const h = dot(sub(p, mid), normal)
          hi = Math.max(hi, h)
          lo = Math.min(lo, h)
        }
        if (hi > eps && lo >= -eps) out = true
        if (lo < -eps && hi <= eps) back = true
      }
      if (out) outward += edgeLength
      if (back) inward += edgeLength
    }
    const area = members.reduce((sum, i) => sum + (tris[i]?.area ?? 0), 0)
    if (
      area >= options.minPaneAreaM2 &&
      border > 0 &&
      outward / border >= options.minRevealShare &&
      inward / border <= options.maxInwardShare
    ) {
      for (const i of members) result[i] = true
    }
  }
  return result
}
