/**
 * Ambient pedestrian kits (S04l part B, DEC-52 decisions 8–9), behind the `PedestrianKitSource`
 * seam (`pedestrians.source` in data/config/ambient.json). The `s16b` source bakes each tier's
 * merged pedestrian models (`npc-*`: body, face and hair in one skinned mesh, S16b), posed rigid
 * in mid-stride by their frame's rig `walk` clip, into the `skin`, `top`, `bottom` and `accent`
 * colour buckets. No skinning at runtime: at the closest zoom a pedestrian is a few pixels tall,
 * so limb motion cannot be seen; the runtime adds a bob and sway instead.
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

function pose(part: PosedPart, seconds: number): void {
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
  pose(body, 0)
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
    pose(body, t)
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
  /** Another clip, posed at this share of it (S04o townsfolk); the walk's widest stride else. */
  at?: { readonly clip: string; readonly share: number },
): ScenePedestrianKit {
  const clipName = at?.clip ?? WALK_CLIP
  const posed = parts.map((part) => posable(part.model, part.slots, rig, clipName))
  try {
    const [first] = posed
    if (first === undefined) throw new Error('a pedestrian needs a part')
    const clip = rig.clips.find((candidate) => candidate.name === clipName)
    const duration = clip?.duration ?? 0
    const time = at === undefined ? midStrideTime(first, duration) : duration * at.share
    for (const part of posed) pose(part, time)
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
 * The townsfolk kits of a tier (S04o): every body (TOWNSFOLK_VARIANTS) in every pose of
 * ambient.json `townsfolk.poses[tier]`, body-major (kit = body × poses + pose). The walk is posed
 * at its widest stride like the pedestrians; the standing poses at `poseTime` of their clip.
 */
export async function bakeTownsfolkKits(
  tier: AmbientTier,
  config: Pick<TownsfolkConfig, 'poses' | 'poseTime'>,
  loadModels: AmbientModelLoader,
): Promise<ScenePedestrianKit[]> {
  const ids = [...new Set(TOWNSFOLK_VARIANTS.flatMap((variant) => [variant.rig, variant.model]))]
  const byId = new Map((await loadModels(ids)).map((entry) => [entry.ref.id, entry]))
  const kits: ScenePedestrianKit[] = []
  try {
    for (const variant of TOWNSFOLK_VARIANTS) {
      const rig = byId.get(variant.rig)?.model
      if (rig?.kind !== 'rig') throw new Error(`"${variant.rig}" is not a rig`)
      const entry = byId.get(variant.model)
      const parts = [{ model: asSkinned(entry, variant.model), slots: entry?.ref.slots ?? [] }]
      for (const pose of config.poses[tier]) {
        const at = pose === 'walk' ? undefined : { clip: pose, share: config.poseTime[pose] }
        kits.push(bakePedestrian(`${variant.model}-${pose}`, rig, parts, at))
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
