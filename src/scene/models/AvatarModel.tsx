'use client'

/**
 * A hand-made avatar (S04h, S05; S16b): the outfit's body, the frame's face and up to
 * `avatar.attachments.max` static attachments (hair, facial hair, eyewear, items) merged into ONE
 * SkinnedMesh on the body's skeleton, posed by the frame's rig clips. Attachments are skinned
 * with weight 1 on the joint they follow, so the whole avatar is one draw call and one (skinned)
 * shader program, whatever it wears. Animation holds a continuous frame lease only while
 * `animate` is true; otherwise the avatar is posed once on the clip's first frame and requests a
 * single frame: it adds no frames of its own (frameloop="demand").
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  AnimationMixer,
  BufferAttribute,
  BufferGeometry,
  Matrix3,
  Matrix4,
  SkinnedMesh,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type Material,
  type Object3D,
} from 'three'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { log } from '@/lib/log'
import type { AvatarAttachment } from '../avatar/resolveLook'
import { triangleCount, type RigModel, type SkinnedPartModel, type StaticModel } from './prepare'
import { useModels, useModelsContext } from './runtime'
import { disposeRecolored, recolorGeometry, slotColorsKey, type SlotColors } from './slots'
import type { ModelRef } from './types'

export interface AvatarParts {
  /** The body frame's rig (S16b: one per frame), whose clips pose the avatar. */
  readonly rig: ModelRef
  readonly head: ModelRef
  readonly body: ModelRef
  /** Static models fixed to rig joints (src/scene/avatar/resolveLook.ts). */
  readonly attachments?: readonly AvatarAttachment[]
}

/** An attachment with its loaded model. */
interface LoadedAttachment {
  readonly part: AvatarAttachment
  readonly model: StaticModel
}

export interface AvatarColors {
  readonly head?: SlotColors
  readonly body?: SlotColors
}

export interface AssembledAvatar {
  readonly root: Object3D
  readonly mixer: AnimationMixer
  /** The avatar's own triangles (the showcase hook and the low-tier headroom check). */
  readonly triangles: number
  dispose(): void
}

const noRaycast: Object3D['raycast'] = () => {}

function skinnedMeshOf(root: Object3D): SkinnedMesh {
  let found: SkinnedMesh | undefined
  root.traverse((object) => {
    if (found === undefined && object instanceof SkinnedMesh) found = object
  })
  if (found === undefined) throw new Error('avatar part has no skinned mesh')
  return found
}

/** Growable float arrays for the merged geometry. */
interface Merge {
  readonly position: number[]
  readonly normal: number[]
  readonly color: number[]
  readonly skinIndex: number[]
  readonly skinWeight: number[]
}

/**
 * Appends a part's triangles to the merge, unindexed. `matrixFor` gives the transform carrying
 * each vertex into the body's bind space (null: already there); `skin` its four joint indices
 * (into the body's skeleton) and weights.
 */
function append(
  merge: Merge,
  geometry: BufferGeometry,
  matrixFor: (vertex: number) => Matrix4 | null,
  skin: (vertex: number, joints: number[], weights: number[]) => void,
) {
  const flat = geometry.index === null ? geometry : geometry.toNonIndexed()
  if (flat.getAttribute('normal') === undefined) flat.computeVertexNormals()
  const position = flat.getAttribute('position')
  const normal = flat.getAttribute('normal')
  const color = flat.getAttribute('color')
  const normalMatrices = new Map<Matrix4, Matrix3>()
  const point = new Vector3()
  const direction = new Vector3()
  const joints = [0, 0, 0, 0]
  const weights = [0, 0, 0, 0]
  for (let i = 0; i < position.count; i++) {
    const matrix = matrixFor(i)
    point.set(position.getX(i), position.getY(i), position.getZ(i))
    direction.set(normal.getX(i), normal.getY(i), normal.getZ(i))
    if (matrix !== null) {
      let normalMatrix = normalMatrices.get(matrix)
      if (normalMatrix === undefined) {
        normalMatrix = new Matrix3().getNormalMatrix(matrix)
        normalMatrices.set(matrix, normalMatrix)
      }
      point.applyMatrix4(matrix)
      direction.applyMatrix3(normalMatrix)
    }
    direction.normalize()
    merge.position.push(point.x, point.y, point.z)
    merge.normal.push(direction.x, direction.y, direction.z)
    if (color === undefined) merge.color.push(1, 1, 1)
    else merge.color.push(color.getX(i), color.getY(i), color.getZ(i))
    skin(i, joints, weights)
    merge.skinIndex.push(...joints)
    merge.skinWeight.push(...weights)
  }
  if (flat !== geometry) flat.dispose()
}

/**
 * Merges the body, the face and the attachments into one SkinnedMesh bound to the body clone's
 * skeleton (S16b). The face's vertices are carried into the body's bind space joint by joint
 * (both carry the same frame's joints, so this is exact for the rigid face), and each attachment
 * (modelled in the character's bind pose) is skinned with weight 1 on its joint.
 */
export function assembleAvatar(
  body: SkinnedPartModel,
  head: SkinnedPartModel,
  parts: AvatarParts,
  material: Material,
  colors: AvatarColors,
  attachments: readonly LoadedAttachment[] = [],
): AssembledAvatar {
  const root = cloneSkinned(body.scene)
  const bodyMesh = skinnedMeshOf(root)
  const bodySource = skinnedMeshOf(body.scene)
  const headSource = skinnedMeshOf(head.scene)
  const skeleton = bodyMesh.skeleton
  const jointOf = new Map(skeleton.bones.map((bone, i) => [bone.name, i]))
  const merge: Merge = { position: [], normal: [], color: [], skinIndex: [], skinWeight: [] }

  const recolored: { readonly source: BufferGeometry; readonly geometry: BufferGeometry }[] = []
  const recolor = (source: BufferGeometry, slots: readonly string[], c?: SlotColors) => {
    const geometry = recolorGeometry(source, slots, c)
    recolored.push({ source, geometry })
    return geometry
  }

  // The body: its own skin, as decoded.
  const bodyGeometry = recolor(bodySource.geometry, parts.body.slots, colors.body)
  {
    const skinIndex = bodyGeometry.getAttribute('skinIndex')
    const skinWeight = bodyGeometry.getAttribute('skinWeight')
    append(
      merge,
      bodyGeometry,
      () => null,
      (i, joints, weights) => {
        for (let k = 0; k < 4; k++) {
          joints[k] = skinIndex.getComponent(i, k)
          weights[k] = skinWeight.getComponent(i, k)
        }
      },
    )
  }

  // The face: its joints renumbered into the body's skeleton by name, each vertex carried from
  // the face's bind space into the body's through its strongest joint.
  const headGeometry = recolor(headSource.geometry, parts.head.slots, colors.head)
  {
    const skinIndex = headGeometry.getAttribute('skinIndex')
    const skinWeight = headGeometry.getAttribute('skinWeight')
    const headBones = headSource.skeleton.bones
    const remap = headBones.map((bone) => {
      const at = jointOf.get(bone.name)
      if (at === undefined) throw new Error(`head joint "${bone.name}" missing from the body`)
      return at
    })
    const carry = headBones.map((_, j) =>
      new Matrix4()
        .copy(skeleton.boneInverses[remap[j] ?? 0] ?? new Matrix4())
        .invert()
        .multiply(headSource.skeleton.boneInverses[j] ?? new Matrix4()),
    )
    const strongest = (i: number) => {
      let best = 0
      for (let k = 1; k < 4; k++) {
        if (skinWeight.getComponent(i, k) > skinWeight.getComponent(i, best)) best = k
      }
      return skinIndex.getComponent(i, best)
    }
    const identity = new Matrix4()
    append(
      merge,
      headGeometry,
      (i) => carry[strongest(i)] ?? identity,
      (i, joints, weights) => {
        for (let k = 0; k < 4; k++) {
          joints[k] = remap[skinIndex.getComponent(i, k)] ?? 0
          weights[k] = skinWeight.getComponent(i, k)
        }
      },
    )
  }

  for (const { part, model } of attachments) {
    const joint = jointOf.get(part.joint)
    if (joint === undefined) throw new Error(`attachment joint "${part.joint}" missing`)
    const geometry = recolor(model.geometry, part.ref.slots, part.colors)
    const matrix = new Matrix4().makeTranslation(...part.offset)
    if (part.scale !== undefined) matrix.scale(new Vector3(...part.scale))
    matrix.multiply(model.matrix)
    append(
      merge,
      geometry,
      () => matrix,
      (_, joints, weights) => {
        joints.splice(0, 4, joint, 0, 0, 0)
        weights.splice(0, 4, 1, 0, 0, 0)
      },
    )
  }

  const merged = new BufferGeometry()
  merged.setAttribute('position', new BufferAttribute(Float32Array.from(merge.position), 3))
  merged.setAttribute('normal', new BufferAttribute(Float32Array.from(merge.normal), 3))
  merged.setAttribute('color', new BufferAttribute(Float32Array.from(merge.color), 3))
  merged.setAttribute('skinIndex', new BufferAttribute(Uint16Array.from(merge.skinIndex), 4))
  merged.setAttribute('skinWeight', new BufferAttribute(Float32Array.from(merge.skinWeight), 4))
  for (const { source, geometry } of recolored) disposeRecolored(source, geometry)

  const mesh = new SkinnedMesh(merged, material)
  mesh.name = parts.body.id
  mesh.position.copy(bodyMesh.position)
  mesh.quaternion.copy(bodyMesh.quaternion)
  mesh.scale.copy(bodyMesh.scale)
  const parent = bodyMesh.parent ?? root
  bodyMesh.removeFromParent()
  parent.add(mesh)
  mesh.bind(skeleton, bodyMesh.bindMatrix)

  root.traverse((object) => {
    object.raycast = noRaycast
    // Bind-pose bounds do not follow animated limbs; one small avatar is cheaper to always draw
    // than to re-fit every frame.
    object.frustumCulled = false
  })

  const mixer = new AnimationMixer(root)
  return {
    root,
    mixer,
    triangles: triangleCount(merged),
    dispose() {
      mixer.stopAllAction()
      mixer.uncacheRoot(root)
      merged.dispose()
      skeleton.dispose()
    },
  }
}

export function clipNamed(rig: RigModel, name: string): AnimationClip {
  const clip = rig.clips.find((candidate) => candidate.name === name)
  if (clip === undefined) throw new Error(`rig has no clip "${name}"`)
  return clip
}

export type AvatarStatus = 'loading' | 'ready' | 'error'

export function AvatarModel({
  parts,
  colors,
  clip,
  animate,
  name,
  scale = 1,
  shadows = false,
  fadeS = 0,
  onStatus,
  onAssembled,
}: {
  readonly parts: AvatarParts
  readonly colors?: AvatarColors
  /** The rig clip to pose (or play while `animate`). */
  readonly clip: string
  /** Plays the clip with a continuous frame lease; false poses its first frame once. */
  readonly animate: boolean
  readonly name?: string
  /** Root scale (S16a: the height option). */
  readonly scale?: number
  /** Casts the sun's shadow (the high tier's one directional shadow map). */
  readonly shadows?: boolean
  /**
   * Cross-fades from the last clip to a new one over this many seconds (S40c: the room's Sim
   * walking into a sit); 0 cuts. A fade only plays while `animate` is true.
   */
  readonly fadeS?: number
  readonly onStatus?: (status: AvatarStatus) => void
  /** The assembled avatar and its rig's clips, for callers that size, measure or drive it. */
  readonly onAssembled?: (avatar: AssembledAvatar | null, clips: readonly AnimationClip[]) => void
}) {
  const { material } = useModelsContext()
  const invalidate = useThree((state) => state.invalidate)
  const attachments = parts.attachments ?? []
  const state = useModels([parts.rig, parts.body, parts.head, ...attachments.map((a) => a.ref)])
  const colorsKey = [
    slotColorsKey(colors?.head),
    slotColorsKey(colors?.body),
    ...attachments.map(
      (a) =>
        `${a.ref.id}:${a.joint}:${a.offset.join(',')}:${a.scale?.join(',') ?? ''}:${slotColorsKey(a.colors)}`,
    ),
  ].join('|')

  // Bad part data is an expected failure here (a stale deploy, a mismatched rig): it logs once
  // and reports `error`, so the caller keeps its placeholder instead of the canvas crashing.
  const avatar = useMemo(() => {
    if (state.status !== 'ready') return null
    const [rig, body, head, ...extra] = state.models
    try {
      if (rig?.kind !== 'rig' || body?.kind !== 'skinned' || head?.kind !== 'skinned') {
        throw new Error('avatar parts must be a rig, a skinned body and a skinned head')
      }
      const loaded = attachments.map((part, i): LoadedAttachment => {
        const model = extra[i]
        if (model?.kind !== 'static') throw new Error(`attachment ${part.ref.id} is not static`)
        return { part, model }
      })
      // Fails here, not later in an effect, when the rig lacks the clip.
      clipNamed(rig, clip)
      const assembled = assembleAvatar(body, head, parts, material, colors ?? {}, loaded)
      assembled.root.scale.setScalar(scale)
      if (name !== undefined) assembled.root.name = name
      assembled.root.traverse((object) => {
        object.castShadow = shadows
      })
      return { assembled, rig }
    } catch (error) {
      log.warn('avatar assembly failed', {
        parts: [parts.rig.id, parts.body.id, parts.head.id],
        error: error instanceof Error ? error.message : String(error),
      })
      return 'failed' as const
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, material, colorsKey, name, shadows, clip, scale])

  const onStatusRef = useRef(onStatus)
  const onAssembledRef = useRef(onAssembled)
  useEffect(() => {
    onStatusRef.current = onStatus
    onAssembledRef.current = onAssembled
  })

  useEffect(() => {
    const failed = avatar === 'failed' || state.status === 'error'
    onStatusRef.current?.(failed ? 'error' : avatar !== null ? 'ready' : 'loading')
  }, [avatar, state.status])

  const ready = avatar === null || avatar === 'failed' ? null : avatar

  useEffect(() => {
    if (ready === null) return
    onAssembledRef.current?.(ready.assembled, ready.rig.clips)
    return () => {
      onAssembledRef.current?.(null, [])
      // The avatar leaves the scene (unmount, or rebuilt for new parts): no longer 'ready'.
      onStatusRef.current?.('loading')
      ready.assembled.dispose()
    }
  }, [ready])

  // The action playing now: a new clip fades in from it (or cuts, with no fade), and it stops
  // with the avatar.
  const playing = useRef<AnimationAction | null>(null)
  const fadeRef = useRef(fadeS)
  useEffect(() => {
    fadeRef.current = fadeS
  })
  useEffect(() => {
    if (ready === null) return
    const { mixer } = ready.assembled
    const action = mixer.clipAction(clipNamed(ready.rig, clip))
    const previous = playing.current
    action.reset().play()
    if (previous !== null && previous !== action) {
      if (fadeRef.current > 0) action.crossFadeFrom(previous, fadeRef.current, false)
      else previous.stop()
    }
    playing.current = action
    mixer.update(0)
    invalidate()
  }, [ready, clip, invalidate])
  useEffect(
    () => () => {
      playing.current?.stop()
      playing.current = null
    },
    [ready],
  )

  // The frame lease: while animating, every frame advances the mixer and asks for the next.
  useFrame((_, delta) => {
    if (!animate || ready === null) return
    ready.assembled.mixer.update(delta)
    invalidate()
  })
  useEffect(() => {
    if (animate && ready !== null) invalidate()
  }, [animate, ready, invalidate])

  return ready === null ? null : <primitive object={ready.assembled.root} />
}
