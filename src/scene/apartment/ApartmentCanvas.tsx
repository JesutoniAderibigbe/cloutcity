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
 * - The camera keeps the home's data angle; RoomCamera frames the room large and centred in the
 *   screen area the HUD, tab bar and Home panel leave free (S04k, S40), on a theme-following
 *   backdrop instead of a black void.
 * - Tiers (perf.json): low draws no shadows, mid draws blob shadows, high one directional
 *   PCFShadowMap (the object form: R3F's `shadows` boolean means PCFSoft, deprecated in r182).
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { PCFShadowMap, PerspectiveCamera, Vector3, type IUniform } from 'three'
import type { QualityTier } from '@/lib/data/schemas/config'
import { log } from '@/lib/log'
import { attachTapDetector } from '../pins/tap'
import { FREE_SCENE_ROW_SELECTOR } from '../types'
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
import {
  boundingSphere,
  boxCorners,
  cameraPosition,
  fitDistance,
  tightDistance,
  type Sphere,
} from './fit'
import { lightingAt } from './lighting'
import type { DecorModels } from './decorModels'
import { useReducedMotion } from '@/lib/useReducedMotion'
import { createPlaceholderVisuals } from './visuals'
import type { ApartmentViewProps } from './types'

// The player's avatar (S16a) loads in its own chunk with the model and look runtimes.
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

/** Near and far planes around the fitted room, so depth precision is spent on the room. */
const NEAR_M = 0.05

function roomSphere(interior: RoomInterior): Sphere {
  const bounds = roomBounds(interior, apartmentConfig)
  return boundingSphere(bounds.min, bounds.max)
}

/** Zones of the overlay (src/components/overlay/OverlayLayout.tsx) the framing works around. */
const TOAST_ZONE_SELECTOR = '[data-overlay-zone="toast"]'
const SHEET_ZONE_SELECTOR = '[data-overlay-zone="sheet"]'
const TABS_ZONE_SELECTOR = '[data-overlay-zone="tabs"]'

/** The screen area the room may fill, in CSS pixels from the canvas's top left. */
interface FreeArea {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/**
 * The area between the HUD and the bottom zones: the free scene row plus the toast zone (empty
 * nearly always, only ever a short toast over the room's top). On a wide screen the Home panel
 * docks beside the room (globals.css `cc-room-docked`): then the area runs down to the tab bar
 * and stops at the panel's left edge.
 */
function freeArea(canvas: DOMRect): FreeArea {
  const row = document.querySelector<HTMLElement>(FREE_SCENE_ROW_SELECTOR)?.getBoundingClientRect()
  const toast = document.querySelector<HTMLElement>(TOAST_ZONE_SELECTOR)?.getBoundingClientRect()
  const sheet = document.querySelector<HTMLElement>(SHEET_ZONE_SELECTOR)?.getBoundingClientRect()
  const tabs = document.querySelector<HTMLElement>(TABS_ZONE_SELECTOR)?.getBoundingClientRect()
  const top = (row?.top ?? canvas.top) - canvas.top
  const docked =
    sheet !== undefined && row !== undefined && sheet.width > 0 && sheet.top < row.bottom - 1
  const bottom = docked
    ? (tabs?.top ?? canvas.bottom) - canvas.top
    : (toast?.bottom ?? row?.bottom ?? canvas.bottom) - canvas.top
  const right = docked && sheet !== undefined ? sheet.left - canvas.left : canvas.width
  return { left: 0, top, width: Math.max(1, right), height: Math.max(1, bottom - top) }
}

/**
 * Frames the room large and centred (S04k): in the screen area between the HUD and the Home
 * panel (the free scene row plus the toast zone, which is empty nearly always and only ever
 * holds a short toast over the room's top), the room's projected corners fill the area as the
 * aspect allows, less `fitMargin`, and the view slides so they sit in the area's centre. A
 * bounding-sphere fit alone left the room a small box in a dark void on desktop. Again on every
 * resize. The player's avatar (S16a, RoomAvatar) stands inside the room's bounds, so the framing
 * holds it without change.
 */
function RoomCamera({ interior }: { readonly interior: RoomInterior }) {
  // Only a dependency: the camera is mutated through the store's own reference (three's model).
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const get = useThree((state) => state.get)
  const invalidate = useThree((state) => state.invalidate)

  useEffect(() => {
    const { camera } = get()
    if (!(camera instanceof PerspectiveCamera)) return
    const canvas = gl.domElement
    const watched = [FREE_SCENE_ROW_SELECTOR, TOAST_ZONE_SELECTOR, SHEET_ZONE_SELECTOR]
      .map((selector) => document.querySelector<HTMLElement>(selector))
      .filter((element): element is HTMLElement => element !== null)
    const sphere = roomSphere(interior)
    const bounds = roomBounds(interior, apartmentConfig)
    const corners = boxCorners(bounds.min, bounds.max).map((c) => new Vector3(...c))
    const projected = new Vector3()

    const place = (distance: number) => {
      camera.near = NEAR_M
      camera.far = distance + sphere.radius * 2
      camera.position.set(
        ...cameraPosition(
          sphere.center,
          interior.camera.position,
          interior.camera.target,
          distance,
        ),
      )
      camera.lookAt(...sphere.center)
      camera.updateMatrixWorld()
      camera.updateProjectionMatrix()
    }
    const measure = (width: number, height: number) => (distance: number) => {
      place(distance)
      let left = Infinity
      let top = Infinity
      let right = -Infinity
      let bottom = -Infinity
      for (const corner of corners) {
        projected.copy(corner).project(camera)
        const x = ((projected.x + 1) / 2) * width
        const y = ((1 - projected.y) / 2) * height
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
      return { left, top, right, bottom }
    }

    const apply = () => {
      const rect = canvas.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      const area = freeArea(rect)
      camera.fov = interior.camera.fovDeg
      camera.clearViewOffset()
      const start = fitDistance(sphere, {
        fovDeg: interior.camera.fovDeg,
        width: rect.width,
        height: rect.height,
        rowHeight: area.height,
        margin: apartmentConfig.fitMargin,
      })
      const distance = tightDistance(
        start,
        measure(rect.width, rect.height),
        area,
        apartmentConfig.fitMargin,
      )
      const box = measure(rect.width, rect.height)(distance)
      // Slide the view window so the room's projected centre lands on the area's centre.
      const dx = area.left + area.width / 2 - (box.left + box.right) / 2
      const dy = area.top + area.height / 2 - (box.top + box.bottom) / 2
      camera.setViewOffset(
        rect.width,
        rect.height,
        Math.round(-dx),
        Math.round(-dy),
        rect.width,
        rect.height,
      )
      invalidate()
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(canvas)
    for (const element of watched) observer.observe(element)
    return () => {
      observer.disconnect()
      camera.clearViewOffset()
    }
  }, [camera, gl, get, interior, invalidate])

  return null
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

  return (
    <div
      role="img"
      aria-label={label}
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
      >
        <RoomLights interior={interior} minute={minute} tier={tier} />
        <RoomCamera interior={interior} />
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
            interior={interior}
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
    </div>
  )
}
