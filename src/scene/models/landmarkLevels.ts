/**
 * A Blender landmark's levels (S07c), loaded and turned into district geometry. Imported lazily
 * by src/scene/landmarks/Landmarks.tsx once the city has drawn, so the glTF loader and meshopt decoder (the model
 * runtime, its own optional chunk, src/lib/pwa/lazyChunks.ts) stay off the playable path; this
 * module is an optional chunk too (its marker: the `landmark levels: ` error prefix).
 *
 * Each level's GLB comes through the S04h model runtime and its page-wide cache, then is
 * rewritten with exactly the district buildings' attributes (position and normal float32, uv
 * float32, colour normalised uint8 RGB), in the model's own axes with the GLB node's transform
 * applied, so it draws with the district material and the program the buildings already
 * compiled: no new shader program (the props do the same, src/scene/props/mergeChunk.ts). The
 * night glow comes from the window mask: vertices with `_emissive` take the uv of a lit window,
 * every other vertex (0, 0), a wall texel. A memorial (never glows) or a teaser (dimmed toward
 * the teaser colour) passes no lit uv.
 */
import { BufferAttribute, BufferGeometry, Color, Matrix3, Vector3, type Matrix4 } from 'three'
import { acquireModels } from './runtime'
import type { ModelRef, ModelTier } from './types'
import type { StaticModel } from './prepare'

export interface GlbLevel {
  /** 0 finest .. 3 coarsest. */
  readonly level: number
  readonly geometry: BufferGeometry
  readonly triangles: number
}

export interface GlbLevelOptions {
  readonly id: string
  /** Every level's version, finest first (GeoLandmark `glb.v`). */
  readonly versions: readonly string[]
  /** The levels this tier draws, finest first. */
  readonly levels: readonly number[]
  readonly tier: ModelTier
  readonly cacheMaxEntries: number
  /** Where glowing vertices sample the window mask; null: nothing glows. */
  readonly litUv: { readonly u: number; readonly v: number } | null
  /** Teasers: every colour mixed this far toward `dimColor` (0: as authored). */
  readonly dim: { readonly color: Color; readonly mix: number } | null
  /** Yields between levels, once a slice has run long enough (src/scene/schedule.ts). */
  readonly step: () => Promise<void>
}

const toByte = (channel: number) => Math.min(255, Math.max(0, Math.round(channel * 255)))
const _v = new Vector3()
const _normal = new Matrix3()
const _color = new Color()

/** The level's model geometry in district layout, with the node transform applied. */
export function toDistrictGeometry(
  model: Pick<StaticModel, 'geometry' | 'matrix'>,
  litUv: GlbLevelOptions['litUv'],
  dim: GlbLevelOptions['dim'],
): BufferGeometry {
  const source = model.geometry
  const matrix: Matrix4 = model.matrix
  _normal.getNormalMatrix(matrix)
  const position = source.getAttribute('position')
  const normal = source.getAttribute('normal')
  const color = source.getAttribute('color')
  const emissive = litUv === null ? undefined : source.getAttribute('_emissive')
  const count = position.count
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const uvs = new Float32Array(count * 2)
  const colors = new Uint8Array(count * 3)
  for (let k = 0; k < count; k++) {
    _v.set(position.getX(k), position.getY(k), position.getZ(k)).applyMatrix4(matrix)
    positions.set([_v.x, _v.y, _v.z], k * 3)
    if (normal === undefined) _v.set(0, 1, 0)
    else _v.set(normal.getX(k), normal.getY(k), normal.getZ(k)).applyMatrix3(_normal).normalize()
    normals.set([_v.x, _v.y, _v.z], k * 3)
    // glTF COLOR_0 is linear, as are the district's colour bytes.
    if (color === undefined) _color.setScalar(1)
    else _color.fromBufferAttribute(color, k)
    if (dim !== null) _color.lerp(dim.color, dim.mix)
    colors.set([toByte(_color.r), toByte(_color.g), toByte(_color.b)], k * 3)
    if (
      litUv !== null &&
      emissive !== undefined &&
      emissive.getX(k) + emissive.getY(k) + emissive.getZ(k) > 0
    ) {
      uvs[k * 2] = litUv.u
      uvs[k * 2 + 1] = litUv.v
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new BufferAttribute(colors, 3, true))
  const index = source.getIndex()
  if (index !== null) {
    const indices = new Uint32Array(index.count)
    for (let k = 0; k < index.count; k++) indices[k] = index.getX(k)
    geometry.setIndex(new BufferAttribute(indices, 1))
  }
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  return geometry
}

/**
 * A level's URL: the file scripts/blender/ship.ts wrote, versioned by its sha256's first 8 hex
 * digits (the `files` of data/landmarks/blender.derived.json; the service worker caches exactly
 * this shape, src/sw/policy.ts).
 */
export function landmarkLevelUrl(id: string, level: number, version: string): string {
  return `/landmarks/${id}/lod${level}.glb?v=${version}`
}

/** A level as a model reference the runtime loads (one file whatever the tier). */
function levelRef(id: string, level: number, file: string): ModelRef {
  return {
    id: `${id}-lod${level}`,
    kind: 'static',
    category: 'building',
    slots: [],
    emissive: true,
    clips: [],
    files: { low: file, mid: file, high: file },
  }
}

/**
 * Loads the tier's levels and converts them. The decoded models go back to the cache as soon as
 * they are converted (the converted geometry is the caller's to dispose).
 */
export async function loadGlbLevels(options: GlbLevelOptions): Promise<GlbLevel[]> {
  const refs = options.levels.map((level) => {
    const version = options.versions[level]
    if (version === undefined)
      throw new Error(`landmark levels: ${options.id} has no version for L${level}`)
    return levelRef(options.id, level, landmarkLevelUrl(options.id, level, version))
  })
  const acquired = acquireModels(refs, options.tier, options.cacheMaxEntries)
  try {
    const models = await acquired.models
    const out: GlbLevel[] = []
    for (const [i, model] of models.entries()) {
      if (model.kind !== 'static')
        throw new Error(
          `landmark levels: ${options.id} L${options.levels[i] ?? 0} is not a static model`,
        )
      out.push({
        level: options.levels[i] ?? 0,
        geometry: toDistrictGeometry(model, options.litUv, options.dim),
        triangles: model.triangles,
      })
      await options.step()
    }
    return out
  } finally {
    acquired.release()
  }
}
