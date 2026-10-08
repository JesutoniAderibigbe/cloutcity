'use client'

/**
 * The apartment's 3D chunk (S16, S40; loaded with next/dynamic, ssr: false, from ApartmentMount):
 * the player's furnished room as a low-poly cutaway with their decor, buy mode's grid, lighting
 * that follows the clock and per-tier shadows. Renders on demand only, so an idle room draws zero
 * frames.
 *
 * - A tap (the map's tap rule, src/scene/pins/tap.ts) reports the floor or wall cell under it
 *   (`cellAt`); the Home panel decides what it means. A cell is a metre across, well over 44 px
 *   at every framing. Every 3D action has the panel's DOM and keyboard path too (A11Y-3).
 * - RoomOrbit frames the room large and centred in the screen area the HUD, tab bar and Home
 *   panel leave free (S04k, S40), on a theme-following backdrop instead of a black void, and lets
 *   the player turn, tilt and zoom it with a finger, a pinch, the mouse or the wheel (S40b). A
 *   "Reset view" button shows in the free area's corner while the view is turned.
 * - Tiers (perf.json): low draws no shadows, mid draws blob shadows, high one directional
 *   PCFShadowMap (the object form: R3F's `shadows` boolean means PCFSoft, deprecated in r182).
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { PCFShadowMap, type IUniform } from 'three'
import type { QualityTier } from '@/lib/data/schemas/config'
import { log } from '@/lib/log'
import { attachTapDetector } from '../pins/tap'
import { ApartmentTestHook } from './apartmentTestHook'
import { buildApartment, type ApartmentObjects, type PlacedFill } from './buildApartment'
import { roomBounds } from './buildRoom'
import {
  apartmentConfig,
  dayNightConfig,
  dayNightModel,
  roomInterior,
  roomPalette,
  tapOptions,
  tierBudget,
  tokenHex,
  toonRamp,
  type RoomInterior,
} from './data'
import { boundingSphere, type Sphere } from './fit'
import { lightingAt } from './lighting'
import type { DecorModels } from './decorModels'
import { useReducedMotion } from '@/lib/useReducedMotion'
import { NEAR_M, RoomOrbit, type FreeArea, type RoomOrbitHandle } from './RoomOrbit'
import { createPlaceholderVisuals } from './visuals'
import type { ApartmentViewProps } from './types'

// The player's Sim (S16a, S40c) loads in its own chunk with the model and look runtimes.
const RoomAvatar = lazy(() => import('./RoomAvatar'))

const GL = {
  antialias: true,
  // Transparent: the room stands on the page's own backdrop (globals.css `.apartment-backdrop`),
  // which follows the UI theme, instead of a flat black clear colour.
  alpha: true,
  stencil: false,
  powerPreference: 'high-performance',
} as const

/**
 * The lamps' night glow (0 by day, 1 at night), shared by the decor models' material. One room
 * shows at a time, so one uniform serves it; RoomLights writes it from the clock.
 */
const roomGlow: IUniform<number> = { value: 0 }

function roomSphere(interior: RoomInterior): Sphere {
  const bounds = roomBounds(interior, apartmentConfig)
  return boundingSphere(bounds.min, bounds.max)
}

function RoomLights({
  interior,
  minute,
  tier,
}: {
  readonly interior: RoomInterior
  readonly minute: number
  readonly tier: QualityTier
}) {
  const step = useReducedMotion()
  const lighting = lightingAt(minute, {
    model: dayNightModel,
    room: dayNightConfig.room,
    lights: apartmentConfig.lights,
    palette: roomPalette,
    step,
  })
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => {
    roomGlow.value = lighting.glow
    invalidate()
  }, [lighting.glow, invalidate])
  const sphere = roomSphere(interior)
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
        castShadow={tierBudget(tier).shadows === 'pcf-directional'}
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

interface RoomProps extends Pick<
  ApartmentViewProps,
  'placed' | 'cells' | 'finishes' | 'onCellTap'
> {
  readonly interior: RoomInterior
  readonly tier: QualityTier
  readonly objectsRef: RefObject<ApartmentObjects | null>
  readonly readyRef: RefObject<boolean>
}

/**
 * The decor models at `tier`, loaded in their own lazy chunk (decorModels.ts) after the room is
 * up; null until then, and for good if they fail (the stand-ins stay: an expected condition, e.g.
 * offline, so it logs at info).
 */
function useDecorModels(tier: QualityTier): DecorModels | null {
  const [decor, setDecor] = useState<{ tier: QualityTier; models: DecorModels } | null>(null)
  useEffect(() => {
    let active = true
    let loaded: DecorModels | null = null
    import('./decorModels')
      .then((module) => module.loadDecorModels(tier, roomGlow))
      .then(
        (models) => {
          if (!active) {
            models.dispose()
            return
          }
          loaded = models
          setDecor({ tier, models })
        },
        (error: unknown) => {
          log.info('apartment decor models failed to load', {
            error: error instanceof Error ? error.message : String(error),
          })
        },
      )
    return () => {
      active = false
      loaded?.dispose()
    }
  }, [tier])
  return decor !== null && decor.tier === tier ? decor.models : null
}

function Room({
  interior,
  placed,
  cells,
  finishes,
  onCellTap,
  tier,
  objectsRef,
  readyRef,
}: RoomProps) {
  const gl = useThree((state) => state.gl)
  const get = useThree((state) => state.get)
  const invalidate = useThree((state) => state.invalidate)
  const decor = useDecorModels(tier)
  const built = useMemo(() => {
    // The code-built stand-ins draw at once; the hand-made decor models (S04h) take over the
    // items scene.json `models.decor` maps once they have loaded.
    const placeholder = createPlaceholderVisuals(apartmentConfig, roomPalette, toonRamp)
    const visuals = decor === null ? placeholder : decor.visuals(placeholder)
    const objects = buildApartment(
      interior,
      apartmentConfig,
      roomPalette,
      visuals,
      // Built with the home's originals; the effect below puts the shown finishes on at once.
      { wall: interior.shell.wallPaint, floor: interior.shell.floorFinish },
    )
    return {
      ...objects,
      dispose() {
        objects.dispose()
        visuals.dispose()
      },
    }
  }, [interior, decor])
  const onTap = useRef(onCellTap)

  useEffect(() => {
    onTap.current = onCellTap
  }, [onCellTap])

  useEffect(() => {
    objectsRef.current = built
    return () => {
      objectsRef.current = null
      built.dispose()
    }
  }, [built, objectsRef])

  const fills = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(placed).map(([itemId, entry]): [string, PlacedFill] => [
          itemId,
          { ...entry, color: tokenHex(entry.token) },
        ]),
      ),
    [placed],
  )
  useEffect(() => {
    built.setPlaced(fills)
    invalidate()
  }, [built, fills, invalidate])
  useEffect(() => {
    built.setCells(cells)
    invalidate()
  }, [built, cells, invalidate])
  useEffect(() => {
    built.setFinishes(finishes)
    invalidate()
  }, [built, finishes, invalidate])
  useEffect(() => {
    built.setTier(tier)
    invalidate()
  }, [built, tier, invalidate])

  useEffect(() => {
    const canvas = gl.domElement
    return attachTapDetector(canvas, tapOptions, (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect()
      const slotId = built.cellAt(
        get().camera,
        clientX - rect.left,
        clientY - rect.top,
        rect.width,
        rect.height,
      )
      if (slotId !== null) onTap.current(slotId)
    })
  }, [gl, get, built])

  useFrame(() => {
    readyRef.current = true
  })

  return <primitive object={built.group} />
}

export default function ApartmentCanvas({
  home,
  placed,
  cells,
  finishes,
  label,
  resetLabel,
  minute,
  tier: deviceTier,
  onCellTap,
}: ApartmentViewProps) {
  // The e2e hook can switch tiers to measure each one's budget; the device's tier otherwise.
  const [tierOverride, setTierOverride] = useState<QualityTier | null>(null)
  const tier = tierOverride ?? deviceTier
  const budget = tierBudget(tier)
  const interior = roomInterior(home)
  const objectsRef = useRef<ApartmentObjects | null>(null)
  const readyRef = useRef(false)
  const orbitRef = useRef<RoomOrbitHandle | null>(null)
  const [area, setArea] = useState<FreeArea | null>(null)
  const [turned, setTurned] = useState(false)

  return (
    <div
      data-cc-feature="cc-feature:apartment-scene"
      data-apartment-home={home}
      className="apartment-backdrop absolute inset-0"
    >
      <Canvas
        frameloop="demand"
        dpr={[1, budget.dprCap]}
        flat
        // R3F applies a changed input again (compared shallowly), so a tier switch toggles the
        // shadow map; the light's castShadow changes with it, which recompiles the materials.
        shadows={{ enabled: budget.shadows === 'pcf-directional', type: PCFShadowMap }}
        gl={GL}
        camera={{ fov: interior.camera.fovDeg, near: NEAR_M, far: 100 }}
        role="img"
        aria-label={label}
      >
        <RoomLights interior={interior} minute={minute} tier={tier} />
        <RoomOrbit
          interior={interior}
          objectsRef={objectsRef}
          handleRef={orbitRef}
          onArea={setArea}
          onTurned={setTurned}
        />
        <Room
          interior={interior}
          placed={placed}
          cells={cells}
          finishes={finishes}
          onCellTap={onCellTap}
          tier={tier}
          objectsRef={objectsRef}
          readyRef={readyRef}
        />
        <Suspense fallback={null}>
          <RoomAvatar
            home={home}
            interior={interior}
            placed={placed}
            // Only buy mode's grid takes taps from the Sim: a selected item's outline does not.
            gridShown={cells !== null && Object.values(cells).some((state) => state !== 'selected')}
            tier={tier}
            toonRamp={toonRamp}
            avatarHeightM={apartmentConfig.avatarHeightM}
          />
        </Suspense>
        <ApartmentTestHook
          home={home}
          tier={tier}
          placed={placed}
          setTier={setTierOverride}
          objectsRef={objectsRef}
          readyRef={readyRef}
        />
      </Canvas>
      {turned && area !== null ? (
        <button
          type="button"
          data-apartment-reset=""
          onClick={() => orbitRef.current?.reset()}
          className="absolute flex min-h-11 min-w-11 items-center whitespace-nowrap justify-center gap-1 rounded-full glass px-3 text-sm font-semibold text-fg shadow-md focus-visible:outline-2 focus-visible:outline-focus"
          style={{ left: area.left + area.width - 8, top: area.top + 8, translate: '-100% 0' }}
        >
          <span aria-hidden="true">⟲</span>
          {resetLabel}
        </button>
      ) : null}
    </div>
  )
}
