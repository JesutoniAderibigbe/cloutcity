/**
 * Ambient pedestrian kits (S04l part B, DEC-52 decisions 8–9), behind the `PedestrianKitSource`
 * seam (`pedestrians.source` in data/config/ambient.json). The `s16b` source bakes each tier's
 * merged pedestrian models (`npc-*`: body, face and hair in one skinned mesh, S16b), posed rigid
 * in mid-stride by their frame's rig `walk` clip, into the `skin`, `top`, `bottom` and `accent`
 * colour buckets. No skinning at runtime: at the closest zoom a pedestrian is a few pixels tall,
 * so limb motion cannot be seen; the runtime adds a gentle sway instead.
 *
 * The townsfolk (S04o, S04q) are drawn far larger, so they get real motion: each pose's rig clip
 * is baked into a loop of rigid frames (`bakeTownsfolkKits`), which the runtime steps through
 * (src/scene/ambient/townsfolk.ts). Still no skinning or morphing on the GPU: the frames reuse
 * the living city's material and program, one rewrite of a kit's positions per frame step.
 *
 * Kits are not players (UX-3): the runtime draws them small, with no ring, chip or handle, and
 * never picks or counts them. The models used here avoid the default player look.
 */
import {
  AnimationMixer,
  BufferAttribute,
  BufferGeometry,
  SkinnedMesh,
  Vector3,
  type Object3D,
} from 'three'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import {
  PEDESTRIAN_BUCKETS,
  type AmbientTier,
  type TownsfolkConfig,
  type TownsfolkPose,
  type PedestrianBucket,
  type PedestrianKit,
  type PedestrianKitSource,
} from '@/lib/world/ambient/types'
import type { RigModel, SkinnedPartModel } from '../models/prepare'
import { groundParts, partsBounds, splitIntoBuckets } from './buckets'
import { PEDESTRIANS, TOWNSFOLK_VARIANTS, WALK_CLIP, pedestrianModelIds } from './kitIds'
import type { AmbientLoadedModel, AmbientModelLoader } from './vehicleKits'

export type ScenePedestrianKit = PedestrianKit<BufferGeometry>
export type ScenePedestrianKitSource = PedestrianKitSource<BufferGeometry, AmbientModelLoader>

export { PEDESTRIANS, WALK_CLIP, pedestrianModelIds } from './kitIds'

/** Walk-cycle phases tried when looking for the widest stride. */
const STRIDE_SAMPLES = 16
/** Vertices below this share of the bind-pose height count as feet for the stride. */
const FEET_SHARE = 0.2

/** `_slot` names → bucket; anything else (shoes, hair, fixed colours) is `accent`. */
export function pedestrianBucket(slotName: string | undefined): PedestrianBucket {
  return slotName === 'skin' || slotName === 'top' || slotName === 'bottom' ? slotName : 'accent'
}

function skinnedMeshesOf(root: Object3D): SkinnedMesh[] {
  const meshes: SkinnedMesh[] = []
  root.traverse((object) => {
    if (object instanceof SkinnedMesh) meshes.push(object)
  })
  return meshes
}

/** A posable copy of one part: its own bones, so the cached scene is never moved. */
interface PosedPart {
  readonly root: Object3D
  readonly mixer: AnimationMixer
  readonly meshes: readonly SkinnedMesh[]
  readonly slots: readonly string[]
}

function posable(
  part: SkinnedPartModel,
  slots: readonly string[],
  rig: RigModel,
  clipName: string,
): PosedPart {
  const root = cloneSkinned(part.scene)
  const meshes = skinnedMeshesOf(root)
  if (meshes.length === 0) throw new Error('pedestrian part has no skinned mesh')
  const clip = rig.clips.find((candidate) => candidate.name === clipName)
  if (clip === undefined) throw new Error(`rig has no clip "${clipName}"`)
  const mixer = new AnimationMixer(root)
  mixer.clipAction(clip).play()
  return { root, mixer, meshes, slots }
}

function poseAt(part: PosedPart, seconds: number): void {
  part.mixer.setTime(seconds)
  part.root.updateMatrixWorld(true)
}

/** Every vertex of the part's meshes in the posed root's space, in attribute order. */
function bakedPositions(part: PosedPart): Float32Array[] {
  const v = new Vector3()
  return part.meshes.map((mesh) => {
    const position = mesh.geometry.getAttribute('position')
    const out = new Float32Array(position.count * 3)
    for (let i = 0; i < position.count; i++) {
      // r182 Mesh.getVertexPosition applies the bone transform for skinned meshes.
      mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld)
      out.set([v.x, v.y, v.z], i * 3)
    }
    return out
  })
}

/** Front-to-back spread of the feet: largest in mid-stride. */
function strideOf(positions: readonly Float32Array[], feetBelowY: number): number {
  let min = Infinity
  let max = -Infinity
  for (const array of positions) {
    for (let i = 0; i < array.length; i += 3) {
      if ((array[i + 1] ?? Infinity) > feetBelowY) continue
      const z = array[i + 2] ?? 0
      if (z < min) min = z
      if (z > max) max = z
    }
  }
  return max > min ? max - min : 0
}

/** The walk-clip time with the widest stride (first one on ties: deterministic). */
function midStrideTime(body: PosedPart, duration: number): number {
  poseAt(body, 0)
  const rest = bakedPositions(body)
  let top = 0
  for (const array of rest) {
    for (let i = 1; i < array.length; i += 3) top = Math.max(top, array[i] ?? 0)
  }
  const feetBelowY = top * FEET_SHARE
  let best = 0
  let bestStride = -1
  for (let s = 0; s < STRIDE_SAMPLES; s++) {
    const t = (duration * s) / STRIDE_SAMPLES
    poseAt(body, t)
    const stride = strideOf(bakedPositions(body), feetBelowY)
    if (stride > bestStride + 1e-6) {
      best = t
      bestStride = stride
    }
  }
  return best
}

/**
 * One non-indexed geometry for all of a posed part's meshes, `_slot` rewritten to the bucket
 * index + 1 so the head's and body's slot orders (different per part) agree.
 */
function bucketTagged(part: PosedPart): BufferGeometry {
  const baked = bakedPositions(part)
  const positions: number[] = []
  const colors: number[] = []
  const tags: number[] = []
  part.meshes.forEach((mesh, m) => {
    const geometry = mesh.geometry
    const source = baked[m] ?? new Float32Array()
    const color = geometry.getAttribute('color')
    const slot = geometry.getAttribute('_slot')
    const index = geometry.getIndex()
    const count = index ? index.count : geometry.getAttribute('position').count
    for (let c = 0; c < count; c++) {
      const i = index ? index.getX(c) : c
      positions.push(source[i * 3] ?? 0, source[i * 3 + 1] ?? 0, source[i * 3 + 2] ?? 0)
      colors.push(color ? color.getX(i) : 1, color ? color.getY(i) : 1, color ? color.getZ(i) : 1)
      const slotValue = slot ? slot.getX(i) : 0
      const bucket = pedestrianBucket(slotValue > 0 ? part.slots[slotValue - 1] : undefined)
      tags.push(PEDESTRIAN_BUCKETS.indexOf(bucket) + 1)
    }
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3))
  geometry.setAttribute('color', new BufferAttribute(Float32Array.from(colors), 3))
  geometry.setAttribute('_slot', new BufferAttribute(Uint8Array.from(tags), 1))
  return geometry
}

function concat(geometries: readonly BufferGeometry[]): BufferGeometry {
  const names = ['position', 'color', '_slot'] as const
  const out = new BufferGeometry()
  for (const name of names) {
    const first = geometries[0]?.getAttribute(name)
    if (first === undefined) throw new Error(`missing ${name}`)
    const total = geometries.reduce((sum, g) => sum + g.getAttribute(name).array.length, 0)
    const array = name === '_slot' ? new Uint8Array(total) : new Float32Array(total)
    let offset = 0
    for (const geometry of geometries) {
      const source = geometry.getAttribute(name).array
      array.set(source, offset)
      offset += source.length
    }
    out.setAttribute(name, new BufferAttribute(array, first.itemSize))
  }
  return out
}

function asSkinned(loaded: AmbientLoadedModel | undefined, id: string): SkinnedPartModel {
  if (loaded?.model.kind !== 'skinned') throw new Error(`Pedestrian part "${id}" is not skinned`)
  return loaded.model
}

/**
 * Bakes one pedestrian kit: its parts posed at the walk clip's widest stride (the first part
 * sets it), skinned per vertex on the CPU, flat normals recomputed, split into the four buckets,
 * feet on y = 0.
 */
export function bakePedestrian(
  id: string,
  rig: RigModel,
  parts: readonly { readonly model: SkinnedPartModel; readonly slots: readonly string[] }[],
): ScenePedestrianKit {
  const clipName = WALK_CLIP
  const posed = parts.map((part) => posable(part.model, part.slots, rig, clipName))
  try {
    const [first] = posed
    if (first === undefined) throw new Error('a pedestrian needs a part')
    const clip = rig.clips.find((candidate) => candidate.name === clipName)
    const duration = clip?.duration ?? 0
    const time = midStrideTime(first, duration)
    for (const part of posed) poseAt(part, time)
    const tagged = posed.map(bucketTagged)
    const combined = concat(tagged)
    for (const geometry of tagged) geometry.dispose()
    const buckets = splitIntoBuckets(
      combined,
      ({ slot }) => PEDESTRIAN_BUCKETS[slot - 1] ?? 'accent',
      { order: PEDESTRIAN_BUCKETS, flatNormals: true },
    )
    combined.dispose()
    groundParts(buckets)
    const { min, max } = partsBounds(buckets)
    return {
      id,
      parts: buckets.map(({ bucket, geometry, color }) => ({ bucket, geometry, color })),
      heightM: max.y - min.y,
      triangles: buckets.reduce((sum, part) => sum + part.triangles, 0),
      dispose() {
        for (const part of buckets) part.geometry.dispose()
      },
    }
  } finally {
    for (const part of posed) {
      part.mixer.stopAllAction()
      part.mixer.uncacheRoot(part.root)
      // The clones share the cached geometry; only their skeletons are their own.
      for (const mesh of part.meshes) mesh.skeleton.dispose()
    }
  }
}

/** `pedestrians.source: 's16b'`: each tier's `npc-*` models on their frame's rig. */
export const s16bPedestrians: ScenePedestrianKitSource = async (tier, loadModels) => {
  const loaded = await loadModels(pedestrianModelIds(tier))
  const byId = new Map(loaded.map((entry) => [entry.ref.id, entry]))
  const kits: ScenePedestrianKit[] = []
  try {
    for (const variant of PEDESTRIANS[tier]) {
      const rig = byId.get(variant.rig)?.model
      if (rig?.kind !== 'rig') throw new Error(`"${variant.rig}" is not a rig`)
      const entry = byId.get(variant.model)
      kits.push(
        bakePedestrian(variant.model, rig, [
          { model: asSkinned(entry, variant.model), slots: entry?.ref.slots ?? [] },
        ]),
      )
    }
  } catch (error) {
    for (const kit of kits) kit.dispose()
    throw error
  }
  return kits
}

/**
 * A townsfolk kit (S04q): one body in one pose, as a loop of baked frames. The venue locals bake
 * other clips the same way (the dance moves, S16c), hence the clip-name parameter.
 */
export interface AnimatedKit<P extends string = TownsfolkPose> extends ScenePedestrianKit {
  readonly pose: P
  /** One loop of the clip, seconds. */
  readonly durationS: number
  /** frames[f][p]: part p's positions at frame f (frame 0 is what `parts` hold at first). */
  readonly frames: readonly (readonly Float32Array[])[]
  /** Ground covered by one loop of a walk, in the kit's heights (0 for a standing pose). */
  readonly cycleHeights: number
}

/** Lets the page breathe between baked frames: the bake never blocks a frame for long. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * Bakes `frameCount` evenly spaced frames of one clip, skinned per vertex on the CPU, each split
 * into the four buckets with flat normals, all grounded and centred by one shared offset (a
 * per-frame offset would make the walk hop). Every frame has the same triangles in the same
 * order, so the runtime swaps positions in place.
 */
export async function bakeAnimatedKit<P extends string>(
  id: string,
  rig: RigModel,
  parts: readonly { readonly model: SkinnedPartModel; readonly slots: readonly string[] }[],
  pose: P,
  frameCount: number,
): Promise<AnimatedKit<P>> {
  const clip = rig.clips.find((candidate) => candidate.name === pose)
  if (clip === undefined) throw new Error(`rig has no clip "${pose}"`)
  const posed = parts.map((part) => posable(part.model, part.slots, rig, pose))
  const geometries: BufferGeometry[] = []
  const frames: Float32Array[][] = []
  let buckets: ReturnType<typeof splitIntoBuckets<(typeof PEDESTRIAN_BUCKETS)[number]>> = []
  try {
    for (let f = 0; f < frameCount; f++) {
      for (const part of posed) poseAt(part, (clip.duration * f) / frameCount)
      const tagged = posed.map(bucketTagged)
      const combined = concat(tagged)
      for (const geometry of tagged) geometry.dispose()
      const split = splitIntoBuckets(
        combined,
        ({ slot }) => PEDESTRIAN_BUCKETS[slot - 1] ?? 'accent',
        { order: PEDESTRIAN_BUCKETS, flatNormals: true },
      )
      combined.dispose()
      if (f === 0) {
        buckets = split
        for (const part of split) geometries.push(part.geometry)
      } else if (split.length !== buckets.length) {
        for (const part of split) part.geometry.dispose()
        throw new Error(`frame ${f} of "${id}" changed its buckets`)
      }
      frames.push(
        split.map((part) => {
          const array = part.geometry.getAttribute('position').array
          return array instanceof Float32Array ? array : Float32Array.from(array)
        }),
      )
      if (f > 0) for (const part of split) part.geometry.dispose()
      await breathe()
    }
  } finally {
    for (const part of posed) {
      part.mixer.stopAllAction()
      part.mixer.uncacheRoot(part.root)
      for (const mesh of part.meshes) mesh.skeleton.dispose()
    }
  }
  // One offset for every frame: centred on frame 0, the lowest point of the whole loop on y = 0.
  const { min, max } = partsBounds(buckets)
  let lowest = Infinity
  for (const frame of frames) {
    for (const array of frame) {
      for (let i = 1; i < array.length; i += 3) lowest = Math.min(lowest, array[i] ?? Infinity)
    }
  }
  const dx = -(min.x + max.x) / 2
  const dy = Number.isFinite(lowest) ? -lowest : -min.y
  const dz = -(min.z + max.z) / 2
  for (const frame of frames) {
    for (const array of frame) {
      for (let i = 0; i < array.length; i += 3) {
        array[i] = (array[i] ?? 0) + dx
        array[i + 1] = (array[i + 1] ?? 0) + dy
        array[i + 2] = (array[i + 2] ?? 0) + dz
      }
    }
  }
  // Frame 0's arrays are the live geometry's own: copy so the frames stay pristine.
  frames[0] = (frames[0] ?? []).map((array) => array.slice())
  geometries.forEach((geometry, p) => {
    const source = frames[0]?.[p]
    if (source !== undefined) geometry.getAttribute('position').array.set(source)
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
  })
  const heightM = max.y - min.y
  let cycleHeights = 0
  if (pose === WALK_CLIP && heightM > 0) {
    // The feet's front-to-back spread at its widest is one step; a loop is two.
    let stride = 0
    for (const frame of frames) stride = Math.max(stride, strideOf(frame, heightM * FEET_SHARE))
    cycleHeights = (2 * stride) / heightM
  }
  return {
    id,
    pose,
    parts: buckets.map(({ bucket, geometry, color }) => ({ bucket, geometry, color })),
    heightM,
    triangles: buckets.reduce((sum, part) => sum + part.triangles, 0),
    durationS: clip.duration,
    frames,
    cycleHeights,
    dispose() {
      for (const geometry of geometries) geometry.dispose()
    },
  }
}

/**
 * The townsfolk kits of a tier (S04o, S04q): every body (TOWNSFOLK_VARIANTS) in every pose of
 * ambient.json `townsfolk.poses[tier]`, body-major (kit = body × poses + pose), each baked as a
 * loop of `frames.walk` (walking) or `frames.stand` (idle, talk, wave) frames of its clip.
 */
export async function bakeTownsfolkKits(
  tier: AmbientTier,
  config: Pick<TownsfolkConfig, 'poses' | 'frames'>,
  loadModels: AmbientModelLoader,
): Promise<AnimatedKit[]> {
  const ids = [...new Set(TOWNSFOLK_VARIANTS.flatMap((variant) => [variant.rig, variant.model]))]
  const byId = new Map((await loadModels(ids)).map((entry) => [entry.ref.id, entry]))
  const kits: AnimatedKit[] = []
  try {
    for (const variant of TOWNSFOLK_VARIANTS) {
      const rig = byId.get(variant.rig)?.model
      if (rig?.kind !== 'rig') throw new Error(`"${variant.rig}" is not a rig`)
      const entry = byId.get(variant.model)
      const parts = [{ model: asSkinned(entry, variant.model), slots: entry?.ref.slots ?? [] }]
      for (const pose of config.poses[tier]) {
        const count = pose === 'walk' ? config.frames.walk[tier] : config.frames.stand[tier]
        kits.push(await bakeAnimatedKit(`${variant.model}-${pose}`, rig, parts, pose, count))
      }
    }
  } catch (error) {
    for (const kit of kits) kit.dispose()
    throw error
  }
  return kits
}

/** Every pedestrian source by `pedestrians.source`. */
export const PEDESTRIAN_KIT_SOURCES: Readonly<Record<'s16b', ScenePedestrianKitSource>> = {
  s16b: s16bPedestrians,
}
