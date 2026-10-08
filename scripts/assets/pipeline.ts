/**
 * Turns one catalog model into its per-tier GLBs.
 *
 * Static models: every primitive of every entry is baked to per-triangle vertex colours,
 * harmonised (harmonise.ts), moved into model space and merged into ONE mesh with ONE primitive
 * and one placeholder material (Part 2 swaps in the shared lit/toon material). UVs, tangents and
 * images are dropped. `_EMISSIVE` (VEC3, linear RGB, u8 normalised; zero = no glow) carries each
 * vertex's night-glow colour (S04f night-glow contract) and `_SLOT` (u8) the
 * recolourable regions; each is written only when the model uses it.
 *
 * Skinned models keep one skinned mesh and its joints (avatar heads and bodies share the Kenney
 * rig, so Part 2 rebinds them to one skeleton). Rigs keep the joints and the listed clips only.
 *
 * Lower tiers simplify the source meshes before the bake (simplifySource). Every tier then runs
 * dedup → prune → weld → quantize → reorder → meshopt. The
 * meshopt vertex codec is forced to v0 so three r182's bundled decoder (meshoptimizer 0.22)
 * reads every file; decode.test.ts proves it.
 */
import { posix } from 'node:path'
import {
  Document,
  GLB_BUFFER,
  NodeIO,
  type ILogger,
  type Mesh,
  type Node,
  type GLTF,
  type Primitive,
  type Skin,
  type TypedArray,
} from '@gltf-transform/core'
import {
  ALL_EXTENSIONS,
  EXTMeshoptCompression,
  KHRMeshQuantization,
} from '@gltf-transform/extensions'
import {
  dedup,
  prune,
  quantize,
  reorder,
  resample,
  weld,
  weldPrimitive,
} from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import { MODEL_TIERS, type ModelTier } from '../../src/lib/data/schemas/assets.ts'
import { TextureCache, triangleColours, triangleIndices } from './bake.ts'
import { recessedPanes } from './recess.ts'
import { externalUris, packRoot, readGltfContainer, resolveUri, type Pack } from './fetch.ts'
import {
  deltaE2000,
  harmoniseAll,
  hexToLinear,
  linearToHex,
  linearToLab,
  swatchesFor,
  type Grade,
  type Rgb,
  type Anchor,
} from './harmonise.ts'
import { clipName, clipSource, type Box3, type JointMap, type Model } from './schema.ts'

export interface BuiltTier {
  readonly bytes: Uint8Array
  readonly triangles: number
}

export interface BuiltModel {
  readonly model: Model
  readonly tiers: Readonly<Record<ModelTier, BuiltTier>>
  readonly bounds: { readonly min: Vec3; readonly max: Vec3 } | undefined
  readonly emissive: boolean
  /** Colour report: token (or graded hex when nothing was close) → triangle count. */
  readonly colours: ReadonlyMap<string, number>
  readonly warnings: readonly string[]
  /** Bind-pose measurements of a modular part or rig (data/avatar/frame.json, S16b). */
  readonly frame?: AvatarFrame
}

export interface BuildContext {
  /** Theme `models` tokens → sRGB hex. */
  readonly palette: Readonly<Record<string, string>>
  readonly maxDeltaE: number
  readonly grade: Grade
  /** The catalog's joint maps (S16b), by id. */
  readonly jointMaps: Readonly<Record<string, JointMap>>
}

/** Collects glTF Transform's warnings so the build prints them per model instead of console. */
class CollectingLogger implements ILogger {
  readonly warnings: string[] = []
  debug(): void {}
  info(): void {}
  warn(text: string): void {
    this.warnings.push(text)
  }
  error(text: string): void {
    this.warnings.push(`error: ${text}`)
  }
}

/**
 * Meshopt encoder with the vertex codec pinned to v0: meshoptimizer ≥ 0.23 can emit v1 vertex
 * streams, which the 0.22 decoder bundled with three r182 cannot read.
 */
const encoderV0 = {
  ...MeshoptEncoder,
  encodeGltfBuffer: (source: Uint8Array, count: number, size: number, mode: string) =>
    MeshoptEncoder.encodeGltfBuffer(source, count, size, mode, 0),
}

/** Attributes quantize() may touch; COLOR_0, _EMISSIVE and _SLOT are already 8-bit. */
const QUANTIZE_PATTERN = /^(?:POSITION|NORMAL|JOINTS_\d+|WEIGHTS_\d+)$/

const SKINNED_QUANTIZE_PATTERN = /^(?:JOINTS_\d+|WEIGHTS_\d+)$/

const KEPT_EXTENSIONS = new Set(['EXT_meshopt_compression', 'KHR_mesh_quantization'])

type Mat4 = readonly number[]

function transformPoint(m: Mat4, x: number, y: number, z: number): [number, number, number] {
  return [
    (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0),
    (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0),
    (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0),
  ]
}

/** Inverse transpose of the upper 3×3 (column-major), so normals survive non-uniform scale. */
function normalMatrix(m: Mat4): { matrix: number[]; determinant: number } {
  const a = m[0] ?? 0
  const b = m[1] ?? 0
  const c = m[2] ?? 0
  const d = m[4] ?? 0
  const e = m[5] ?? 0
  const f = m[6] ?? 0
  const g = m[8] ?? 0
  const h = m[9] ?? 0
  const i = m[10] ?? 0
  const determinant = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e)
  if (determinant === 0) throw new Error('degenerate node transform')
  const k = 1 / determinant
  // Cofactor matrix = (inverse)ᵀ · det.
  return {
    determinant,
    matrix: [
      (e * i - f * h) * k,
      (g * f - d * i) * k,
      (d * h - g * e) * k,
      (h * c - b * i) * k,
      (a * i - g * c) * k,
      (g * b - a * h) * k,
      (b * f - e * c) * k,
      (d * c - a * f) * k,
      (a * e - d * b) * k,
    ],
  }
}

/** Entry placement for composites: rotate about Y, then offset. */
function entryMatrix(rotateYDeg = 0, at: readonly number[] = [0, 0, 0]): number[] {
  const r = (rotateYDeg * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return [cos, 0, -sin, 0, 0, 1, 0, 0, sin, 0, cos, 0, at[0] ?? 0, at[1] ?? 0, at[2] ?? 0, 1]
}

function multiply(a: Mat4, b: Mat4): number[] {
  const out = new Array<number>(16).fill(0)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + row] ?? 0) * (b[col * 4 + k] ?? 0)
      out[col * 4 + row] = sum
    }
  }
  return out
}

function readerIO(logger: ILogger): NodeIO {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).setLogger(logger)
}

/** Reads one model entry (and the buffers and textures it names) from the pack, in memory. */
export async function loadEntry(pack: Pack, path: string, logger: ILogger): Promise<Document> {
  const full = posix.join(packRoot(pack.source), path)
  const bytes = pack.files.get(full)
  if (bytes === undefined) throw new Error(`${pack.source.id}: ${full} is not in the pack`)
  const { json, bin } = readGltfContainer(bytes)
  // Copies: glTF Transform wants ArrayBuffer-backed views, and the reader must not alias the pack.
  const resources: Record<string, Uint8Array<ArrayBuffer>> = {}
  if (bin !== undefined) resources[GLB_BUFFER] = new Uint8Array(bin)
  for (const uri of externalUris(json)) {
    const resolved = resolveUri(full, uri)
    const data = pack.files.get(resolved)
    if (data === undefined)
      throw new Error(`${pack.source.id}: ${resolved} (from ${full}) is missing`)
    resources[uri] = new Uint8Array(data)
  }
  const doc = await readerIO(logger).readJSON({ json: json as unknown as GLTF.IGLTF, resources })
  doc.setLogger(logger)
  return doc
}

interface Classified {
  readonly linear: Rgb
  /** Linear night-glow colour for `_EMISSIVE`, or undefined when the colour does not glow. */
  readonly emissive: Rgb | undefined
  readonly token: string | undefined
  readonly label: string
}

const inBox = (box: Box3, p: readonly number[]) =>
  [0, 1, 2].every((k) => (p[k] ?? 0) >= (box.min[k] ?? 0) && (p[k] ?? 0) <= (box.max[k] ?? 0))

/** Where a triangle comes from, for the slot rules beyond its token (S16b). */
interface TriangleOrigin {
  readonly material?: string
  readonly mesh?: string
}

/**
 * `_SLOT` value: 1 + the first slot whose tokens, materials and meshes (and joints, for skinned
 * parts) match, whose `box` (if any) holds the triangle's centroid (fitted metres) and whose
 * `exclude` box does not; else 0.
 */
function slotOf(
  model: Model,
  token: string | undefined,
  joint?: string,
  centroid?: readonly number[],
  origin: TriangleOrigin = {},
): number {
  const index = model.slots.findIndex(
    (slot) =>
      (slot.tokens === undefined || (token !== undefined && slot.tokens.includes(token))) &&
      (slot.materials === undefined ||
        (origin.material !== undefined && slot.materials.includes(origin.material))) &&
      (slot.meshes === undefined ||
        (origin.mesh !== undefined && slot.meshes.includes(origin.mesh))) &&
      (slot.joints === undefined || (joint !== undefined && slot.joints.includes(joint))) &&
      (slot.box === undefined || (centroid !== undefined && inBox(slot.box, centroid))) &&
      (slot.exclude === undefined || centroid === undefined || !inBox(slot.exclude.box, centroid)),
  )
  return index + 1
}

/** Each triangle's centroid in fitted metres (`scale` × source units) of a deindexed primitive. */
function centroids(prim: Primitive, scale: number): number[][] {
  const position = prim.getAttribute('POSITION')
  if (position === null) return []
  const p: number[] = []
  const out: number[][] = []
  for (let t = 0; t < position.getCount() / 3; t++) {
    const c = [0, 0, 0]
    for (let k = 0; k < 3; k++) {
      position.getElement(t * 3 + k, p)
      for (let a = 0; a < 3; a++) c[a] = (c[a] ?? 0) + ((p[a] ?? 0) * scale) / 3
    }
    out.push(c)
  }
  return out
}

/** Whether a triangle matches a `strip` rule: its source colour near one listed, inside the box. */
function stripped(model: Model, colour: Rgb, centroid: readonly number[]): boolean {
  if (model.strip === undefined) return false
  const lab = linearToLab(colour)
  return model.strip.some(
    (rule) =>
      inBox(rule.box, centroid) &&
      rule.colors.some(
        (hex) => deltaE2000(lab, linearToLab(hexToLinear(hex))) <= (rule.maxDeltaE ?? 2),
      ),
  )
}

/** Keeps the triangles of a deindexed primitive where `keep` is true. */
function keepTriangles(doc: Document, prim: Primitive, keep: readonly boolean[]): void {
  for (const semantic of prim.listSemantics()) {
    const src = prim.getAttribute(semantic)
    const array = src?.getArray()
    if (src === null || array === null || array === undefined) continue
    const size = src.getElementSize()
    const Ctor = array.constructor as new (length: number) => TypedArray
    const out = new Ctor(keep.filter(Boolean).length * 3 * size)
    let at = 0
    keep.forEach((kept, t) => {
      if (!kept) return
      for (let i = 0; i < 3 * size; i++) out[at++] = array[t * 3 * size + i] ?? 0
    })
    prim.setAttribute(
      semantic,
      doc
        .createAccessor()
        .setType(src.getType())
        .setArray(out)
        .setNormalized(src.getNormalized())
        .setBuffer(src.getBuffer()),
    )
  }
}

const colourKey = (rgb: Rgb) => `${rgb[0]},${rgb[1]},${rgb[2]}`

/**
 * Harmonises every triangle colour of a model together (harmoniseAll needs the whole model to
 * re-centre each swatch group) and returns a lookup from source colour to its classification.
 */
function colourClassifier(model: Model, ctx: BuildContext, triangles: readonly Rgb[]) {
  const index = new Map<string, number>()
  const colours: Rgb[] = []
  const weights: number[] = []
  for (const rgb of triangles) {
    const key = colourKey(rgb)
    const at = index.get(key)
    if (at === undefined) {
      index.set(key, colours.length)
      colours.push(rgb)
      weights.push(1)
    } else weights[at] = (weights[at] ?? 0) + 1
  }
  const anchors: Anchor[] = Object.entries(model.remap ?? {}).map(([hex, token]) => {
    const [swatch] = swatchesFor([token], ctx.palette)
    if (swatch === undefined) throw new Error(`${model.id}: unknown token ${token}`)
    return {
      lab: linearToLab(hexToLinear(hex)),
      swatch,
      ...(model.remapMaxDeltaE !== undefined && { maxDeltaE: model.remapMaxDeltaE }),
    }
  })
  const harmonised = harmoniseAll(
    { colours, weights, anchors },
    ctx.grade,
    swatchesFor(model.swatches, ctx.palette),
    model.maxDeltaE ?? ctx.maxDeltaE,
  )
  const classified = harmonised.map(({ linear, token }): Classified => ({
    linear,
    emissive:
      token !== undefined && model.emissive.includes(token)
        ? glowColour(model, ctx, token)
        : undefined,
    token,
    label: token ?? `~${linearToHex(linear)}`,
  }))
  return (rgb: Rgb): Classified => {
    const hit = classified[index.get(colourKey(rgb)) ?? -1]
    if (hit === undefined)
      throw new Error(`${model.id}: colour ${colourKey(rgb)} was not classified`)
    return hit
  }
}

/** The glow colour of an emissive token: its catalog `glow` override, else the token itself. */
function glowColour(model: Model, ctx: BuildContext, token: string): Rgb {
  const [swatch] = swatchesFor([model.glow?.[token] ?? token], ctx.palette)
  if (swatch === undefined) throw new Error(`${model.id}: unknown glow token`)
  return swatch.linear
}

const toU8 = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255)

interface Soup {
  positions: number[]
  normals: number[]
  colours: number[]
  emissive: number[]
  slots: number[]
}

function addPrimitive(
  model: Model,
  soup: Soup,
  prim: Primitive,
  world: Mat4,
  colours: readonly Rgb[],
  classify: (c: Rgb) => Classified,
  counts: Map<string, number>,
  origin: TriangleOrigin = {},
) {
  const position = prim.getAttribute('POSITION')
  if (position === null) throw new Error('primitive without POSITION')
  const normal = prim.getAttribute('NORMAL')
  const indices = triangleIndices(prim)
  const { matrix: nm, determinant } = normalMatrix(world)
  // A mirroring transform flips winding; swap two corners to keep faces pointing out.
  const order = determinant < 0 ? [0, 2, 1] : [0, 1, 2]
  const p: number[] = []
  const n: number[] = []
  for (let t = 0; t < indices.length; t += 3) {
    const c = classify(colours[t / 3] ?? [1, 1, 1])
    counts.set(c.label, (counts.get(c.label) ?? 0) + 1)
    const corners = order.map((k) => indices[t + k] ?? 0)
    const world3 = corners.map((index) => {
      position.getElement(index, p)
      return transformPoint(world, p[0] ?? 0, p[1] ?? 0, p[2] ?? 0)
    })
    let flat: number[] | undefined
    if (normal === null) {
      const [a = [0, 0, 0], b = [0, 0, 0], d = [0, 0, 0]] = world3
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const
      const v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]] as const
      flat = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    }
    for (const [k, index] of corners.entries()) {
      const point = world3[k] ?? [0, 0, 0]
      soup.positions.push(point[0] ?? 0, point[1] ?? 0, point[2] ?? 0)
      let nx: number
      let ny: number
      let nz: number
      if (flat === undefined && normal !== null) {
        normal.getElement(index, n)
        nx = (nm[0] ?? 0) * (n[0] ?? 0) + (nm[3] ?? 0) * (n[1] ?? 0) + (nm[6] ?? 0) * (n[2] ?? 0)
        ny = (nm[1] ?? 0) * (n[0] ?? 0) + (nm[4] ?? 0) * (n[1] ?? 0) + (nm[7] ?? 0) * (n[2] ?? 0)
        nz = (nm[2] ?? 0) * (n[0] ?? 0) + (nm[5] ?? 0) * (n[1] ?? 0) + (nm[8] ?? 0) * (n[2] ?? 0)
      } else {
        ;[nx, ny, nz] = (flat ?? [0, 1, 0]) as [number, number, number]
      }
      const length = Math.hypot(nx, ny, nz) || 1
      soup.normals.push(nx / length, ny / length, nz / length)
      soup.colours.push(toU8(c.linear[0]), toU8(c.linear[1]), toU8(c.linear[2]))
      const glow = c.emissive ?? [0, 0, 0]
      soup.emissive.push(toU8(glow[0]), toU8(glow[1]), toU8(glow[2]))
      soup.slots.push(slotOf(model, c.token, undefined, undefined, origin))
    }
  }
}

/**
 * GLOW-1: of the emissive-token triangles, only those in recessed panes keep their glow
 * (recess.ts); frames and trim painted with the same colour go dark. `emissive` holds three
 * corners of three bytes per triangle, in the same order as `positions`.
 */
function keepRecessedGlow(emissive: number[], positions: Float32Array) {
  const triangles = positions.length / 9
  const candidate = Array.from({ length: triangles }, (_, t) =>
    emissive.slice(t * 9, t * 9 + 9).some((v) => v > 0),
  )
  const panes = recessedPanes(positions, candidate)
  for (let t = 0; t < triangles; t++) {
    if (!panes[t]) emissive.fill(0, t * 9, t * 9 + 9)
  }
}

type Vec3 = [number, number, number]
interface Box {
  readonly min: Vec3
  readonly max: Vec3
}

function bounds(positions: ArrayLike<number>): Box {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k] ?? 0
      if (v < (min[k] ?? 0)) min[k] = v
      if (v > (max[k] ?? 0)) max[k] = v
    }
  }
  return { min, max }
}

function fitScale(model: Model, box: Box): number {
  const size = box.max.map((v, k) => v - (box.min[k] ?? 0))
  const { fit } = model
  if ('scale' in fit) return fit.scale
  const measure = 'height' in fit ? (size[1] ?? 0) : Math.max(size[0] ?? 0, size[2] ?? 0)
  if (!(measure > 0)) throw new Error(`${model.id}: cannot fit a model with no extent`)
  return ('height' in fit ? fit.height : fit.length) / measure
}

/** Rounds to 1e-4 m so bounds in the manifest do not churn on float noise. */
const round = (value: number) => Math.round(value * 10_000) / 10_000 + 0

function fittedBounds(box: Box): Box {
  const r = ([x, y, z]: Vec3): Vec3 => [round(x), round(y), round(z)]
  return { min: r(box.min), max: r(box.max) }
}

async function buildStatic(
  model: Model,
  pack: Pack,
  ctx: BuildContext,
  logger: CollectingLogger,
  tier: ModelTier,
) {
  const textures = new TextureCache()
  const parts: { prim: Primitive; world: Mat4; colours: Rgb[]; origin: TriangleOrigin }[] = []
  for (const entry of model.entries) {
    const src = await loadEntry(pack, entry.path, logger)
    const place = entryMatrix(entry.rotateYDeg, entry.at)
    if (model.fromSkinned !== undefined) {
      parts.push(...skinnedPieces(model, src, entry.path, tier, textures, pack, place))
      continue
    }
    const scene = src.getRoot().getDefaultScene() ?? src.getRoot().listScenes()[0]
    if (scene === undefined) throw new Error(`${model.id}: ${entry.path} has no scene`)
    const tierRule = model.tiers[tier]
    if (!('ratio' in tierRule)) throw new Error(`${model.id}: triangle targets need fromSkinned`)
    scene.traverse((node: Node) => {
      const mesh = node.getMesh()
      if (mesh === null) return
      if (node.getSkin() !== null) throw new Error(`${model.id}: static model with a skinned mesh`)
      const world = multiply(place, node.getWorldMatrix())
      for (const prim of mesh.listPrimitives()) {
        simplifySource(src, prim, tierRule.ratio, tierRule.error, tierRule.flags)
        parts.push({
          prim,
          world,
          colours: triangleColours(prim, textures, pack.source.factorEncoding),
          origin: {},
        })
      }
    })
  }
  const classify = colourClassifier(
    model,
    ctx,
    parts.flatMap((part) => part.colours),
  )
  const counts = new Map<string, number>()
  const soup: Soup = { positions: [], normals: [], colours: [], emissive: [], slots: [] }
  for (const part of parts)
    addPrimitive(model, soup, part.prim, part.world, part.colours, classify, counts, part.origin)
  if (soup.positions.length === 0) throw new Error(`${model.id}: no triangles`)

  const box = bounds(soup.positions)
  const scale = fitScale(model, box)
  const centre = [
    ((box.min[0] ?? 0) + (box.max[0] ?? 0)) / 2,
    model.pivot === 'center' ? ((box.min[1] ?? 0) + (box.max[1] ?? 0)) / 2 : (box.min[1] ?? 0),
    ((box.min[2] ?? 0) + (box.max[2] ?? 0)) / 2,
  ]
  const shift = model.pivot === 'source' ? [0, 0, 0] : centre
  const positions = Float32Array.from(soup.positions, (v, i) => (v - (shift[i % 3] ?? 0)) * scale)
  if (model.glowRule === 'recessed') keepRecessedGlow(soup.emissive, positions)

  const doc = new Document().setLogger(logger)
  const buffer = doc.createBuffer()
  const accessor = (
    type: 'VEC3' | 'SCALAR',
    array: Float32Array<ArrayBuffer> | Uint8Array<ArrayBuffer>,
    normalized = false,
  ) =>
    doc.createAccessor().setType(type).setArray(array).setNormalized(normalized).setBuffer(buffer)
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', accessor('VEC3', positions))
    .setAttribute('COLOR_0', accessor('VEC3', Uint8Array.from(soup.colours), true))
    .setMaterial(placeholderMaterial(doc))
  // S16b pack attachments ship without normals so weld() shares their corners; the runtime
  // flat-shades them (src/scene/models/prepare.ts), as it does the skinned parts.
  if (model.fromSkinned === undefined)
    prim.setAttribute('NORMAL', accessor('VEC3', Float32Array.from(soup.normals)))
  const emissive = soup.emissive.some((v) => v > 0)
  if (emissive)
    prim.setAttribute('_EMISSIVE', accessor('VEC3', Uint8Array.from(soup.emissive), true))
  if (soup.slots.some((v) => v > 0))
    prim.setAttribute('_SLOT', accessor('SCALAR', Uint8Array.from(soup.slots)))
  const mesh = doc.createMesh(model.id).addPrimitive(prim)
  doc.createScene(model.id).addChild(doc.createNode(model.id).setMesh(mesh))
  return { doc, bounds: fittedBounds(bounds(positions)), emissive, counts }
}

function placeholderMaterial(doc: Document) {
  // Part 2 replaces it with the shared lit/toon material; vertex colours carry all colour.
  return doc
    .createMaterial('model')
    .setBaseColorFactor([1, 1, 1, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(1)
}

/**
 * Name of the joint with the largest weight at each triangle's first corner (after deindexing
 * every corner of a triangle shares its colour, so one joint per triangle is enough).
 */
function dominantJoints(prim: Primitive, skin: Skin | null): (string | undefined)[] {
  const joints = prim.getAttribute('JOINTS_0')
  const weights = prim.getAttribute('WEIGHTS_0')
  const count = (prim.getAttribute('POSITION')?.getCount() ?? 0) / 3
  if (skin === null || joints === null || weights === null) return new Array(count).fill(undefined)
  const names = skin.listJoints().map((joint) => joint.getName())
  const j: number[] = []
  const w: number[] = []
  return Array.from({ length: count }, (_, t) => {
    joints.getElement(t * 3, j)
    weights.getElement(t * 3, w)
    let best = 0
    for (let k = 1; k < w.length; k++) if ((w[k] ?? 0) > (w[best] ?? 0)) best = k
    return names[j[best] ?? -1]
  })
}

/**
 * Simplifies a source primitive for a tier BEFORE its colours are baked: the pack meshes share
 * vertices across faces (their atlas UVs are continuous), so meshoptimizer can collapse edges
 * there; after the bake every face owns its corners and nothing could collapse. Faces that merge
 * take the swatch under their new UV centroid.
 */
function simplifySource(
  doc: Document,
  prim: Primitive,
  ratio: number,
  error: number,
  flags?: readonly 'Permissive'[],
) {
  if (ratio >= 1) return
  // The bake reads only POSITION, NORMAL, the atlas UVs and skin weights: drop the rest and weld,
  // because duplicate vertices look like seams to the simplifier and stall it.
  const texCoord = prim.getMaterial()?.getBaseColorTextureInfo()?.getTexCoord() ?? 0
  for (const semantic of prim.listSemantics()) {
    const uv = /^TEXCOORD_(\d+)$/.exec(semantic)
    if (semantic === 'TANGENT' || (uv !== null && Number(uv[1]) !== texCoord)) {
      prim.setAttribute(semantic, null)
    }
  }
  weldPrimitive(prim)
  const position = prim.getAttribute('POSITION')
  if (position === null) return
  const positions = new Float32Array(position.getCount() * 3)
  const element: number[] = []
  for (let i = 0; i < position.getCount(); i++) {
    position.getElement(i, element)
    positions.set([element[0] ?? 0, element[1] ?? 0, element[2] ?? 0], i * 3)
  }
  const indices = triangleIndices(prim)
  const target = Math.floor((indices.length / 3) * ratio) * 3
  const [simplified] = MeshoptSimplifier.simplify(
    indices,
    positions,
    3,
    target,
    error,
    flags && [...flags],
  )
  prim.setIndices(
    doc
      .createAccessor()
      .setType('SCALAR')
      .setArray(new Uint32Array(simplified))
      .setBuffer(position.getBuffer()),
  )
}

/** Expands an indexed primitive so every triangle owns its three corners (for flat colours). */
function deindex(doc: Document, prim: Primitive): void {
  const indices = triangleIndices(prim)
  for (const semantic of prim.listSemantics()) {
    const src = prim.getAttribute(semantic)
    if (src === null) continue
    const size = src.getElementSize()
    const array = src.getArray()
    if (array === null) continue
    const Ctor = array.constructor as new (length: number) => TypedArray
    const out = new Ctor(indices.length * size)
    for (let i = 0; i < indices.length; i++) {
      const from = (indices[i] ?? 0) * size
      for (let k = 0; k < size; k++) out[i * size + k] = array[from + k] ?? 0
    }
    prim.setAttribute(
      semantic,
      doc
        .createAccessor()
        .setType(src.getType())
        .setArray(out)
        .setNormalized(src.getNormalized())
        .setBuffer(src.getBuffer()),
    )
  }
  prim.setIndices(null)
}

async function buildSkinned(
  model: Model,
  pack: Pack,
  ctx: BuildContext,
  logger: CollectingLogger,
  tier: ModelTier,
) {
  const [entry] = model.entries
  if (entry === undefined) throw new Error(`${model.id}: no entry`)
  const doc = await loadEntry(pack, entry.path, logger)
  const root = doc.getRoot()
  const counts = new Map<string, number>()
  let emissive = false
  let kept: Mesh | undefined
  for (const node of root.listNodes()) {
    const mesh = node.getMesh()
    if (mesh === null) continue
    const keep =
      model.kind === 'skinned' && (mesh.getName() === model.mesh || node.getName() === model.mesh)
    if (!keep) {
      node.setMesh(null).setSkin(null)
      continue
    }
    if (node.getSkin() === null) throw new Error(`${model.id}: ${model.mesh} is not skinned`)
    kept = mesh
  }
  if (model.kind === 'skinned' && kept === undefined) {
    throw new Error(`${model.id}: ${entry.path} has no mesh named ${model.mesh}`)
  }

  if (kept !== undefined) {
    const textures = new TextureCache()
    const material = placeholderMaterial(doc)
    const tierRule = model.tiers[tier]
    if (!('ratio' in tierRule)) throw new Error(`${model.id}: triangle targets need meshes`)
    for (const prim of kept.listPrimitives())
      simplifySource(doc, prim, tierRule.ratio, tierRule.error, tierRule.flags)
    const fitScale = 'scale' in model.fit ? model.fit.scale : 1
    const prims = kept.listPrimitives().map((prim) => {
      const colours = triangleColours(prim, textures, pack.source.factorEncoding)
      // Every triangle owns its corners from here on (flat colours), so centroids and the strip
      // mask line up with the colours triangle by triangle.
      deindex(doc, prim)
      const centres = centroids(prim, fitScale)
      const keep = colours.map((colour, t) => !stripped(model, colour, centres[t] ?? [0, 0, 0]))
      if (keep.some((kept) => !kept)) keepTriangles(doc, prim, keep)
      return { prim, colours: colours.filter((_, t) => keep[t]) }
    })
    const classify = colourClassifier(
      model,
      ctx,
      prims.flatMap((part) => part.colours),
    )
    const skin =
      root
        .listNodes()
        .find((node) => node.getMesh() === kept)
        ?.getSkin() ?? null
    for (const { prim, colours } of prims) {
      const joints = dominantJoints(prim, skin)
      const centres = centroids(prim, fitScale)
      for (const semantic of prim.listSemantics()) {
        if (/^(?:TEXCOORD_\d+|TANGENT|COLOR_\d+)$/.test(semantic)) prim.setAttribute(semantic, null)
      }
      const vertexCount = colours.length * 3
      const rgb = new Uint8Array(vertexCount * 3)
      const glow = new Uint8Array(vertexCount * 3)
      const slot = new Uint8Array(vertexCount)
      for (const [t, source] of colours.entries()) {
        const c = classify(source)
        counts.set(c.label, (counts.get(c.label) ?? 0) + 1)
        for (let k = 0; k < 3; k++) {
          const v = t * 3 + k
          rgb.set([toU8(c.linear[0]), toU8(c.linear[1]), toU8(c.linear[2])], v * 3)
          const g = c.emissive ?? [0, 0, 0]
          glow.set([toU8(g[0]), toU8(g[1]), toU8(g[2])], v * 3)
          slot[v] = slotOf(model, c.token, joints[t], centres[t])
        }
      }
      const buffer = root.listBuffers()[0] ?? doc.createBuffer()
      prim.setAttribute(
        'COLOR_0',
        doc.createAccessor().setType('VEC3').setArray(rgb).setNormalized(true).setBuffer(buffer),
      )
      if (glow.some((v) => v > 0)) {
        emissive = true
        prim.setAttribute(
          '_EMISSIVE',
          doc.createAccessor().setType('VEC3').setArray(glow).setNormalized(true).setBuffer(buffer),
        )
      }
      if (slot.some((v) => v > 0)) {
        prim.setAttribute(
          '_SLOT',
          doc.createAccessor().setType('SCALAR').setArray(slot).setBuffer(buffer),
        )
      }
      prim.setMaterial(material)
    }
  }

  if (model.kind === 'rig' && model.joints !== undefined) {
    const skin = root.listSkins()[0]
    if (skin === undefined) throw new Error(`${model.id}: ${entry.path} has no skin`)
    const map = ctx.jointMaps[model.joints]
    applyJointPlan(
      doc,
      skin,
      planJoints(
        map,
        skin.listJoints().map((joint) => joint.getName()),
      ),
      map,
    )
  }

  const animations = root.listAnimations()
  for (const clip of model.clips) {
    if (!animations.some((animation) => animation.getName() === clipSource(clip))) {
      throw new Error(`${model.id}: ${entry.path} has no clip ${clipSource(clip)}`)
    }
  }
  for (const animation of animations) {
    const rule = model.clips.find((clip) => clipSource(clip) === animation.getName())
    if (rule !== undefined) {
      animation.setName(clipName(rule))
      continue
    }
    // Disposing an animation leaves its samplers holding their keyframe accessors, so prune
    // would keep the bytes; drop the samplers and channels first.
    for (const channel of animation.listChannels()) channel.dispose()
    for (const sampler of animation.listSamplers()) sampler.dispose()
    animation.dispose()
  }

  // One uniform scale at the top of the hierarchy: skinning, bind matrices and clips stay valid,
  // and every head, body and the rig share it, so parts from different characters line up.
  const scene = root.getDefaultScene() ?? root.listScenes()[0]
  if (scene === undefined) throw new Error(`${model.id}: ${entry.path} has no scene`)
  const scale = 'scale' in model.fit ? model.fit.scale : undefined
  if (scale === undefined) throw new Error(`${model.id}: skinned and rig models fit by scale`)
  for (const child of scene.listChildren()) {
    child.setTranslation(child.getTranslation().map((v) => v * scale) as [number, number, number])
    child.setScale(child.getScale().map((v) => v * scale) as [number, number, number])
  }
  let box: Box | undefined
  if (kept !== undefined) {
    const position = kept.listPrimitives()[0]?.getAttribute('POSITION')
    const array = position?.getArray()
    if (array === null || array === undefined) throw new Error(`${model.id}: no positions`)
    box = fittedBounds(bounds(Float32Array.from(array, (v) => v * scale)))
  }
  const skin = root.listSkins()[0]
  const frame: AvatarFrame | undefined =
    model.kind === 'rig' && model.joints !== undefined && skin !== undefined
      ? { joints: jointPositions(skin, scale), materials: {} }
      : undefined
  return { doc, bounds: box, emissive, counts, ...(frame === undefined ? {} : { frame }) }
}

/** Measurements of a modular avatar part or rig for data/avatar/frame.json (S16b). */
export interface AvatarFrame {
  /** Each kept joint's bind-pose position in fitted metres (character frame, glTF axes). */
  readonly joints: Readonly<Record<string, Vec3>>
  /** Each kept source material's bounds in fitted metres (skinned parts only). */
  readonly materials: Readonly<Record<string, { readonly min: Vec3; readonly max: Vec3 }>>
}

/** What a joint map does to one skin's joint list. */
interface JointPlan {
  /** Source joint index → index in the kept list. */
  readonly target: readonly number[]
  /** Kept source joint indices, in source order. */
  readonly kept: readonly number[]
  readonly collapsed: ReadonlySet<number>
}

/** Plans a catalog joint map (or none: every joint kept, in place) over a skin's joints. */
export function planJoints(map: JointMap | undefined, names: readonly string[]): JointPlan {
  if (map === undefined) {
    const all = names.map((_, i) => i)
    return { target: all, kept: all, collapsed: new Set() }
  }
  const into = names.map((name) => {
    for (const rule of map.collapse) {
      const re = new RegExp(rule.match)
      if (re.test(name)) return name.replace(re, rule.into)
    }
    return undefined
  })
  const kept = names.flatMap((_, i) => (into[i] === undefined ? [i] : []))
  const keptNames = kept.map((i) => names[i] ?? '')
  for (const name of keptNames) {
    if (map.rename[name] === undefined) throw new Error(`joint map: no new name for ${name}`)
  }
  const target = names.map((name, i) => {
    const goal = into[i] ?? name
    const at = keptNames.indexOf(goal)
    if (at < 0) throw new Error(`joint map: ${name} folds into ${goal}, which is not kept`)
    return at
  })
  return { target, kept, collapsed: new Set(names.flatMap((_, i) => (into[i] ? [i] : []))) }
}

/**
 * Applies a joint plan to the document: drops the collapsed joints (and every animation channel
 * that moves them) from the skin and the scene, rewrites the inverse bind matrices for the kept
 * joints and renames them.
 */
function applyJointPlan(doc: Document, skin: Skin, plan: JointPlan, map: JointMap | undefined) {
  if (map === undefined) return
  const joints = skin.listJoints()
  const ibm = skin.getInverseBindMatrices()
  const source = ibm?.getArray()
  if (ibm === null || source === null || source === undefined) {
    throw new Error('joint map: the skin has no inverse bind matrices')
  }
  const matrices = new Float32Array(plan.kept.length * 16)
  plan.kept.forEach((index, k) => matrices.set(source.slice(index * 16, index * 16 + 16), k * 16))
  skin.setInverseBindMatrices(
    doc.createAccessor().setType('MAT4').setArray(matrices).setBuffer(ibm.getBuffer()),
  )
  const collapsed = new Set([...plan.collapsed].map((index) => joints[index]))
  for (const animation of doc.getRoot().listAnimations()) {
    for (const channel of animation.listChannels()) {
      const node = channel.getTargetNode()
      if (node === null || !collapsed.has(node)) continue
      channel.getSampler()?.dispose()
      channel.dispose()
    }
  }
  for (const node of collapsed) {
    if (node === undefined) continue
    if (node.listChildren().some((child) => !collapsed.has(child))) {
      throw new Error(`joint map: ${node.getName()} folds away but keeps a child joint`)
    }
    skin.removeJoint(node)
  }
  for (const node of collapsed) node?.dispose()
  for (const index of plan.kept) {
    const node = joints[index]
    if (node !== undefined) node.setName(map.rename[node.getName()] ?? node.getName())
  }
}

/** Each kept joint's bind-pose position (the inverse bind matrix's inverse), scaled. */
function jointPositions(skin: Skin, scale: number): Record<string, Vec3> {
  const ibm = skin.getInverseBindMatrices()?.getArray()
  if (ibm === null || ibm === undefined) return {}
  const out: Record<string, Vec3> = {}
  skin.listJoints().forEach((joint, k) => {
    const m = Array.from(ibm.slice(k * 16, k * 16 + 16))
    const world = invert4(m)
    out[joint.getName()] = [
      round((world[12] ?? 0) * scale),
      round((world[13] ?? 0) * scale),
      round((world[14] ?? 0) * scale),
    ]
  })
  return out
}

/** Inverse of an affine column-major 4×4 matrix. */
function invert4(m: readonly number[]): number[] {
  const { matrix: nm } = normalMatrix(m)
  // normalMatrix gives (M₃⁻¹)ᵀ; its transpose is M₃⁻¹.
  const r = [nm[0], nm[3], nm[6], nm[1], nm[4], nm[7], nm[2], nm[5], nm[8]].map((v) => v ?? 0)
  const t = [m[12] ?? 0, m[13] ?? 0, m[14] ?? 0]
  const ti = [0, 1, 2].map(
    (row) =>
      -(
        (r[row] ?? 0) * (t[0] ?? 0) +
        (r[row + 3] ?? 0) * (t[1] ?? 0) +
        (r[row + 6] ?? 0) * (t[2] ?? 0)
      ),
  )
  return [
    r[0] ?? 0,
    r[1] ?? 0,
    r[2] ?? 0,
    0,
    r[3] ?? 0,
    r[4] ?? 0,
    r[5] ?? 0,
    0,
    r[6] ?? 0,
    r[7] ?? 0,
    r[8] ?? 0,
    0,
    ti[0] ?? 0,
    ti[1] ?? 0,
    ti[2] ?? 0,
    1,
  ]
}

/** The triangle target of a `triangles` tier (throws on a ratio tier). */
function triangleTarget(model: Model, tier: ModelTier): number {
  const rule = model.tiers[tier]
  if (!('triangles' in rule)) throw new Error(`${model.id}: ${tier} needs a triangle target`)
  return rule.triangles
}

const MAX_INFLUENCES = 4

/**
 * A static attachment cut from a skinned pack mesh (S16b `fromSkinned`): the listed materials'
 * triangles in the bind pose, less `exclude`, simplified towards the tier's triangle target.
 * Normals are dropped so the static bake shades every face flat, like the pack's look.
 */
function skinnedPieces(
  model: Model,
  doc: Document,
  path: string,
  tier: ModelTier,
  textures: TextureCache,
  pack: Pack,
  place: Mat4,
): { prim: Primitive; world: Mat4; colours: Rgb[]; origin: TriangleOrigin }[] {
  const rule = model.fromSkinned
  if (rule === undefined) return []
  const node = doc
    .getRoot()
    .listNodes()
    .find(
      (n) =>
        n.getMesh() !== null && (n.getName() === rule.mesh || n.getMesh()?.getName() === rule.mesh),
    )
  const skin = node?.getSkin() ?? null
  if (node === undefined || skin === null) {
    throw new Error(`${model.id}: ${path} has no skinned mesh ${rule.mesh}`)
  }
  const scale = 'scale' in model.fit ? model.fit.scale : 1
  const prims = (node.getMesh()?.listPrimitives() ?? []).filter((prim) =>
    rule.materials.includes(prim.getMaterial()?.getName() ?? ''),
  )
  if (prims.length === 0)
    throw new Error(`${model.id}: ${rule.mesh} has no ${rule.materials.join('/')}`)
  for (const prim of prims) {
    deindex(doc, prim)
    const joints = dominantJoints(prim, skin)
    const off = joints.findIndex((joint) => joint !== rule.joint)
    if (off >= 0) {
      throw new Error(`${model.id}: triangle ${off} follows ${joints[off]}, not ${rule.joint}`)
    }
    if (rule.exclude !== undefined) {
      const centres = centroids(prim, scale)
      const keep = centres.map((c) => !(rule.exclude ?? []).some((box) => inBox(box, c)))
      if (keep.some((k) => !k)) keepTriangles(doc, prim, keep)
    }
    for (const semantic of prim.listSemantics()) {
      if (semantic !== 'POSITION') prim.setAttribute(semantic, null)
    }
  }
  const total = prims.reduce(
    (sum, prim) => sum + (prim.getAttribute('POSITION')?.getCount() ?? 0) / 3,
    0,
  )
  const ratio = Math.min(1, triangleTarget(model, tier) / total)
  return prims.map((prim) => {
    simplifySource(doc, prim, ratio, 1)
    return {
      prim,
      world: place,
      colours: triangleColours(prim, textures, pack.source.factorEncoding),
      origin: { material: prim.getMaterial()?.getName() ?? '', mesh: node.getName() },
    }
  })
}

interface Group {
  readonly material: string
  readonly mesh: string
  readonly colour: Rgb
  readonly protect: boolean
}

/**
 * A modular pack's skinned part (S16b): the listed meshes merged into ONE skinned primitive,
 * joints collapsed and renamed, stripped materials dropped, simplified towards the tier's
 * triangle target (protected materials kept whole), every face flat-shaded with its material's
 * colour baked in, and `_SLOT` set by material and mesh.
 *
 * Vertices are welded per material and mesh only, so material borders stay seams the simplifier
 * moves along but never tears open.
 */
async function buildModular(
  model: Model,
  pack: Pack,
  ctx: BuildContext,
  logger: CollectingLogger,
  tier: ModelTier,
) {
  const [entry] = model.entries
  if (entry === undefined) throw new Error(`${model.id}: no entry`)
  const doc = await loadEntry(pack, entry.path, logger)
  const root = doc.getRoot()
  const meshNodes = root.listNodes().filter((node) => node.getMesh() !== null)
  const kept = (model.meshes ?? []).map((name) => {
    const node = meshNodes.find((n) => n.getName() === name || n.getMesh()?.getName() === name)
    if (node === undefined) throw new Error(`${model.id}: ${entry.path} has no mesh named ${name}`)
    if (node.getSkin() === null) throw new Error(`${model.id}: ${name} is not skinned`)
    return node
  })
  const skin = kept[0]?.getSkin() ?? null
  if (skin === null || kept.some((node) => node.getSkin() !== skin)) {
    throw new Error(`${model.id}: the kept meshes must share one skin`)
  }
  const map = model.joints === undefined ? undefined : ctx.jointMaps[model.joints]
  const jointNames = skin.listJoints().map((joint) => joint.getName())
  const plan = planJoints(map, jointNames)
  const keptNames = plan.kept.map((index) => {
    const name = jointNames[index] ?? ''
    return map?.rename[name] ?? name
  })

  const textures = new TextureCache()
  const groups: Group[] = []
  const vertexAt = new Map<string, number>()
  const positions: number[] = []
  const vJoints: number[] = []
  const vWeights: number[] = []
  const vGroup: number[] = []
  const triangles: number[][] = []
  const p: number[] = []
  const j: number[] = []
  const w: number[] = []
  for (const node of kept) {
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      const material = prim.getMaterial()?.getName() ?? ''
      if (model.stripMaterials?.includes(material)) continue
      if (prim.getMaterial()?.getBaseColorTexture() !== null) {
        throw new Error(`${model.id}: modular parts must be untextured (${material})`)
      }
      const colours = triangleColours(prim, textures, pack.source.factorEncoding)
      const group = groups.length
      groups.push({
        material,
        mesh: node.getName(),
        colour: colours[0] ?? [1, 1, 1],
        protect: model.protectMaterials?.includes(material) ?? false,
      })
      const position = prim.getAttribute('POSITION')
      const joints = prim.getAttribute('JOINTS_0')
      const weights = prim.getAttribute('WEIGHTS_0')
      if (position === null || joints === null || weights === null) {
        throw new Error(`${model.id}: ${node.getName()} lacks positions or skin weights`)
      }
      const local = new Map<number, number>()
      const vertex = (index: number): number => {
        const known = local.get(index)
        if (known !== undefined) return known
        position.getElement(index, p)
        joints.getElement(index, j)
        weights.getElement(index, w)
        const summed = new Map<number, number>()
        for (let k = 0; k < j.length; k++) {
          const weight = w[k] ?? 0
          if (weight <= 0) continue
          const target = plan.target[j[k] ?? 0] ?? 0
          summed.set(target, (summed.get(target) ?? 0) + weight)
        }
        const top = [...summed.entries()]
          .sort((a, b) => b[1] - a[1] || a[0] - b[0])
          .slice(0, MAX_INFLUENCES)
        const total = top.reduce((sum, [, weight]) => sum + weight, 0) || 1
        const jj = [0, 0, 0, 0]
        const ww = [0, 0, 0, 0]
        top.forEach(([joint, weight], k) => {
          jj[k] = joint
          ww[k] = weight / total
        })
        const key = `${group}|${p[0]},${p[1]},${p[2]}|${jj.join(',')}|${ww.map((v) => v.toFixed(5)).join(',')}`
        let at = vertexAt.get(key)
        if (at === undefined) {
          at = vGroup.length
          vertexAt.set(key, at)
          positions.push(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0)
          vJoints.push(...jj)
          vWeights.push(...ww)
          vGroup.push(group)
        }
        local.set(index, at)
        return at
      }
      const indices = triangleIndices(prim)
      for (let t = 0; t < indices.length; t += 3) {
        triangles.push([
          vertex(indices[t] ?? 0),
          vertex(indices[t + 1] ?? 0),
          vertex(indices[t + 2] ?? 0),
        ])
      }
    }
  }

  const isProtected = (tri: readonly number[]) => groups[vGroup[tri[0] ?? 0] ?? 0]?.protect === true
  const fixed = triangles.filter(isProtected)
  let free = triangles.filter((tri) => !isProtected(tri))
  const budget = triangleTarget(model, tier) - fixed.length
  if (budget < 0)
    throw new Error(`${model.id}: protected materials alone exceed the ${tier} target`)
  if (free.length > budget) {
    const [simplified] = MeshoptSimplifier.simplify(
      Uint32Array.from(free.flat()),
      Float32Array.from(positions),
      3,
      budget * 3,
      1,
    )
    free = []
    for (let i = 0; i < simplified.length; i += 3) {
      free.push([simplified[i] ?? 0, simplified[i + 1] ?? 0, simplified[i + 2] ?? 0])
    }
  }
  const output = [...fixed, ...free]
  if (output.length === 0) throw new Error(`${model.id}: no triangles`)

  const scale = 'scale' in model.fit ? model.fit.scale : undefined
  if (scale === undefined) throw new Error(`${model.id}: skinned and rig models fit by scale`)
  const classify = colourClassifier(
    model,
    ctx,
    output.map((tri) => groups[vGroup[tri[0] ?? 0] ?? 0]?.colour ?? [1, 1, 1]),
  )
  const counts = new Map<string, number>()
  // Indexed and without normals: the runtime unwelds and flat-shades it (prepare.ts), so the
  // file stores each shared corner once instead of once per face.
  const used = [...new Set(output.flat())]
  const remap = new Map(used.map((vertex, k) => [vertex, k]))
  const n = used.length
  const outPos = new Float32Array(n * 3)
  const outJoints = new Uint8Array(n * 4)
  const outWeights = new Float32Array(n * 4)
  const outColour = new Uint8Array(n * 3)
  const outSlot = new Uint8Array(n)
  const boxes = new Map<string, Box>()
  if (keptNames.length > 255) throw new Error(`${model.id}: too many joints for u8 JOINTS_0`)
  for (const tri of output) {
    const c = classify(groups[vGroup[tri[0] ?? 0] ?? 0]?.colour ?? [1, 1, 1])
    counts.set(c.label, (counts.get(c.label) ?? 0) + 1)
  }
  used.forEach((src, at) => {
    const group = groups[vGroup[src] ?? 0]
    if (group === undefined) throw new Error(`${model.id}: lost a vertex's material`)
    const c = classify(group.colour)
    const point: Vec3 = [
      positions[src * 3] ?? 0,
      positions[src * 3 + 1] ?? 0,
      positions[src * 3 + 2] ?? 0,
    ]
    const fitted = point.map((value) => value * scale)
    outPos.set(point, at * 3)
    outJoints.set(vJoints.slice(src * 4, src * 4 + 4), at * 4)
    outWeights.set(vWeights.slice(src * 4, src * 4 + 4), at * 4)
    outColour.set([toU8(c.linear[0]), toU8(c.linear[1]), toU8(c.linear[2])], at * 3)
    outSlot[at] = slotOf(model, c.token, keptNames[vJoints[src * 4] ?? 0], fitted, {
      material: group.material,
      mesh: group.mesh,
    })
    const box = boxes.get(group.material) ?? {
      min: [Infinity, Infinity, Infinity] as Vec3,
      max: [-Infinity, -Infinity, -Infinity] as Vec3,
    }
    for (let axis = 0; axis < 3; axis++) {
      box.min[axis] = Math.min(box.min[axis] ?? 0, fitted[axis] ?? 0)
      box.max[axis] = Math.max(box.max[axis] ?? 0, fitted[axis] ?? 0)
    }
    boxes.set(group.material, box)
  })
  const outIndex = Uint32Array.from(output.flat(), (vertex) => remap.get(vertex) ?? 0)

  const buffer = root.listBuffers()[0] ?? doc.createBuffer()
  const accessor = (
    type: 'VEC3' | 'VEC4' | 'SCALAR',
    array: Float32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint32Array<ArrayBuffer>,
    normalized = false,
  ) =>
    doc.createAccessor().setType(type).setArray(array).setNormalized(normalized).setBuffer(buffer)
  const prim = doc
    .createPrimitive()
    .setIndices(accessor('SCALAR', outIndex))
    .setAttribute('POSITION', accessor('VEC3', outPos))
    .setAttribute('JOINTS_0', accessor('VEC4', outJoints))
    .setAttribute('WEIGHTS_0', accessor('VEC4', outWeights))
    .setAttribute('COLOR_0', accessor('VEC3', outColour, true))
    .setMaterial(placeholderMaterial(doc))
  if (outSlot.some((value) => value > 0)) prim.setAttribute('_SLOT', accessor('SCALAR', outSlot))
  const [first] = kept
  for (const node of meshNodes) {
    if (node !== first) node.setMesh(null).setSkin(null)
  }
  first?.setName(model.id).setMesh(doc.createMesh(model.id).addPrimitive(prim))
  applyJointPlan(doc, skin, plan, map)
  for (const animation of root.listAnimations()) {
    for (const channel of animation.listChannels()) channel.dispose()
    for (const sampler of animation.listSamplers()) sampler.dispose()
    animation.dispose()
  }
  scaleScene(model, doc, entry.path, scale)
  const frame: AvatarFrame = {
    joints: jointPositions(skin, scale),
    materials: Object.fromEntries(
      [...boxes.entries()]
        .sort(([x], [y]) => (x < y ? -1 : 1))
        .map(([name, box]) => [name, fittedBounds(box)]),
    ),
  }
  return {
    doc,
    bounds: fittedBounds(bounds(Float32Array.from(outPos, (value) => value * scale))),
    emissive: false,
    counts,
    frame,
  }
}

/**
 * One uniform scale at the top of the hierarchy: skinning, bind matrices and clips stay valid,
 * and every head, body and the rig share it, so parts from different characters line up.
 */
function scaleScene(model: Model, doc: Document, path: string, scale: number) {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
  if (scene === undefined) throw new Error(`${model.id}: ${path} has no scene`)
  for (const child of scene.listChildren()) {
    child.setTranslation(child.getTranslation().map((v) => v * scale) as [number, number, number])
    child.setScale(child.getScale().map((v) => v * scale) as [number, number, number])
  }
}

/**
 * dedup → prune → weld → quantize → reorder → meshopt (vertex codec v0): the runtime format.
 * Exported for the Blender landmark levels (scripts/blender/ship.ts), which ship the same way.
 */
export async function finishTier(
  doc: Document,
  model: Pick<Model, 'id' | 'kind'>,
  /** S16b avatar parts and rigs: coarser quantization and meshopt filters (see below). */
  compact = false,
): Promise<BuiltTier> {
  const keepLeaves = model.kind !== 'static'
  await doc.transform(
    dedup(),
    prune({ keepLeaves }),
    ...(model.kind === 'rig' ? [resample()] : [weld()]),
    quantize({
      // S16b skinned parts keep float positions: quantizing would fold a per-file dequantize
      // transform into the inverse bind matrices, and the runtime merges body, head and
      // attachments into one skinned mesh that must share the true bind pose.
      pattern: compact && model.kind === 'skinned' ? SKINNED_QUANTIZE_PATTERN : QUANTIZE_PATTERN,
      // S16b static attachments: 12-bit positions (under 0.5 mm on a 1.9 m figure).
      ...(compact && { quantizePosition: 12, quantizeNormal: 8 }),
    }),
    // Rigs have no primitives to reorder.
    ...(model.kind === 'rig' ? [] : [reorder({ encoder: MeshoptEncoder, target: 'size' })]),
    prune({ keepLeaves }),
  )
  for (const extension of doc.getRoot().listExtensionsUsed()) {
    if (!KEPT_EXTENSIONS.has(extension.extensionName)) extension.dispose()
  }
  if (doc.getRoot().listTextures().length > 0) throw new Error(`${model.id}: textures survived`)
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({
      // FILTER adds meshopt's octahedral, quaternion and exponential filters (all read by the
      // 0.22 decoder); it halves a rig's clips. Older models keep QUANTIZE, byte for byte.
      method: compact
        ? EXTMeshoptCompression.EncoderMethod.FILTER
        : EXTMeshoptCompression.EncoderMethod.QUANTIZE,
    })
  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ 'meshopt.encoder': encoderV0 })
    .setLogger(doc.getLogger())
  const bytes = await io.writeBinary(doc)
  let triangles = 0
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) triangles += (prim.getIndices()?.getCount() ?? 0) / 3
  }
  return { bytes, triangles }
}

export async function buildModel(model: Model, pack: Pack, ctx: BuildContext): Promise<BuiltModel> {
  await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready])
  const logger = new CollectingLogger()
  const tiers = {} as Record<ModelTier, BuiltTier>
  let built:
    | {
        doc: Document
        bounds: Box | undefined
        emissive: boolean
        counts: Map<string, number>
        frame?: AvatarFrame
      }
    | undefined
  // Each tier starts from a fresh build so simplification never compounds across tiers.
  for (const tier of MODEL_TIERS) {
    built =
      model.kind === 'static'
        ? await buildStatic(model, pack, ctx, logger, tier)
        : model.meshes !== undefined
          ? await buildModular(model, pack, ctx, logger, tier)
          : await buildSkinned(model, pack, ctx, logger, tier)
    tiers[tier] = await finishTier(
      built.doc,
      model,
      model.joints !== undefined || model.fromSkinned !== undefined,
    )
  }
  if (built === undefined) throw new Error(`${model.id}: no tiers`)
  return {
    model,
    tiers,
    bounds: built.bounds,
    emissive: built.emissive,
    colours: built.counts,
    warnings: [...new Set(logger.warnings)],
    ...(built.frame === undefined ? {} : { frame: built.frame }),
  }
}
