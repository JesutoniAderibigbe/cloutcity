'use client'

/**
 * The player's Sim in their apartment (S16a, S40c): their look (src/state/playerLook.ts) as a
 * hand-made avatar that lives in the room like a Sim. It stands at the home's `avatarAnchor`;
 * a home action done in the Home panel (src/state/roomActivity.ts) sends it to the bed to sleep
 * or nap, to the fridge and stove to cook and to a seat to eat; a tap on a sofa, chair or stool
 * sits it there, and a tap on the floor gets it up and walks it over (sim/simController.ts).
 * Where each piece is used comes from data (data/homes/interactions.json), so new furniture
 * needs no code; a home without the furniture uses its fallback spot or does it standing.
 *
 * Visual only: the engine has applied the action (clock, stats) before the Sim moves.
 *
 * It is its own lazy chunk, loaded after the room is up, with the model runtime and the look
 * runtime, so the apartment chunk does not grow. On every tier it fits perf.json
 * `apartment.avatarReserve`; on a device reporting little memory nothing is drawn, as on the
 * map's capsule rule. It draws frames only while it moves or animates (or the camera does):
 * idle, the room renders nothing. Under reduced motion every move is a cut to the pose.
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
import type { HomeIdLiteral } from '@/lib/data/homes'
import type { QualityTier } from '@/lib/data/schemas/config'
import { copy, isCopyKey } from '@/lib/copy'
import { useReducedMotion } from '@/lib/useReducedMotion'
import { usePlayerLook } from '@/state/playerLook'
import { onRoomActivity } from '@/state/roomActivity'
import { ModelsProvider } from '../models/runtime'
import type { AssembledAvatar } from '../models/AvatarModel'
import { LookAvatar } from '../avatar/LookAvatar'
import type { ResolvedLook } from '../avatar/resolveLook'
import { attachTapDetector } from '../pins/tap'
import { createToonRamp } from '../toonRamp'
import { modelsConfig } from './modelsConfig'
import { tapOptions, type RoomInterior } from './data'
import { buildProps, type SimProps } from './sim/props'
import { SimController, type Body, type SimFrame } from './sim/simController'
import { simData } from './sim/simData'
import { buildWorld, type SimWorld } from './sim/simWorld'
import { ROOM_AVATAR_NAME, type ApartmentPlacement } from './types'

const DEG = Math.PI / 180
/** Longest step the Sim takes in one frame: a frame after a long idle must not jump it. */
const MAX_STEP_S = 0.1

function deviceMemoryGB(): number | undefined {
  if (typeof navigator === 'undefined') return undefined
  const memory: unknown = (navigator as Navigator & { deviceMemory?: unknown }).deviceMemory
  return typeof memory === 'number' ? memory : undefined
}

const decorModels: Readonly<Record<string, { readonly model: string } | undefined>> =
  modelsConfig().decor

function worldOf(interior: RoomInterior, placed: Readonly<Record<string, ApartmentPlacement>>) {
  return buildWorld({
    grid: interior.grid,
    fixtures: interior.fixtures.map((fixture) =>
      fixture.kind === 'model'
        ? { kind: 'model', model: fixture.model, slotId: fixture.slotId, turn: fixture.turn }
        : { kind: 'counter', slotId: fixture.slotId, turn: fixture.turn },
    ),
    placed: Object.values(placed),
    modelOf: (itemId) => decorModels[itemId]?.model ?? null,
    walkable: simData.walkable,
  })
}

function anchorBody(interior: RoomInterior): Body {
  const [x, , z] = interior.avatarAnchor.position
  return { x, y: 0, z, yaw: interior.avatarAnchor.rotationDeg * DEG, tilt: 0 }
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

const STAND_CLIP = simData.poses.get('stand')?.clip ?? 'idle'
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
 * Puts the frame's bubble ("Zzz") over the Sim's head on screen, or hides it. Its copy is in the
 * `home` namespace, which the Home panel has loaded whenever the room shows (the room shows only
 * with it), so this chunk does not carry a second copy of it; a key not loaded shows no bubble.
 */
function placeBubble(
  bubble: HTMLDivElement,
  avatar: AssembledAvatar | null,
  frame: SimFrame,
  camera: Camera,
  size: { readonly width: number; readonly height: number },
): void {
  const key = frame.bubble
  const joint = avatar?.root.getObjectByName(simData.bubble.joint)
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
  HEAD.y += simData.bubble.aboveHeadM
  HEAD.project(camera)
  bubble.hidden = HEAD.z > 1
  bubble.style.transform = `translate(${((HEAD.x + 1) / 2) * size.width}px, ${((1 - HEAD.y) / 2) * size.height}px) translate(-50%, -100%)`
}

export default function RoomAvatar({
  home,
  interior,
  placed,
  gridShown,
  tier,
  toonRamp,
  avatarHeightM,
}: {
  readonly home: HomeIdLiteral
  readonly interior: RoomInterior
  /** Every item drawn now: the Sim walks around them and uses them. */
  readonly placed: Readonly<Record<string, ApartmentPlacement>>
  /** Buy mode's grid is up: taps place furniture, not the Sim. */
  readonly gridShown: boolean
  readonly tier: QualityTier
  readonly toonRamp: readonly number[]
  /** How tall the avatar stands in the room (scene.json `apartment.avatarHeightM`). */
  readonly avatarHeightM: number
}) {
  const look = usePlayerLook()
  const config = useMemo(() => modelsConfig(), [])
  const gradientMap = useMemo(
    () => (config.shading === 'toon' ? createToonRamp(toonRamp) : undefined),
    [config.shading, toonRamp],
  )
  useEffect(() => () => gradientMap?.dispose(), [gradientMap])
  const propRamp = useMemo(() => createToonRamp(toonRamp), [toonRamp])
  const props = useMemo(() => buildProps(simData.props, propRamp), [propRamp])
  useEffect(
    () => () => {
      props.dispose()
      propRamp.dispose()
    },
    [props, propRamp],
  )

  const reduced = useReducedMotion()
  const invalidate = useThree((state) => state.invalidate)
  const gl = useThree((state) => state.gl)
  const get = useThree((state) => state.get)

  const world: SimWorld = useMemo(() => worldOf(interior, placed), [interior, placed])
  const [controller] = useState(
    () =>
      new SimController({
        data: simData,
        home,
        world,
        start: anchorBody(interior),
        // Corrected once the look resolves and the rig loads (onResolved, onAssembled).
        metresPerRigUnit: avatarHeightM,
        walkClipS: 1,
        reducedMotion: reduced,
      }),
  )
  const placeRef = useRef<Group>(null)
  const avatarRef = useRef<AssembledAvatar | null>(null)
  const clipRef = useRef(STAND_CLIP)
  const [clip, setClip] = useState(STAND_CLIP)
  const animateRef = useRef(false)
  const [animate, setAnimate] = useState(false)
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  const wake = useRef<ReturnType<typeof setTimeout> | null>(null)

  // A new home starts at its anchor; furniture moved keeps the Sim where it is unless it now
  // stands inside something.
  const homeRef = useRef(home)
  useEffect(() => {
    controller.setWorld(world, home)
    if (homeRef.current !== home || controller.idleOnFurniture()) {
      homeRef.current = home
      controller.reset(anchorBody(interior))
    }
    invalidate()
  }, [controller, world, home, interior, invalidate])

  useEffect(() => {
    controller.setReducedMotion(reduced)
    invalidate()
  }, [controller, reduced, invalidate])

  useEffect(
    () =>
      onRoomActivity((actionId) => {
        controller.perform(actionId)
        invalidate()
      }),
    [controller, invalidate],
  )

  // A tap on a seat sits the Sim there; a tap on the floor walks it over. Buy mode's taps are
  // the grid's.
  useEffect(() => {
    if (gridShown) return
    const canvas = gl.domElement
    const raycaster = new Raycaster()
    const floor = new Plane(new Vector3(0, 1, 0), 0)
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
        floor.constant = -seatHeight
        if (raycaster.ray.intersectPlane(floor, hit) === null) continue
        const point = { x: hit.x, z: hit.z }
        const itemId = controller.itemAt(point)
        if (itemId !== null && controller.sitOn(itemId)) {
          invalidate()
          return
        }
        if (seatHeight === 0) {
          if (
            Math.abs(point.x) > interior.room.widthM / 2 ||
            Math.abs(point.z) > interior.room.depthM / 2
          ) {
            return
          }
          controller.goTo(point)
          invalidate()
        }
      }
    })
  }, [gl, get, gridShown, controller, interior, invalidate])

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
    const group = placeRef.current
    if (group !== null) {
      const { body } = frame
      group.position.set(body.x, body.y, body.z)
      group.rotation.set(body.tilt, body.yaw, 0, 'YXZ')
      // Read by the apartment test hook (what the Sim is doing, without timing guesses).
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
    if (bubble !== null) placeBubble(bubble, avatar, frame, camera, size)
    if (wake.current !== null) {
      clearTimeout(wake.current)
      wake.current = null
    }
    if (frame.active) {
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
      <group ref={placeRef} name={ROOM_AVATAR_NAME}>
        <group scale={avatarHeightM}>
          <LookAvatar
            fitHeight
            avatar={look}
            clip={clip}
            animate={animate}
            fadeS={reduced ? 0 : simData.fadeS}
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
