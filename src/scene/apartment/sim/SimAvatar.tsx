'use client'

/**
 * The player's Sim in a room scene (S40c, generalised for venue interiors in S43): their look
 * (src/state/playerLook.ts) as a hand-made avatar that lives in the room like a Sim. It starts at
 * `start`; an action reported through `subscribe` sends it to the furniture or spot that action
 * uses (sim/simController.ts); a tap on a seat sits it there, and a tap on the floor gets it up
 * and walks it over. The apartment (RoomAvatar.tsx) and the venue interiors
 * (src/scene/venue/VenuePeople.tsx) differ only in the world, data and actions they hand in.
 *
 * Visual only: the engine has applied the action (clock, stats) before the Sim moves.
 *
 * On every tier it fits perf.json `apartment.avatarReserve`; on a device reporting little memory
 * nothing is drawn, as on the map's capsule rule. It draws frames only while it moves or animates
 * (or the camera does). Under reduced motion every move is a cut to the pose, and a groove (the
 * venue's dance) stands still.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  Plane,
  Raycaster,
  Vector2,
  Vector3,
  type AnimationClip,
  type Camera,
  type Group,
} from 'three'
import type { QualityTier } from '@/lib/data/schemas/config'
import { copy, isCopyKey } from '@/lib/copy'
import { useReducedMotion } from '@/lib/useReducedMotion'
import { usePlayerLook } from '@/state/playerLook'
import { ModelsProvider } from '../../models/runtime'
import type { AssembledAvatar } from '../../models/AvatarModel'
import { LookAvatar } from '../../avatar/LookAvatar'
import type { ResolvedLook } from '../../avatar/resolveLook'
import { attachTapDetector } from '../../pins/tap'
import { createToonRamp } from '../../toonRamp'
import { modelsConfig } from '../modelsConfig'
import { tapOptions } from '../data'
import { buildProps, type SimProps } from './props'
import { SimController, type Body, type SimFrame } from './simController'
import type { SimData } from './simData'
import type { SimWorld } from './simWorld'

/** Longest step the Sim takes in one frame: a frame after a long idle must not jump it. */
const MAX_STEP_S = 0.1

/**
 * A procedural groove over a held clip (the venue's dance, S43): while the Sim plays `clip`
 * standing up, it bobs `bobM` and sways `swayDeg` either way on the beat. The rigs have no dance
 * clip; this is what makes a hands-up loop read as dancing.
 */
export interface SimGroove {
  readonly clip: string
  readonly bpm: number
  readonly bobM: number
  readonly swayDeg: number
}

function deviceMemoryGB(): number | undefined {
  if (typeof navigator === 'undefined') return undefined
  const memory: unknown = (navigator as Navigator & { deviceMemory?: unknown }).deviceMemory
  return typeof memory === 'number' ? memory : undefined
}

/** The bubble over the Sim's head: a DOM label beside the canvas, placed each frame. */
function createBubble(parent: HTMLElement): HTMLDivElement {
  const bubble = document.createElement('div')
  bubble.setAttribute('aria-hidden', 'true')
  bubble.dataset.apartmentSimBubble = ''
  bubble.className =
    'pointer-events-none absolute top-0 left-0 rounded-full glass px-3 py-1 text-sm font-bold text-fg shadow-md'
  bubble.hidden = true
  parent.appendChild(bubble)
  return bubble
}

const HEAD = new Vector3()

/** Shows the frame's prop (a pan, a plate) where it goes; hides the others. */
function placeProps(props: SimProps, frame: SimFrame): void {
  for (const [id, mesh] of props.meshes) {
    const shown = frame.prop?.id === id
    mesh.visible = shown
    if (shown && frame.prop !== null) {
      mesh.position.set(...frame.prop.at)
      mesh.rotation.set(0, frame.prop.yaw, 0)
    }
  }
}

/**
 * Puts the frame's bubble ("Zzz") over the Sim's head on screen, or hides it. Its copy is in a
 * namespace the panel or sheet beside the scene has loaded (the scene shows only with it), so
 * this chunk does not carry a second copy of it; a key not loaded shows no bubble.
 */
function placeBubble(
  bubble: HTMLDivElement,
  avatar: AssembledAvatar | null,
  frame: SimFrame,
  camera: Camera,
  size: { readonly width: number; readonly height: number },
  data: SimData,
): void {
  const key = frame.bubble
  const joint = avatar?.root.getObjectByName(data.bubble.joint)
  if (key === null || !isCopyKey(key) || joint === undefined) {
    bubble.hidden = true
    delete bubble.dataset.key
    return
  }
  if (bubble.dataset.key !== key) {
    bubble.textContent = copy(key)
    bubble.dataset.key = key
  }
  joint.getWorldPosition(HEAD)
  HEAD.y += data.bubble.aboveHeadM
  HEAD.project(camera)
  bubble.hidden = HEAD.z > 1
  bubble.style.transform = `translate(${((HEAD.x + 1) / 2) * size.width}px, ${((1 - HEAD.y) / 2) * size.height}px) translate(-50%, -100%)`
}

export interface SimAvatarProps {
  /** Whose fallback spots apply: the home id, or the venue interior's id. */
  readonly scope: string
  readonly data: SimData
  /** What the Sim walks around and uses. */
  readonly world: SimWorld
  /** Where it stands when the scene opens (and after a scope change). */
  readonly start: Body
  /** Listens for the actions to act out; returns the function that stops listening. */
  readonly subscribe: (perform: (actionId: string) => void) => () => void
  /** Taps sit and walk the Sim (off while buy mode's grid takes them). */
  readonly tapsEnabled: boolean
  /** The floor's extent: taps outside it are ignored. */
  readonly floor: { readonly widthM: number; readonly depthM: number }
  readonly tier: QualityTier
  readonly toonRamp: readonly number[]
  /** How tall the avatar stands (scene.json `apartment.avatarHeightM`). */
  readonly avatarHeightM: number
  /** The avatar group's name (the test hooks find it by name). */
  readonly name: string
  readonly groove?: SimGroove | null
}

export function SimAvatar({
  scope,
  data,
  world,
  start,
  subscribe,
  tapsEnabled,
  floor,
  tier,
  toonRamp,
  avatarHeightM,
  name,
  groove = null,
}: SimAvatarProps) {
  const look = usePlayerLook()
  const config = useMemo(() => modelsConfig(), [])
  const gradientMap = useMemo(
    () => (config.shading === 'toon' ? createToonRamp(toonRamp) : undefined),
    [config.shading, toonRamp],
  )
  useEffect(() => () => gradientMap?.dispose(), [gradientMap])
  const propRamp = useMemo(() => createToonRamp(toonRamp), [toonRamp])
  const props = useMemo(() => buildProps(data.props, propRamp), [data.props, propRamp])
  useEffect(
    () => () => {
      props.dispose()
      propRamp.dispose()
    },
    [props, propRamp],
  )
  const standClip = data.poses.get('stand')?.clip ?? 'idle'

  const reduced = useReducedMotion()
  const invalidate = useThree((state) => state.invalidate)
  const gl = useThree((state) => state.gl)
  const get = useThree((state) => state.get)

  const [controller] = useState(
    () =>
      new SimController({
        data,
        home: scope,
        world,
        start,
        // Corrected once the look resolves and the rig loads (onResolved, onAssembled).
        metresPerRigUnit: avatarHeightM,
        walkClipS: 1,
        reducedMotion: reduced,
      }),
  )
  const placeRef = useRef<Group>(null)
  const avatarRef = useRef<AssembledAvatar | null>(null)
  const clipRef = useRef(standClip)
  const [clip, setClip] = useState(standClip)
  const animateRef = useRef(false)
  const [animate, setAnimate] = useState(false)
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  const wake = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timeRef = useRef(0)

  // A new scope starts at its start; furniture moved keeps the Sim where it is unless it now
  // stands inside something.
  const scopeRef = useRef(scope)
  useEffect(() => {
    controller.setWorld(world, scope)
    if (scopeRef.current !== scope || controller.idleOnFurniture()) {
      scopeRef.current = scope
      controller.reset(start)
    }
    invalidate()
  }, [controller, world, scope, start, invalidate])

  useEffect(() => {
    controller.setReducedMotion(reduced)
    invalidate()
  }, [controller, reduced, invalidate])

  useEffect(
    () =>
      subscribe((actionId) => {
        controller.perform(actionId)
        invalidate()
      }),
    [controller, subscribe, invalidate],
  )

  // A tap on a seat sits the Sim there; a tap on the floor walks it over.
  useEffect(() => {
    if (!tapsEnabled) return
    const canvas = gl.domElement
    const raycaster = new Raycaster()
    const plane = new Plane(new Vector3(0, 1, 0), 0)
    const hit = new Vector3()
    const ndc = new Vector2()
    return attachTapDetector(canvas, tapOptions, (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect()
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, get().camera)
      // A seat's top first (the floor point behind it would land past the sofa), then the floor.
      for (const seatHeight of [0.4, 0]) {
        plane.constant = -seatHeight
        if (raycaster.ray.intersectPlane(plane, hit) === null) continue
        const point = { x: hit.x, z: hit.z }
        const itemId = controller.itemAt(point)
        if (itemId !== null && controller.sitOn(itemId)) {
          invalidate()
          return
        }
        if (seatHeight === 0) {
          if (Math.abs(point.x) > floor.widthM / 2 || Math.abs(point.z) > floor.depthM / 2) {
            return
          }
          controller.goTo(point)
          invalidate()
        }
      }
    })
  }, [gl, get, tapsEnabled, controller, floor.widthM, floor.depthM, invalidate])

  useEffect(() => {
    const parent = gl.domElement.parentElement
    if (parent === null) return
    const bubble = createBubble(parent)
    bubbleRef.current = bubble
    return () => {
      bubble.remove()
      bubbleRef.current = null
    }
  }, [gl])

  useEffect(
    () => () => {
      if (wake.current !== null) clearTimeout(wake.current)
    },
    [],
  )

  // The poses and the walk's stride are in the rig's units: the look's height scales them.
  const onResolved = (resolved: ResolvedLook) => {
    controller.setScale((avatarHeightM * resolved.scale) / resolved.heightM)
  }
  const onAssembled = (avatar: AssembledAvatar | null, clips: readonly AnimationClip[]) => {
    avatarRef.current = avatar
    const walk = clips.find((candidate) => candidate.name === 'walk')
    if (walk !== undefined) controller.setWalkClip(walk.duration)
    invalidate()
  }

  useFrame((_, delta) => {
    const frame = controller.update(reduced ? delta : Math.min(delta, MAX_STEP_S))
    timeRef.current += delta
    const grooving =
      groove !== null && !reduced && frame.clip === groove.clip && frame.body.tilt === 0
    const group = placeRef.current
    if (group !== null) {
      const { body } = frame
      let lift = 0
      let sway = 0
      if (grooving) {
        const beat = (timeRef.current * groove.bpm) / 60
        lift = Math.abs(Math.sin(beat * Math.PI)) * groove.bobM
        sway = Math.sin(beat * Math.PI * 0.5) * ((groove.swayDeg * Math.PI) / 180)
      }
      group.position.set(body.x, body.y + lift, body.z)
      group.rotation.set(body.tilt, body.yaw + sway, 0, 'YXZ')
      // Read by the test hooks (what the Sim is doing, without timing guesses).
      group.userData.sim = { clip: frame.clip, prop: frame.prop?.id ?? null, bubble: frame.bubble }
    }
    const avatar = avatarRef.current
    if (avatar !== null) avatar.mixer.timeScale = frame.timeScale
    if (frame.clip !== clipRef.current) {
      clipRef.current = frame.clip
      setClip(frame.clip)
    }
    if (frame.active !== animateRef.current) {
      animateRef.current = frame.active
      setAnimate(frame.active)
    }
    placeProps(props, frame)
    const { camera, size } = get()
    const bubble = bubbleRef.current
    if (bubble !== null) placeBubble(bubble, avatar, frame, camera, size, data)
    if (wake.current !== null) {
      clearTimeout(wake.current)
      wake.current = null
    }
    if (frame.active || grooving) {
      invalidate()
      return
    }
    // A still pose under reduced motion: one frame when it ends.
    const wakeMs = controller.wakeInMs()
    if (wakeMs !== null) wake.current = setTimeout(() => invalidate(), wakeMs)
  })

  const memory = deviceMemoryGB()
  if (look === null || (memory !== undefined && memory < config.player.minDeviceMemoryGB)) {
    return null
  }
  return (
    <ModelsProvider config={config} tier={tier} {...(gradientMap && { gradientMap })}>
      <group ref={placeRef} name={name}>
        <group scale={avatarHeightM}>
          <LookAvatar
            fitHeight
            avatar={look}
            clip={clip}
            animate={animate}
            fadeS={reduced ? 0 : data.fadeS}
            shadows={tier === 'high'}
            onResolved={onResolved}
            onAssembled={onAssembled}
          />
        </group>
      </group>
      {[...props.meshes.values()].map((mesh) => (
        <primitive key={mesh.name} object={mesh} />
      ))}
    </ModelsProvider>
  )
}
