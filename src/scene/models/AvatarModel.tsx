'use client'

/**
 * A hand-made avatar (S04h, S05): one body and one head (Kenney Mini Characters, recoloured
 * through their `_SLOT` regions) bound to a single skeleton and posed by the shared rig's
 * clips, plus up to `avatar.attachments.max` static attachments (S16a: glasses, a hearing aid,
 * later the Blender hair pieces and coverings), each a child of a rig joint so it follows the
 * pose with no extra skinning. Animation holds a continuous frame lease only while `animate` is true; otherwise the
 * avatar is posed once on the clip's first frame and requests a single frame, so an idle scene
 * still renders zero frames (frameloop="demand").
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  AnimationMixer,
  Matrix4,
  Mesh,
  Skeleton,
  SkinnedMesh,
  type AnimationClip,
  type Bone,
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

/**
 * Clones the body's skinned scene and binds a new head mesh to the clone's bones by joint name
 * (both parts carry the same seven-joint Kenney rig), so one mixer drives both.
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

  const bodyGeometry = recolorGeometry(bodySource.geometry, parts.body.slots, colors.body)
  const headGeometry = recolorGeometry(headSource.geometry, parts.head.slots, colors.head)
  bodyMesh.geometry = bodyGeometry
  bodyMesh.material = material

  const bones = new Map<string, Bone>(bodyMesh.skeleton.bones.map((bone) => [bone.name, bone]))
  const headBones = headSource.skeleton.bones.map((bone) => {
    const match = bones.get(bone.name)
    if (match === undefined) throw new Error(`head joint "${bone.name}" missing from the body`)
    return match
  })
  const headMesh = new SkinnedMesh(headGeometry, material)
  headMesh.name = headSource.name
  headMesh.position.copy(headSource.position)
  headMesh.quaternion.copy(headSource.quaternion)
  headMesh.scale.copy(headSource.scale)
  // The body GLB keeps an empty node where the head mesh sat; the bound head replaces it.
  const slot = root.getObjectByName(headSource.name)
  const parent = slot?.parent ?? bodyMesh.parent ?? root
  slot?.removeFromParent()
  parent.add(headMesh)
  headMesh.bind(new Skeleton(headBones, headSource.skeleton.boneInverses), headSource.bindMatrix)

  // Each attachment hangs off its joint, placed where the bind pose puts it: its offset in the
  // character's space, carried into the joint's frame by the joint's bind-pose world matrix.
  root.updateMatrixWorld(true)
  const extras: { readonly geometry: typeof bodyGeometry; readonly source: typeof bodyGeometry }[] =
    []
  for (const { part, model } of attachments) {
    const joint = bones.get(part.joint)
    if (joint === undefined) throw new Error(`attachment joint "${part.joint}" missing`)
    const geometry = recolorGeometry(model.geometry, part.ref.slots, part.colors)
    const mesh = new Mesh(geometry, material)
    mesh.name = `${part.ref.id}-attachment`
    mesh.matrixAutoUpdate = false
    mesh.matrix
      .copy(joint.matrixWorld)
      .invert()
      .multiply(new Matrix4().makeTranslation(...part.offset))
      .multiply(model.matrix)
    joint.add(mesh)
    extras.push({ geometry, source: model.geometry })
  }

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
    triangles:
      triangleCount(bodyGeometry) +
      triangleCount(headGeometry) +
      extras.reduce((sum, extra) => sum + triangleCount(extra.geometry), 0),
    dispose() {
      for (const extra of extras) disposeRecolored(extra.source, extra.geometry)
      mixer.stopAllAction()
      mixer.uncacheRoot(root)
      disposeRecolored(bodySource.geometry, bodyGeometry)
      disposeRecolored(headSource.geometry, headGeometry)
      bodyMesh.skeleton.dispose()
      headMesh.skeleton.dispose()
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
  readonly onStatus?: (status: AvatarStatus) => void
  /** The assembled avatar, for callers that size or measure it. */
  readonly onAssembled?: (avatar: AssembledAvatar | null) => void
}) {
  const { material } = useModelsContext()
  const invalidate = useThree((state) => state.invalidate)
  const attachments = parts.attachments ?? []
  const state = useModels([parts.rig, parts.body, parts.head, ...attachments.map((a) => a.ref)])
  const colorsKey = [
    slotColorsKey(colors?.head),
    slotColorsKey(colors?.body),
    ...attachments.map(
      (a) => `${a.ref.id}:${a.joint}:${a.offset.join(',')}:${slotColorsKey(a.colors)}`,
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
    onAssembledRef.current?.(ready.assembled)
    return () => {
      onAssembledRef.current?.(null)
      // The avatar leaves the scene (unmount, or rebuilt for new parts): no longer 'ready'.
      onStatusRef.current?.('loading')
      ready.assembled.dispose()
    }
  }, [ready])

  useEffect(() => {
    if (ready === null) return
    const { mixer } = ready.assembled
    const action = mixer.clipAction(clipNamed(ready.rig, clip))
    action.reset().play()
    mixer.update(0)
    invalidate()
    return () => {
      action.stop()
    }
  }, [ready, clip, invalidate])

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
