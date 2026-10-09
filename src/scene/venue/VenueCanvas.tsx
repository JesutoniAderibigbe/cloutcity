'use client'

/**
 * A venue's inside view (S43; React.lazy from src/components/places/VenueInterior.tsx, its own
 * chunk `cc-feature:venue-interior`, left out of the precache, PERF-7). It draws in the scene's
 * room slot behind the place sheet, as the apartment does behind the Home panel, and reuses the
 * apartment's scene stack: the room shell, wall cut-away and orbit camera (RoomOrbit: drag,
 * pinch, reset), the catalog furniture models, the room Sim (the player acts out each place action
 * the sheet runs: dancing on the floor, sitting in a booth) and the look avatars.
 *
 * On top of that it adds the venue's own pieces (buildVenue.ts: the bar, DJ booth, glowing dance
 * floor, party lights, string lights, skyline), its locals (crowdLayer.ts, by the clock, busier on
 * busy nights) and the real players presence puts inside (src/state/venueOccupants.ts).
 *
 * It is alive while it shows (the lights run on the music's beat), like the map (DEC-52); under
 * reduced motion it renders on demand and nothing pulses or swings. Tiers: the dpr cap and
 * shadows of perf.json, the caps and counts of data/config/interiors.json.
 */
import { lazy, Suspense, use, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { PCFShadowMap, type IUniform } from 'three'
import type { QualityTier } from '@/lib/data/schemas/config'
import { mixHexLinear, lightingAt as cityLightingAt } from '@/lib/dayNight/lightingAt'
import { useReducedMotion } from '@/lib/useReducedMotion'
import { placeOccupants, planCrowd, type CrowdMember } from '@/lib/world/venueCrowd'
import { setSceneFocus } from '@/state/sceneFocus'
import { useInteriorOccupants } from '@/state/venueOccupants'
import { buildApartment, type ApartmentObjects, type PlacedFill } from '../apartment/buildApartment'
import { roomBounds } from '../apartment/buildRoom'
import {
  apartmentConfig,
  dayNightConfig,
  dayNightModel,
  roomPalette,
  tokenHex,
  toonRamp,
} from '../apartment/data'
import { boundingSphere } from '../apartment/fit'
import { lightingAt } from '../apartment/lighting'
import { NEAR_M, RoomOrbit, type FreeArea, type RoomOrbitHandle } from '../apartment/RoomOrbit'
import { useDecorModels } from '../apartment/useDecorModels'
import { createPlaceholderVisuals, type ApartmentVisuals } from '../apartment/visuals'
import { createToonRamp } from '../toonRamp'
import { buildVenue, type VenueObjects } from './buildVenue'
import {
  crowdConfig,
  lightsConfig,
  loadVenueInterior,
  occupantsMax,
  venueBudget,
  venueInterior,
  type VenueInterior,
} from './data'
import type { VenueViewProps } from './types'
import { VenueTestHook } from './venueTestHook'

// The player's Sim and the real players' avatars load with the look runtime; the locals with
// the kit bakers: each in its own chunk, after the interior is up.
const VenuePeople = lazy(() => import('./VenuePeople'))
const VenueCrowd = lazy(() => import('./VenueCrowd'))

const GL = {
  antialias: true,
  // Transparent: the interior stands on its own backdrop (the theme's, or the sky's).
  alpha: true,
  stencil: false,
  powerPreference: 'high-performance',
} as const

/** The furniture models' lamps glow at night (one interior shows at a time). */
const venueGlow: IUniform<number> = { value: 0 }

/** The room's lights at `minute`: the apartment's, with the venue's mood while it is open. */
function useVenueLighting(interior: VenueInterior, minute: number, open: boolean) {
  const step = useReducedMotion()
  const base = lightingAt(minute, {
    model: dayNightModel,
    room: dayNightConfig.room,
    lights: apartmentConfig.lights,
    palette: roomPalette,
    step,
  })
  const { mood } = interior
  return {
    glow: base.glow,
    ambient: {
      color: open ? mixHexLinear(base.ambient.color, mood.tint, mood.openMix) : base.ambient.color,
      intensity: base.ambient.intensity * (open ? mood.openAmbientScale : mood.closedAmbientScale),
    },
    sun: {
      ...base.sun,
      intensity: base.sun.intensity * (open ? mood.openSunScale : 1),
    },
  }
}

function VenueLights({
  interior,
  minute,
  open,
  tier,
}: {
  readonly interior: VenueInterior
  readonly minute: number
  readonly open: boolean
  readonly tier: QualityTier
}) {
  const lighting = useVenueLighting(interior, minute, open)
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => {
    venueGlow.value = lighting.glow
    invalidate()
  }, [lighting.glow, invalidate])
  const bounds = roomBounds(interior.room, apartmentConfig)
  const sphere = boundingSphere(bounds.min, bounds.max)
  const { direction } = lighting.sun
  const length = Math.hypot(direction.x, direction.y, direction.z)
  const reach = sphere.radius * 2
  const at = (axis: number) => (axis / length) * reach
  const size = apartmentConfig.lights.shadowMapSizePx
  return (
    <>
      <ambientLight color={lighting.ambient.color} intensity={lighting.ambient.intensity} />
      <directionalLight
        color={lighting.sun.color}
        intensity={lighting.sun.intensity}
        position={[at(direction.x), at(direction.y), at(direction.z)]}
        castShadow={venueBudget(tier).shadows === 'pcf-directional'}
        shadow-mapSize={[size, size]}
        shadow-camera-left={-sphere.radius}
        shadow-camera-right={sphere.radius}
        shadow-camera-top={sphere.radius}
        shadow-camera-bottom={-sphere.radius}
        shadow-camera-near={0.1}
        shadow-camera-far={reach * 2}
      />
    </>
  )
}

/** The apartment's visuals with each decor id drawn as its catalog item. */
function decorVisuals(
  base: ApartmentVisuals,
  itemOf: ReadonlyMap<string, string>,
): ApartmentVisuals {
  return {
    buildRoom: (layout, tier, finishes) => base.buildRoom(layout, tier, finishes),
    buildDecor: (decorId, color) => base.buildDecor(itemOf.get(decorId) ?? decorId, color),
    buildFixture: (modelId) => base.buildFixture(modelId),
    dispose: () => base.dispose(),
  }
}

interface RoomProps {
  readonly interior: VenueInterior
  readonly tier: QualityTier
  readonly open: boolean
  readonly glow: number
  readonly objectsRef: RefObject<ApartmentObjects | null>
  readonly piecesRef: RefObject<VenueObjects | null>
  readonly readyRef: RefObject<boolean>
}

function VenueRoom({ interior, tier, open, glow, objectsRef, piecesRef, readyRef }: RoomProps) {
  const invalidate = useThree((state) => state.invalidate)
  const decor = useDecorModels(tier, venueGlow)
  const still = useReducedMotion()
  const built = useMemo(() => {
    const placeholder = createPlaceholderVisuals(apartmentConfig, roomPalette, toonRamp)
    const visuals = decorVisuals(
      decor === null ? placeholder : decor.visuals(placeholder),
      interior.itemOf,
    )
    const objects = buildApartment(interior.room, apartmentConfig, roomPalette, visuals, {
      wall: interior.room.shell.wallPaint,
      floor: interior.room.shell.floorFinish,
    })
    const gradientMap = createToonRamp(toonRamp)
    const pieces = buildVenue(interior, gradientMap, lightsConfig(tier).beams, lightsConfig(tier))
    objects.group.add(pieces.group)
    return {
      objects,
      pieces,
      dispose() {
        objects.dispose()
        pieces.dispose()
        gradientMap.dispose()
        visuals.dispose()
      },
    }
  }, [interior, decor, tier])

  useEffect(() => {
    objectsRef.current = built.objects
    piecesRef.current = built.pieces
    return () => {
      objectsRef.current = null
      piecesRef.current = null
      built.dispose()
    }
  }, [built, objectsRef, piecesRef])

  const fills = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(interior.placed).map(([id, entry]): [string, PlacedFill] => [
          id,
          { ...entry, color: tokenHex(entry.token) },
        ]),
      ),
    [interior],
  )
  useEffect(() => {
    built.objects.setPlaced(fills)
    built.objects.setTier(tier)
    invalidate()
  }, [built, fills, tier, invalidate])

  const timeRef = useRef(0)
  useFrame((_, delta) => {
    timeRef.current += delta
    const changed = built.pieces.update({ timeS: timeRef.current, open, glow, still })
    if (changed && still) invalidate()
    readyRef.current = true
  })

  return <primitive object={built.objects.group} />
}

/** The backdrop behind the canvas: the theme's (tinted while open), or the sky of the clock. */
function useBackdrop(interior: VenueInterior, minute: number, open: boolean) {
  const step = useReducedMotion()
  if (interior.backdrop.kind === 'sky') {
    const city = cityLightingAt(minute, dayNightModel, { step })
    return {
      className: '',
      style: {
        background: `linear-gradient(180deg, ${city.colors.sky} 0%, ${city.colors.fog} 100%)`,
      },
    }
  }
  if (open && interior.backdrop.tint !== null) {
    return {
      className: '',
      style: {
        background: `radial-gradient(ellipse 70% 60% at 50% 42%, ${interior.mood.tint} 0%, ${interior.backdrop.tint} 72%)`,
      },
    }
  }
  return { className: 'apartment-backdrop', style: undefined }
}

/**
 * Waits for the interior's own data chunk (S43b: one small lazy chunk per interior) under the
 * place sheet's Suspense; a failed fetch reaches VenueInterior's boundary (the sheet still works).
 */
export default function VenueCanvas(props: VenueViewProps) {
  use(loadVenueInterior(props.interiorId))
  return <VenueScene {...props} />
}

function VenueScene({
  placeId,
  interiorId,
  label,
  resetLabel,
  exitText,
  exitLabel,
  minute,
  open,
  tier: deviceTier,
  onExit,
}: VenueViewProps) {
  // The e2e hook can switch tiers to measure each one's budget; the device's tier otherwise.
  const [tierOverride, setTierOverride] = useState<QualityTier | null>(null)
  const tier = tierOverride ?? deviceTier
  const budget = venueBudget(tier)
  const interior = venueInterior(interiorId)
  const reduced = useReducedMotion()
  const objectsRef = useRef<ApartmentObjects | null>(null)
  const piecesRef = useRef<VenueObjects | null>(null)
  const readyRef = useRef(false)
  const orbitRef = useRef<RoomOrbitHandle | null>(null)
  const [area, setArea] = useState<FreeArea | null>(null)
  const [turned, setTurned] = useState(false)
  const lighting = useVenueLighting(interior, minute, open)
  const backdrop = useBackdrop(interior, minute, open)

  // While the interior shows, the city draws no frames and is hidden (as for the apartment).
  useEffect(() => {
    setSceneFocus('room')
    return () => setSceneFocus('city')
  }, [])

  // Real players first take the spots for what they are doing; the locals fill the rest.
  const occupants = useInteriorOccupants(placeId).slice(0, occupantsMax(tier))
  const activities = occupants.map((occupant) => occupant.activity).join('|')
  const occupantSpots = useMemo(
    () =>
      placeOccupants(
        interior.crowdSpots,
        activities === '' ? [] : activities.split('|'),
        interior.players,
      ),
    [interior, activities],
  )
  // The crowd changes with the hour, not every minute.
  const hourKey = Math.floor(minute / 60)
  const crowd = useMemo((): CrowdMember[] => {
    const config = crowdConfig(tier, interiorId)
    const taken = new Set(occupantSpots.flatMap((spot) => (spot === null ? [] : [spot.id])))
    return planCrowd({
      spots: interior.crowdSpots,
      hours: interior.crowd.hours,
      busyDays: interior.crowd.busyDays,
      quietShare: interior.crowd.quietShare,
      max: config.max,
      poses: config.poses,
      bodies: config.bodies,
      minute: hourKey * 60,
      minutesPerDay: 24 * 60,
      daysPerWeek: 7,
      open,
      seed: placeId,
      taken,
      jitterM: config.jitterM,
      headingJitterRad: config.headingJitterRad,
      heightM: config.heightM,
      palette: config.palette,
    })
  }, [tier, interior, interiorId, occupantSpots, hourKey, open, placeId])

  return (
    <div
      data-cc-feature="cc-feature:venue-interior"
      data-venue-interior={interiorId}
      data-venue-open={open ? '' : undefined}
      className={`absolute inset-0 ${backdrop.className}`}
      style={backdrop.style}
    >
      <Canvas
        frameloop={reduced ? 'demand' : 'always'}
        dpr={[1, budget.dprCap]}
        flat
        shadows={{ enabled: budget.shadows === 'pcf-directional', type: PCFShadowMap }}
        gl={GL}
        camera={{ fov: interior.room.camera.fovDeg, near: NEAR_M, far: 100 }}
        role="img"
        aria-label={label}
      >
        <VenueLights interior={interior} minute={minute} open={open} tier={tier} />
        <RoomOrbit
          interior={interior.room}
          objectsRef={objectsRef}
          handleRef={orbitRef}
          onArea={setArea}
          onTurned={setTurned}
        />
        <VenueRoom
          interior={interior}
          tier={tier}
          open={open}
          glow={lighting.glow}
          objectsRef={objectsRef}
          piecesRef={piecesRef}
          readyRef={readyRef}
        />
        <Suspense fallback={null}>
          <VenuePeople
            placeId={placeId}
            interiorId={interiorId}
            occupants={occupants}
            occupantSpots={occupantSpots}
            tier={tier}
          />
        </Suspense>
        <Suspense fallback={null}>
          <VenueCrowd interiorId={interiorId} members={crowd} tier={tier} bpm={interior.mood.bpm} />
        </Suspense>
        <VenueTestHook
          placeId={placeId}
          interiorId={interiorId}
          tier={tier}
          open={open}
          crowd={crowd}
          setTier={setTierOverride}
          piecesRef={piecesRef}
          readyRef={readyRef}
        />
      </Canvas>
      {area === null ? null : (
        <div
          className="pointer-events-none absolute flex gap-2"
          style={{ left: area.left + 8, top: area.top + 8, width: area.width - 16 }}
        >
          <button
            type="button"
            data-venue-exit=""
            onClick={onExit}
            aria-label={exitLabel}
            className="pointer-events-auto flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full glass px-3 text-sm font-semibold whitespace-nowrap text-fg shadow-md focus-visible:outline-2 focus-visible:outline-focus"
          >
            <span aria-hidden="true">←</span>
            {exitText}
          </button>
          {turned ? (
            <button
              type="button"
              data-venue-reset=""
              onClick={() => orbitRef.current?.reset()}
              className="pointer-events-auto ml-auto flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full glass px-3 text-sm font-semibold whitespace-nowrap text-fg shadow-md focus-visible:outline-2 focus-visible:outline-focus"
            >
              <span aria-hidden="true">⟲</span>
              {resetLabel}
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}
