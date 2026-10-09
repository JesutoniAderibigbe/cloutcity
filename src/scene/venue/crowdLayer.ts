/**
 * The locals inside a venue (S43): src/lib/world/venueCrowd.ts says who is where; this draws them
 * the townsfolk's way (src/scene/ambient/townsfolk.ts), from the same pedestrian kits: each body
 * in each pose is baked into a loop of rigid frames (pedestrianKits.ts `bakeAnimatedKit`), drawn
 * as one colour-bucket InstancedMesh per bucket (skin, top, bottom, accent recoloured per local)
 * on one plain instanced toon material. A tier pays four draw calls per body and clip it shows,
 * and no new shader program. Dancers dance the dance moves (S16c, danceMoves.ts: the tier's first
 * `crowd.dance.moves` of them, baked like a walk), each local the move their phase picks, at the
 * venue's beat, every kit's loop offset from the others' so the floor never moves in unison, with
 * a gentle turn from their own phase. If the moves cannot load, dancers fall back to the `dance`
 * pose's clip with a bob and sway on the beat. Sitters sit on the seat they were given.
 *
 * Locals are NPCs, never players (UX-3): the merged `npc-*` models, never the player look's parts,
 * no name tag, never picked or counted. Loaded in its own lazy chunk with the bakers, after the
 * interior is up; until then (and for good, if the models fail) the venue is simply empty.
 */
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
import { log } from '@/lib/log'
import type { CrowdMember } from '@/lib/world/venueCrowd'
import { flatNormals } from '../ambient/flatNormals'
import { NPC_VARIANTS } from '../avatar/npc'
import { bakeAnimatedKit, type AnimatedKit } from '../ambient/pedestrianKits'
import type { RigModel } from '../models/prepare'
import { acquireModels } from '../models/runtime'
import { danceMoves, modelRef } from './danceMoves'
import type { crowdConfig } from './data'

type CrowdConfig = ReturnType<typeof crowdConfig>

const noRaycast: Object3D['raycast'] = () => {}
/** Bodies in member order (venueCrowd `body`: 0 the woman, 1 the man). */
const BODIES = ['npc-woman', 'npc-man'] as const
const RECOLOURED = new Set(['skin', 'top', 'bottom', 'accent'])

function fail(what: string): never {
  throw new Error(`venue crowd: ${what}`)
}

/** Logged when the dance moves cannot load: the dancers fall back to the `dance` pose's clip. */
export const DANCE_MOVES_FAILED_MESSAGE = 'venue crowd: the dance moves could not load'

/** One body's loop of one clip, as baked. */
export interface CrowdKit {
  readonly body: 0 | 1
  readonly clip: string
  /** Index among the tier's dance moves, or null for a pose's clip. */
  readonly move: number | null
  readonly baked: AnimatedKit<string>
}

/** One body in one clip, baked: its bucket meshes share one matrix attribute. */
interface Kit {
  readonly body: 0 | 1
  readonly clip: string
  readonly move: number | null
  /** Loop seconds per venue second (a move plays at the venue's beat). */
  readonly rate: number
  /** Where this kit's loop starts, as a share of the loop (kits never move in unison). */
  readonly offset: number
  readonly baked: AnimatedKit<string>
  readonly geometries: readonly BufferGeometry[]
  readonly meshes: readonly { readonly mesh: InstancedMesh; readonly bucket: string }[]
  readonly matrices: InstancedBufferAttribute
  frame: number
}

/** A frame rig with the dance moves' clips added (the moves bind to the same joints by name). */
function withMoves(rig: RigModel, moves: RigModel | undefined): RigModel {
  return moves === undefined ? rig : { kind: 'rig', clips: [...rig.clips, ...moves.clips] }
}

/**
 * Bakes the tier's kits: each body the tier draws (the man alone on one body) in each clip its
 * poses use, and in the tier's dance moves. Rejects when a body fails to load (the venue stays
 * empty of locals); when only the moves fail, the dancers keep the `dance` pose's clip.
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
  const refs = ids.map(modelRef)
  const dancing = config.poses.has('dance')
  const dance = danceMoves()
  const moves = dancing ? dance.moves.slice(0, config.dance.moves) : []
  const danceRefs = moves.length === 0 ? [] : variants.map((variant) => dance.rigFor(variant.rig))
  const acquired = acquireModels(refs, tier, cacheMaxEntries)
  const danceAcquired = danceRefs.every((ref) => ref !== null)
    ? acquireModels(danceRefs, tier, cacheMaxEntries)
    : null
  try {
    const [loaded, danceLoaded] = await Promise.all([
      acquired.models,
      (danceAcquired?.models ?? Promise.reject(new Error('a body has no dance rig'))).catch(
        (error: unknown) => {
          if (moves.length > 0) {
            log.info(DANCE_MOVES_FAILED_MESSAGE, {
              error: error instanceof Error ? error.message : String(error),
            })
          }
          return null
        },
      ),
    ])
    const byId = new Map(ids.map((id, i) => [id, loaded[i]]))
    const moved = danceLoaded !== null
    // The dance pose's own clip is only baked when the moves are not there to replace it.
    const clips = [
      ...new Set(
        [...config.poses]
          .filter((pose) => !(moved && pose === 'dance'))
          .map((pose) => config.clipOf(pose)),
      ),
    ]
    const kits: CrowdKit[] = []
    try {
      for (const [v, variant] of variants.entries()) {
        const rig = byId.get(variant.rig)
        const model = byId.get(variant.model)
        if (rig?.kind !== 'rig') fail(`"${variant.rig}" is not a rig`)
        if (model?.kind !== 'skinned') fail(`"${variant.model}" is not skinned`)
        const slots = refs.find((ref) => ref.id === variant.model)?.slots ?? []
        const parts = [{ model, slots }]
        for (const clip of clips) {
          const baked = await bakeAnimatedKit(
            `${variant.model}-${clip}`,
            rig,
            parts,
            clip,
            config.frames,
          )
          kits.push({ body: variant.body, clip, move: null, baked })
        }
        const danceRig = danceLoaded?.[v]
        if (danceRig === undefined) continue
        if (danceRig.kind !== 'rig') fail('a dance rig is not a rig')
        const posed = withMoves(rig, danceRig)
        for (const [move, clip] of (moved ? moves : []).entries()) {
          const baked = await bakeAnimatedKit(
            `${variant.model}-${clip}`,
            posed,
            parts,
            clip,
            config.dance.frames,
          )
          kits.push({ body: variant.body, clip, move, baked })
        }
      }
    } catch (error) {
      for (const kit of kits) kit.baked.dispose()
      throw error
    }
    return kits
  } finally {
    acquired.release()
    danceAcquired?.release()
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
  const moveRate = bpm / danceMoves().bpm
  const built: Kit[] = kits.map(({ body, clip, move, baked }, k) => {
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
    // Golden-ratio steps spread the kits' loop starts evenly, whatever their number.
    const offset = (k * 0.618034) % 1
    return {
      body,
      clip,
      move,
      rate: move === null ? 1 : moveRate,
      offset,
      baked,
      geometries,
      meshes,
      matrices,
      frame: -1,
    }
  })
  const moveCount = new Set(built.flatMap((kit) => (kit.move === null ? [] : [kit.move]))).size
  /** `dancer`: the member's rank among the dancers, from a start their phase picks. */
  const kitFor = (member: CrowdMember, dancer: number) => {
    if (member.pose === 'dance' && moveCount > 0) {
      // Dancers take the moves in turn, so the floor shows every move the tier bakes.
      const move = dancer % moveCount
      return (
        built.find((kit) => kit.body === member.body && kit.move === move) ??
        built.find((kit) => kit.move === move) ??
        null
      )
    }
    const clip = config.clipOf(member.pose)
    return (
      built.find((kit) => kit.body === member.body && kit.move === null && kit.clip === clip) ??
      built.find((kit) => kit.move === null && kit.clip === clip) ??
      null
    )
  }
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
        if (kit.move === null) {
          lift = Math.abs(Math.sin(beat * Math.PI)) * config.groove.bobM
          yaw += Math.sin(beat * Math.PI * 0.5) * config.groove.swayRad
        } else {
          // The move carries the bounce; a slow turn of their own keeps one move's dancers apart.
          yaw += Math.sin((beat / 8 + member.phase) * Math.PI * 2) * config.dance.swayRad
        }
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
    const u =
      still || kit.baked.durationS <= 0
        ? 0
        : ((timeS * kit.rate) / kit.baked.durationS + kit.offset) % 1
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
      const first = next.find((member) => member.pose === 'dance')
      let dancer = first === undefined ? 0 : Math.floor(first.phase * Math.max(1, moveCount))
      for (const member of next) {
        const kit = kitFor(member, dancer)
        if (member.pose === 'dance') dancer += 1
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
