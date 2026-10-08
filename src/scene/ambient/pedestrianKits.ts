/**
 * Ambient pedestrian kits (S04l part B, DEC-52 decisions 8–9). Behind the S16b seam
 * (`PedestrianKitSource`, chosen by `pedestrians.source` in data/config/ambient.json):
 *
 * - `kenney-temp` (this file, temporary): bakes the existing Kenney Mini Characters body and
 *   head GLBs, posed rigid in mid-stride by the shared avatar rig's `walk` clip, into the
 *   `skin`, `top`, `bottom` and `accent` colour buckets. No new files, no skinning at runtime:
 *   at the closest zoom a pedestrian is a few pixels tall, so limb motion cannot be seen; the
 *   runtime adds a bob and sway instead.
 * - `s16b`: S16b's own ambient LOD replaces it by changing that one config value.
 *
 * Kits are not players (UX-3): the runtime draws them small, with no ring, chip or handle, and
 * never picks or counts them. The parts used here avoid the default player look.
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
  type PedestrianBucket,
  type PedestrianKit,
  type PedestrianKitSource,
} from '@/lib/world/ambient/types'
import type { RigModel, SkinnedPartModel } from '../models/prepare'
import { groundParts, partsBounds, splitIntoBuckets } from './buckets'
import { AVATAR_RIG_ID, KENNEY_TEMP_PEDESTRIANS, WALK_CLIP, kenneyTempModelIds } from './kitIds'
import type { AmbientLoadedModel, AmbientModelLoader } from './vehicleKits'

export type ScenePedestrianKit = PedestrianKit<BufferGeometry>
export type ScenePedestrianKitSource = PedestrianKitSource<BufferGeometry, AmbientModelLoader>

export {
  AVATAR_RIG_ID,
  KENNEY_TEMP_PEDESTRIANS,
  WALK_CLIP,
  kenneyTempModelIds,
  type KenneyPedestrianParts,
} from './kitIds'

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

function posable(part: SkinnedPartModel, slots: readonly string[], rig: RigModel): PosedPart {
  const root = cloneSkinned(part.scene)
  const meshes = skinnedMeshesOf(root)
  if (meshes.length === 0) throw new Error('pedestrian part has no skinned mesh')
  const clip = rig.clips.find((candidate) => candidate.name === WALK_CLIP)
  if (clip === undefined) throw new Error(`rig has no clip "${WALK_CLIP}"`)
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
 * Bakes one pedestrian kit: body and head posed at the walk clip's widest stride, skinned per
 * vertex on the CPU, flat normals recomputed, split into the four buckets, feet on y = 0.
 */
export function bakeKenneyPedestrian(
  id: string,
  rig: RigModel,
  body: { readonly model: SkinnedPartModel; readonly slots: readonly string[] },
  head: { readonly model: SkinnedPartModel; readonly slots: readonly string[] },
): ScenePedestrianKit {
  const posedBody = posable(body.model, body.slots, rig)
  const posedHead = posable(head.model, head.slots, rig)
  try {
    const clip = rig.clips.find((candidate) => candidate.name === WALK_CLIP)
    const time = midStrideTime(posedBody, clip?.duration ?? 0)
    pose(posedBody, time)
    pose(posedHead, time)
    const tagged = [bucketTagged(posedBody), bucketTagged(posedHead)]
    const combined = concat(tagged)
    for (const geometry of tagged) geometry.dispose()
    const parts = splitIntoBuckets(
      combined,
      ({ slot }) => PEDESTRIAN_BUCKETS[slot - 1] ?? 'accent',
      { order: PEDESTRIAN_BUCKETS, flatNormals: true },
    )
    combined.dispose()
    groundParts(parts)
    const { min, max } = partsBounds(parts)
    return {
      id,
      parts: parts.map(({ bucket, geometry, color }) => ({ bucket, geometry, color })),
      heightM: max.y - min.y,
      triangles: parts.reduce((sum, part) => sum + part.triangles, 0),
      dispose() {
        for (const part of parts) part.geometry.dispose()
      },
    }
  } finally {
    for (const posed of [posedBody, posedHead]) {
      posed.mixer.stopAllAction()
      posed.mixer.uncacheRoot(posed.root)
      // The clones share the cached geometry; only their skeletons are their own.
      for (const mesh of posed.meshes) mesh.skeleton.dispose()
    }
  }
}

/** `pedestrians.source: 'kenney-temp'`. */
export const kenneyTempPedestrians: ScenePedestrianKitSource = async (tier, loadModels) => {
  const ids = kenneyTempModelIds(tier)
  const loaded = await loadModels(ids)
  const [rigEntry, ...partEntries] = loaded
  if (rigEntry?.model.kind !== 'rig') throw new Error(`"${AVATAR_RIG_ID}" is not a rig`)
  const rig = rigEntry.model
  const kits: ScenePedestrianKit[] = []
  try {
    KENNEY_TEMP_PEDESTRIANS[tier].forEach((parts, i) => {
      const bodyEntry = partEntries[i * 2]
      const headEntry = partEntries[i * 2 + 1]
      kits.push(
        bakeKenneyPedestrian(
          `${parts.body}+${parts.head}`,
          rig,
          { model: asSkinned(bodyEntry, parts.body), slots: bodyEntry?.ref.slots ?? [] },
          { model: asSkinned(headEntry, parts.head), slots: headEntry?.ref.slots ?? [] },
        ),
      )
    })
  } catch (error) {
    for (const kit of kits) kit.dispose()
    throw error
  }
  return kits
}

/**
 * Every pedestrian source by `pedestrians.source`. `s16b` has no source until S16b lands; the
 * runtime treats a missing source as "no pedestrians" and logs it.
 */
export const PEDESTRIAN_KIT_SOURCES: Readonly<
  Partial<Record<'kenney-temp' | 's16b', ScenePedestrianKitSource>>
> = {
  'kenney-temp': kenneyTempPedestrians,
}
