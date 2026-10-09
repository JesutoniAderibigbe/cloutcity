/**
 * The locals inside a venue (S43): src/lib/world/venueCrowd.ts says who is where; this draws them
 * the townsfolk's way (src/scene/ambient/townsfolk.ts), from the same pedestrian kits: each body
 * in each pose is baked into a loop of rigid frames (pedestrianKits.ts `bakeAnimatedKit`), drawn
 * as one colour-bucket InstancedMesh per bucket (skin, top, bottom, accent recoloured per local)
 * on one plain instanced toon material. A tier pays four draw calls per body and pose it shows,
 * and no new shader program. Dancers bob and sway on the beat on top of their loop (the rigs have
 * no dance clip), each from their own phase; sitters sit on the seat they were given.
 *
 * Locals are NPCs, never players (UX-3): the merged `npc-*` models, never the player look's parts,
 * no name tag, never picked or counted. Loaded in its own lazy chunk with the bakers, after the
 * interior is up; until then (and for good, if the models fail) the venue is simply empty.
 */
import manifestJson from '@data/assets/manifest.json'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type Material,
  type Object3D,
} from 'three'
import type { QualityTier } from '@/lib/data/schemas/config'
import type { CrowdMember } from '@/lib/world/venueCrowd'
import type { TownsfolkPose } from '@/lib/world/ambient/types'
import { flatNormals } from '../ambient/flatNormals'
import { NPC_VARIANTS } from '../avatar/npc'
import { bakeAnimatedKit, type AnimatedKit } from '../ambient/pedestrianKits'
import { acquireModels } from '../models/runtime'
import type { ModelRef } from '../models/types'
import type { crowdConfig } from './data'

type CrowdConfig = ReturnType<typeof crowdConfig>

const noRaycast: Object3D['raycast'] = () => {}
/** Bodies in member order (venueCrowd `body`: 0 the woman, 1 the man). */
const BODIES = ['npc-woman', 'npc-man'] as const
const RECOLOURED = new Set(['skin', 'top', 'bottom', 'accent'])

function fail(what: string): never {
  throw new Error(`venue crowd: ${what}`)
}

/** A manifest model as a ref the model runtime loads. */
function refOf(id: string): ModelRef {
  const entry = manifestJson.models.find((candidate) => candidate.id === id)
  if (entry === undefined) fail(`no model "${id}" in the manifest`)
  const kind = entry.kind
  if (kind !== 'rig' && kind !== 'skinned') fail(`"${id}" is not a rig or skinned model`)
  return {
    id: entry.id,
    kind,
    category: entry.category as ModelRef['category'],
    slots: entry.slots,
    emissive: entry.emissive,
    clips: entry.clips,
    files: { low: entry.tiers.low.file, mid: entry.tiers.mid.file, high: entry.tiers.high.file },
  }
}

/** One body's loop of one clip, as baked. */
export interface CrowdKit {
  readonly body: 0 | 1
  readonly clip: TownsfolkPose
  readonly baked: AnimatedKit
}

/** One body in one clip, baked: its bucket meshes share one matrix attribute. */
interface Kit {
  readonly body: 0 | 1
  readonly clip: TownsfolkPose
  readonly baked: AnimatedKit
  readonly geometries: readonly BufferGeometry[]
  readonly meshes: readonly { readonly mesh: InstancedMesh; readonly bucket: string }[]
  readonly matrices: InstancedBufferAttribute
  frame: number
}

/**
 * Bakes the tier's kits: each body the tier draws (the man alone on one body) in each clip its
 * poses use. Rejects when a model fails to load (the venue stays empty of locals).
 */
export async function bakeCrowdKits(
  tier: QualityTier,
  config: CrowdConfig,
  cacheMaxEntries: number,
): Promise<CrowdKit[]> {
  const bodies: (0 | 1)[] = config.bodies < 2 ? [1] : [0, 1]
  const variants = bodies.map((body) => {
    const model = BODIES[body]
    const variant =
      NPC_VARIANTS.find((candidate) => candidate.model === model) ?? fail(`no variant ${model}`)
    return { ...variant, body }
  })
  const ids = [...new Set(variants.flatMap((variant) => [variant.rig, variant.model]))]
  const refs = ids.map(refOf)
  const acquired = acquireModels(refs, tier, cacheMaxEntries)
  try {
    const loaded = await acquired.models
    const byId = new Map(ids.map((id, i) => [id, loaded[i]]))
    const clips = [...new Set([...config.poses].map((pose) => config.clipOf(pose)))]
    const kits: CrowdKit[] = []
    try {
      for (const variant of variants) {
        const rig = byId.get(variant.rig)
        const model = byId.get(variant.model)
        if (rig?.kind !== 'rig') fail(`"${variant.rig}" is not a rig`)
        if (model?.kind !== 'skinned') fail(`"${variant.model}" is not skinned`)
        const slots = refs.find((ref) => ref.id === variant.model)?.slots ?? []
        for (const clip of clips) {
          const baked = await bakeAnimatedKit(
            `${variant.model}-${clip}`,
            rig,
            [{ model, slots }],
            clip,
            config.frames,
          )
          kits.push({ body: variant.body, clip, baked })
        }
      }
    } catch (error) {
      for (const kit of kits) kit.baked.dispose()
      throw error
    }
    return kits
  } finally {
    acquired.release()
  }
}

export interface CrowdLayer {
  readonly group: Group
  /** Shows exactly `members` (the planner's list). */
  setMembers(members: readonly CrowdMember[]): void
  /** Moves the loops and grooves on to `timeS`; returns whether anything moved. */
  update(timeS: number, still: boolean): boolean
  /** Locals drawn now. */
  drawn(): number
  dispose(): void
}

/**
 * The layer over baked `kits` (bakeCrowdKits), drawn with `material` (instanced toon, instance
 * colours). `bpm` is the venue's beat; `capacity` the most locals the tier ever shows.
 */
export function createCrowdLayer(
  kits: readonly CrowdKit[],
  material: Material,
  config: CrowdConfig,
  bpm: number,
  capacity: number,
): CrowdLayer {
  const group = new Group()
  group.name = 'venue-crowd'
  group.raycast = noRaycast
  const size = Math.max(1, capacity)
  const built: Kit[] = kits.map(({ body, clip, baked }) => {
    const matrices = new InstancedBufferAttribute(new Float32Array(size * 16), 16)
    matrices.setUsage(DynamicDrawUsage)
    const geometries = baked.parts.map((part) => {
      const geometry = new BufferGeometry()
      const position = new BufferAttribute(
        Float32Array.from(part.geometry.getAttribute('position').array),
        3,
      )
      const normal = new BufferAttribute(
        Float32Array.from(part.geometry.getAttribute('normal').array),
        3,
      )
      position.setUsage(DynamicDrawUsage)
      normal.setUsage(DynamicDrawUsage)
      geometry.setAttribute('position', position)
      geometry.setAttribute('normal', normal)
      geometry.computeBoundingSphere()
      return geometry
    })
    const meshes = baked.parts.map((part, p) => {
      const mesh = new InstancedMesh(geometries[p] ?? part.geometry, material, size)
      mesh.name = `venue-crowd-${baked.id}-${part.bucket}`
      mesh.instanceMatrix = matrices
      const colors = new Float32Array(size * 3)
      const color = new Color(part.color)
      for (let i = 0; i < size; i++) color.toArray(colors, i * 3)
      mesh.instanceColor = new InstancedBufferAttribute(colors, 3)
      mesh.frustumCulled = false
      mesh.raycast = noRaycast
      mesh.count = 0
      mesh.visible = false
      group.add(mesh)
      return { mesh, bucket: part.bucket }
    })
    return { body, clip, baked, geometries, meshes, matrices, frame: -1 }
  })
  const kitFor = (body: 0 | 1, clip: string) =>
    built.find((kit) => kit.body === body && kit.clip === clip) ??
    built.find((kit) => kit.clip === clip) ??
    null
  // A sitter is scaled as tall as its body stands (the sit loop is shorter than it stands).
  const standHeight = (body: 0 | 1) =>
    built.find((kit) => kit.body === body && kit.clip !== 'sit')?.baked.heightM ??
    built.find((kit) => kit.clip !== 'sit')?.baked.heightM ??
    1

  let members: { readonly member: CrowdMember; readonly kit: Kit; readonly slot: number }[] = []
  const matrix = new Matrix4()
  const position = new Vector3()
  const scale = new Vector3()
  const quaternion = new Quaternion()
  const up = new Vector3(0, 1, 0)
  const color = new Color()
  const beatS = 60 / bpm

  const place = (timeS: number, still: boolean) => {
    for (const { member, kit, slot } of members) {
      const stand = standHeight(member.body)
      const k = member.heightM / (kit.clip === 'sit' ? stand : kit.baked.heightM)
      let yaw = member.headingRad
      let lift = 0
      if (member.pose === 'dance' && !still) {
        const beat = timeS / beatS + member.phase * 2
        lift = Math.abs(Math.sin(beat * Math.PI)) * config.groove.bobM
        yaw += Math.sin(beat * Math.PI * 0.5) * config.groove.swayRad
      }
      if (kit.clip === 'sit') {
        // The seat lies under the thighs, just behind the loop's origin: put it on the seat.
        const back = config.sit.backShare * member.heightM
        position.set(
          member.x + Math.sin(member.headingRad) * back,
          member.y - config.sit.seatShare * member.heightM,
          member.z + Math.cos(member.headingRad) * back,
        )
      } else {
        position.set(member.x, lift, member.z)
      }
      quaternion.setFromAxisAngle(up, yaw)
      scale.setScalar(k)
      matrix.compose(position, quaternion, scale)
      matrix.toArray(kit.matrices.array, slot * 16)
    }
    for (const kit of built) kit.matrices.needsUpdate = true
  }

  const showFrame = (kit: Kit, timeS: number, still: boolean) => {
    const frames = kit.baked.frames
    const u = still || kit.baked.durationS <= 0 ? 0 : (timeS / kit.baked.durationS) % 1
    const f = Math.min(frames.length - 1, Math.floor(u * frames.length))
    if (f === kit.frame) return false
    kit.frame = f
    const frame = frames[f]
    kit.geometries.forEach((geometry, p) => {
      const source = frame?.[p]
      const positionAttribute = geometry.getAttribute('position')
      const normal = geometry.getAttribute('normal')
      if (source === undefined || !(positionAttribute instanceof BufferAttribute)) return
      positionAttribute.array.set(source)
      flatNormals(source, normal.array as Float32Array)
      positionAttribute.needsUpdate = true
      normal.needsUpdate = true
    })
    return true
  }

  return {
    group,
    setMembers(next) {
      const counts = new Map<Kit, number>()
      members = []
      for (const member of next) {
        const kit = kitFor(member.body, config.clipOf(member.pose))
        if (kit === null) continue
        const slot = counts.get(kit) ?? 0
        if (slot >= size) continue
        counts.set(kit, slot + 1)
        members.push({ member, kit, slot })
        for (const { mesh, bucket } of kit.meshes) {
          const hex =
            bucket === 'skin'
              ? member.colors.skin
              : bucket === 'top'
                ? member.colors.top
                : bucket === 'bottom'
                  ? member.colors.bottom
                  : member.colors.accent
          if (RECOLOURED.has(bucket) && mesh.instanceColor !== null) {
            color.set(hex).toArray(mesh.instanceColor.array, slot * 3)
          }
        }
      }
      for (const kit of built) {
        const count = counts.get(kit) ?? 0
        for (const { mesh } of kit.meshes) {
          mesh.count = count
          mesh.visible = count > 0
          if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true
        }
        kit.frame = -1
      }
      place(0, true)
    },
    update(timeS, still) {
      if (members.length === 0) return false
      let moved = false
      for (const kit of built) {
        if (kit.meshes[0]?.mesh.visible === true && showFrame(kit, timeS, still)) moved = true
      }
      if (!still) {
        place(timeS, still)
        moved = true
      }
      return moved
    },
    drawn: () => members.length,
    dispose() {
      for (const kit of built) {
        for (const geometry of kit.geometries) geometry.dispose()
        for (const { mesh } of kit.meshes) mesh.dispose()
      }
    },
  }
}
