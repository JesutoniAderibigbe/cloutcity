'use client'

/**
 * The players inside a venue (S43), in their own lazy chunk with the look runtime:
 * - the player's Sim (the shared room Sim, src/scene/apartment/sim/SimAvatar.tsx): it walks in
 *   from the door spot, and each place action the sheet runs (src/state/placeSheet.ts
 *   `onPlaceActionDone`) is acted out here: a night in the club dances on the floor (the dance
 *   moves, S16c, fetched here and only here), a rooftop hang sits on a sofa, a flex takes a selfie. A tap on a stool or sofa sits it there, a tap on
 *   the floor walks it over. Visual only: the engine applied the action first.
 * - the real players presence puts inside (src/state/venueOccupants.ts), each with their look at
 *   a spot for what they are doing and a name tag button above them (the player card, with block,
 *   mute and report, opens from it like from every player surface). A dancing player dances the
 *   move their id picks, the same on every client.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3, type AnimationClip, type Group } from 'three'
import type { QualityTier } from '@/lib/data/schemas/config'
import { wantedSpots, type CrowdSpot } from '@/lib/world/venueCrowd'
import { log } from '@/lib/log'
import { useReducedMotion } from '@/lib/useReducedMotion'
import { onPlaceActionDone } from '@/state/placeSheet'
import { pickOccupant, type InteriorOccupant } from '@/state/venueOccupants'
import type { AssembledAvatar } from '../models/AvatarModel'
import { ModelsProvider } from '../models/runtime'
import { LookAvatar } from '../avatar/LookAvatar'
import type { ResolvedLook } from '../avatar/resolveLook'
import { apartmentConfig, toonRamp } from '../apartment/data'
import { modelsConfig } from '../apartment/modelsConfig'
import { SimAvatar } from '../apartment/sim/SimAvatar'
import { rotate, type Body } from '../apartment/sim/simController'
import { createToonRamp } from '../toonRamp'
import type { DanceMoves } from './danceMoves'
import { poseClip, venueGroove, venueInterior, venueSimData } from './data'
import { VENUE_AVATAR_NAME } from './types'

const DEG = Math.PI / 180
const HEAD = new Vector3()

/** Logged when the dance moves module cannot load: everyone keeps the fallback dance. */
const MOVES_FAILED_MESSAGE = 'venue: the dance moves could not load'

/**
 * The clip a real player plays for what they are doing (seated where their spot is a seat): a
 * dancer the move their id picks once the moves are in `available`, else a wave; at a spot for
 * their activity, the spot's pose (S43c: a treadmill runs, a counter serves); else they talk at
 * the bar or in a chat, or stand.
 */
function occupantClip(
  occupant: InteriorOccupant,
  spot: CrowdSpot,
  wanted: readonly string[],
  moves: DanceMoves | null,
  pick: (id: string, n: number) => number,
  available: ReadonlySet<string>,
): string {
  if (spot.y > 0) return 'sit'
  if (occupant.activity === 'dance') {
    const move = moves?.moves[pick(occupant.id, moves.moves.length)]
    return move !== undefined && available.has(move) ? move : 'wave'
  }
  const clip = wanted.includes(spot.activity) ? poseClip(spot.pose) : null
  if (clip !== null && available.has(clip)) return clip
  if (occupant.activity === 'bar' || occupant.activity === 'chat') return 'talk'
  return 'idle'
}

/** The dance moves, loaded once the venue's people are up (never under reduced motion). */
function useDanceMoves(
  reduced: boolean,
): { readonly moves: DanceMoves; readonly pick: (id: string, n: number) => number } | null {
  const [loaded, setLoaded] = useState<{
    readonly moves: DanceMoves
    readonly pick: (id: string, n: number) => number
  } | null>(null)
  useEffect(() => {
    if (reduced) return
    let active = true
    import('./danceMoves').then(
      (module) => {
        if (!active) return
        try {
          setLoaded({ moves: module.danceMoves(), pick: module.pickBy })
        } catch (error) {
          log.warn(MOVES_FAILED_MESSAGE, {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },
      (error: unknown) => {
        log.info(MOVES_FAILED_MESSAGE, {
          error: error instanceof Error ? error.message : String(error),
        })
      },
    )
    return () => {
      active = false
    }
  }, [reduced])
  return reduced ? null : loaded
}

function Occupant({
  placeId,
  occupant,
  spot,
  tier,
  sitContact,
  dance,
  wanted,
  bpm,
}: {
  readonly placeId: string
  readonly occupant: InteriorOccupant
  readonly spot: CrowdSpot
  readonly tier: QualityTier
  /** The room Sim's sit contact, in rig units: a seated player's hips go on the seat. */
  readonly sitContact: readonly [number, number, number]
  readonly dance: ReturnType<typeof useDanceMoves>
  /** The spot activities this player's activity goes to here (src/lib/world/venueCrowd.ts). */
  readonly wanted: readonly string[]
  /** The venue's beat: a move plays at it. */
  readonly bpm: number
}) {
  const groupRef = useRef<Group>(null)
  const [k, setK] = useState(apartmentConfig.avatarHeightM)
  const seated = spot.y > 0
  const onResolved = useCallback(
    (resolved: ResolvedLook) =>
      setK((apartmentConfig.avatarHeightM * resolved.scale) / resolved.heightM),
    [],
  )
  const [available, setAvailable] = useState<ReadonlySet<string>>(() => new Set())
  const avatarRef = useRef<AssembledAvatar | null>(null)
  const onAssembled = useCallback(
    (avatar: AssembledAvatar | null, clips: readonly AnimationClip[]) => {
      avatarRef.current = avatar
      setAvailable(new Set(clips.map((clip) => clip.name)))
    },
    [],
  )
  const clip = occupantClip(
    occupant,
    spot,
    wanted,
    dance?.moves ?? null,
    dance?.pick ?? (() => 0),
    available,
  )
  const moving = dance !== null && dance.moves.moves.includes(clip)
  useEffect(() => {
    const avatar = avatarRef.current
    if (avatar !== null)
      avatar.mixer.timeScale = moving && dance !== null ? bpm / dance.moves.bpm : 1
  }, [moving, dance, bpm, available])
  const gl = useThree((state) => state.gl)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  // The name tag: a button over the canvas (the player card opens from it), placed each frame.
  useEffect(() => {
    const parent = gl.domElement.parentElement
    if (parent === null) return
    const element = document.createElement('button')
    element.type = 'button'
    element.textContent = occupant.handle
    element.dataset.venueOccupant = occupant.id
    element.className =
      'absolute top-0 left-0 min-h-11 rounded-full glass px-3 text-sm font-bold text-fg shadow-md focus-visible:outline-2 focus-visible:outline-focus'
    const pick = () => pickOccupant(placeId, occupant.id)
    element.addEventListener('click', pick)
    parent.appendChild(element)
    buttonRef.current = element
    return () => {
      element.removeEventListener('click', pick)
      element.remove()
      buttonRef.current = null
    }
  }, [gl, occupant.handle, occupant.id, placeId])

  // A seated player's hips go on the seat, else they stand there.
  const contact = seated ? sitContact : ([0, 0, 0] as const)
  const offset = rotate([contact[0] * k, contact[1] * k, contact[2] * k], spot.headingRad, 0)
  const body: Body = {
    x: spot.x - offset[0],
    y: spot.y - offset[1],
    z: spot.z - offset[2],
    yaw: spot.headingRad,
    tilt: 0,
  }

  useFrame(({ camera, size }) => {
    const group = groupRef.current
    const button = buttonRef.current
    if (button === null || group === null) return
    HEAD.set(
      group.position.x,
      // Over the head: a seated player's head is lower than their standing height.
      group.position.y + apartmentConfig.avatarHeightM * (seated ? 0.85 : 1.08),
      group.position.z,
    )
    HEAD.project(camera)
    button.hidden = HEAD.z > 1
    button.style.transform = `translate(${((HEAD.x + 1) / 2) * size.width}px, ${((1 - HEAD.y) / 2) * size.height}px) translate(-50%, -100%)`
  })

  return (
    <group
      ref={groupRef}
      name={`venue-occupant-${occupant.id}`}
      position={[body.x, body.y, body.z]}
      rotation={[0, body.yaw, 0]}
    >
      <group scale={apartmentConfig.avatarHeightM}>
        <LookAvatar
          fitHeight
          avatar={occupant.avatar}
          clip={clip}
          animate
          shadows={tier === 'high'}
          onResolved={onResolved}
          onAssembled={onAssembled}
          {...(dance === null || occupant.activity !== 'dance'
            ? {}
            : { extraClipsFor: dance.moves.rigFor })}
        />
      </group>
    </group>
  )
}

export default function VenuePeople({
  placeId,
  interiorId,
  occupants,
  occupantSpots,
  tier,
}: {
  readonly placeId: string
  readonly interiorId: string
  readonly occupants: readonly InteriorOccupant[]
  readonly occupantSpots: readonly (CrowdSpot | null)[]
  readonly tier: QualityTier
}) {
  const interior = venueInterior(interiorId)
  const data = useMemo(() => venueSimData(interiorId), [interiorId])
  const reduced = useReducedMotion()
  const dance = useDanceMoves(reduced)
  const groove = useMemo(() => {
    const base = venueGroove(interior.mood.bpm)
    if (dance === null) return base
    const { moves } = dance
    return {
      ...base,
      moves: {
        clips: moves.moves,
        bpm: moves.bpm,
        barsPerMove: moves.barsPerMove,
        rigFor: moves.rigFor,
      },
    }
  }, [interior, dance])
  const start = useMemo((): Body => {
    const [x, , z] = interior.room.avatarAnchor.position
    return { x, y: 0, z, yaw: interior.room.avatarAnchor.rotationDeg * DEG, tilt: 0 }
  }, [interior])
  const subscribe = useCallback(
    (perform: (actionId: string) => void) =>
      onPlaceActionDone((done) => {
        if (done.placeId === placeId) perform(done.actionId)
      }),
    [placeId],
  )
  const config = useMemo(() => modelsConfig(), [])
  const gradientMap = useMemo(
    () => (config.shading === 'toon' ? createToonRamp(toonRamp) : undefined),
    [config.shading],
  )
  useEffect(() => () => gradientMap?.dispose(), [gradientMap])

  return (
    <>
      <SimAvatar
        scope={interiorId}
        data={data}
        world={interior.world}
        start={start}
        subscribe={subscribe}
        tapsEnabled
        floor={interior.room.room}
        tier={tier}
        toonRamp={toonRamp}
        avatarHeightM={apartmentConfig.avatarHeightM}
        name={VENUE_AVATAR_NAME}
        groove={reduced ? null : groove}
      />
      {occupants.length === 0 ? null : (
        <ModelsProvider config={config} tier={tier} {...(gradientMap && { gradientMap })}>
          {occupants.map((occupant, i) => {
            const spot = occupantSpots[i]
            return spot == null ? null : (
              <Occupant
                key={occupant.id}
                placeId={placeId}
                occupant={occupant}
                spot={spot}
                tier={tier}
                sitContact={data.poses.get('sit')?.contact ?? [0, 0, 0]}
                dance={dance}
                wanted={wantedSpots(occupant.activity, interior.players)}
                bpm={interior.mood.bpm}
              />
            )
          })}
        </ModelsProvider>
      )}
    </>
  )
}
