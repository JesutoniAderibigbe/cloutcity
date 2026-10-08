'use client'

/**
 * The room's camera (S04k, S40, S40b): it frames the room large and centred in the screen area
 * the HUD, tab bar and Home panel leave free, and lets the player turn it like a doll's house.
 *
 * - Framing: from the home's data angle, the room's projected corners fill the free area (the
 *   free scene row plus the toast zone, which nearly always is empty), less `fitMargin`, and the
 *   view window slides so they sit in its centre. Again on every resize, keeping the player's
 *   angle and zoom.
 * - Turning (three's OrbitControls, which the map's MapControls already ship in the 3D chunk):
 *   one finger or the mouse turns the room all the way round and tilts it within limits; a pinch,
 *   the wheel or a trackpad pinch zooms, never closer than just outside the room's bounding
 *   sphere, so the camera never passes through a wall or the floor. Damped, except under reduced
 *   motion. The controls set `touch-action: none` on the canvas and take the wheel, so neither the
 *   page nor the browser's pinch zoom takes the gesture (Safari's own gesture events are refused
 *   too). Walls between the camera and the room drop out (`hiddenWalls`) as it turns.
 * - A tap still picks a cell (the tap rule allows a few pixels' wobble; a drag is the camera's).
 *   A double tap on the backdrop, or the reset button, eases back to the home view (a cut under
 *   reduced motion).
 * - Renders on demand: a frame per change, and per damping or easing step while one runs.
 */
import { useEffect, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { MOUSE, PerspectiveCamera, Spherical, TOUCH, Vector3 } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { useReducedMotion } from '@/lib/useReducedMotion'
import { attachTapDetector } from '../pins/tap'
import { FREE_SCENE_ROW_SELECTOR } from '../types'
import type { ApartmentObjects } from './buildApartment'
import { hiddenWalls, roomBounds } from './buildRoom'
import { apartmentConfig, tapOptions, type RoomInterior } from './data'
import {
  boundingSphere,
  boxCorners,
  cameraPosition,
  fitDistance,
  tightDistance,
  type Sphere,
} from './fit'
import { easeToward, isDoubleTap, polarRange, zoomRange, type TapMark } from './orbit'

/** Near plane: depth precision is spent on the room. */
export const NEAR_M = 0.05

/** Zones of the overlay (src/components/overlay/OverlayLayout.tsx) the framing works around. */
const TOAST_ZONE_SELECTOR = '[data-overlay-zone="toast"]'
const SHEET_ZONE_SELECTOR = '[data-overlay-zone="sheet"]'
const TABS_ZONE_SELECTOR = '[data-overlay-zone="tabs"]'

/** The screen area the room may fill, in CSS pixels from the canvas's top left. */
export interface FreeArea {
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

function roomSphere(interior: RoomInterior): Sphere {
  const bounds = roomBounds(interior, apartmentConfig)
  return boundingSphere(bounds.min, bounds.max)
}

/** What the canvas around the orbit hears from it (the reset button's place and visibility). */
export interface RoomOrbitHandle {
  /** Eases back to the home view. */
  reset(): void
}

interface RoomOrbitProps {
  readonly interior: RoomInterior
  readonly objectsRef: RefObject<ApartmentObjects | null>
  /** Filled with the orbit's handle while it is mounted. */
  readonly handleRef: RefObject<RoomOrbitHandle | null>
  /** The free area, on every framing (the reset button sits in its corner). */
  readonly onArea: (area: FreeArea) => void
  /** Whether the view is turned away from the home view (the reset button shows only then). */
  readonly onTurned: (turned: boolean) => void
}

export function RoomOrbit({ interior, objectsRef, handleRef, onArea, onTurned }: RoomOrbitProps) {
  const get = useThree((state) => state.get)
  const invalidate = useThree((state) => state.invalidate)
  const reduced = useReducedMotion()
  const controlsRef = useRef<OrbitControls | null>(null)
  // The home pose about the room's centre, and whether the view is easing back to it.
  const homeRef = useRef<Spherical | null>(null)
  const resettingRef = useRef(false)
  const callbacks = useRef({ onArea, onTurned })
  const reducedRef = useRef(reduced)

  useEffect(() => {
    callbacks.current = { onArea, onTurned }
  }, [onArea, onTurned])

  useEffect(() => {
    // Read from the store inside the effect: the orbit mutates the camera, three's model.
    const { camera, gl } = get()
    if (!(camera instanceof PerspectiveCamera)) {
      throw new Error('RoomOrbit needs a PerspectiveCamera')
    }
    const { orbit } = apartmentConfig
    const canvas = gl.domElement
    const sphere = roomSphere(interior)
    const center = new Vector3(...sphere.center)
    const bounds = roomBounds(interior, apartmentConfig)
    const corners = boxCorners(bounds.min, bounds.max).map((c) => new Vector3(...c))
    const projected = new Vector3()
    const offset = new Vector3()

    const controls = new OrbitControls(camera, canvas)
    controls.target.copy(center)
    controls.enablePan = false
    controls.rotateSpeed = orbit.rotateSpeed
    controls.zoomSpeed = orbit.zoomSpeed
    controls.dampingFactor = orbit.damping
    controls.enableDamping = !reducedRef.current
    // Pan is off, so the right button and a two-finger drag turn the room as well.
    controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }
    controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_ROTATE }
    controlsRef.current = controls

    const place = (distance: number) => {
      camera.position.set(
        ...cameraPosition(
          sphere.center,
          interior.camera.position,
          interior.camera.target,
          distance,
        ),
      )
      camera.lookAt(center)
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

    const cutWalls = () => {
      if (
        objectsRef.current?.setHiddenWalls(
          hiddenWalls(interior.room, camera.position.x, camera.position.z),
        )
      ) {
        invalidate()
      }
    }

    let framed = false
    const apply = () => {
      const rect = canvas.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      // The player's angle and zoom (relative to the fit) survive a resize.
      const before = framed ? camera.position.clone().sub(center) : null
      const fitBefore = homeRef.current?.radius ?? 1
      const area = freeArea(rect)
      camera.fov = interior.camera.fovDeg
      camera.near = NEAR_M
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
      const home = new Spherical().setFromVector3(offset.copy(camera.position).sub(center))
      homeRef.current = home
      const zoom = zoomRange(distance, sphere.radius, orbit)
      const tilt = polarRange(home.phi, orbit)
      controls.minDistance = zoom.min
      controls.maxDistance = zoom.max
      controls.minPolarAngle = tilt.min
      controls.maxPolarAngle = tilt.max
      camera.far = zoom.max + sphere.radius * 2
      if (before !== null) {
        camera.position.copy(center).addScaledVector(before, distance / fitBefore)
      }
      camera.updateProjectionMatrix()
      controls.update()
      framed = true
      cutWalls()
      callbacks.current.onArea(area)
      invalidate()
    }

    const onChange = () => {
      cutWalls()
      invalidate()
    }
    const onStart = () => {
      resettingRef.current = false
      callbacks.current.onTurned(true)
    }
    controls.addEventListener('change', onChange)
    controls.addEventListener('start', onStart)

    handleRef.current = {
      reset() {
        resettingRef.current = true
        invalidate()
      },
    }

    // Safari's own pinch gesture events would zoom the page under the canvas.
    const refuse = (event: Event) => event.preventDefault()
    canvas.addEventListener('gesturestart', refuse)
    canvas.addEventListener('gesturechange', refuse)

    // A double tap on the backdrop (no cell under it) resets the view.
    let lastTap: TapMark | null = null
    const detachTap = attachTapDetector(canvas, tapOptions, (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect()
      const cell =
        objectsRef.current?.cellAt(
          camera,
          clientX - rect.left,
          clientY - rect.top,
          rect.width,
          rect.height,
        ) ?? null
      const onCell = cell !== null
      const tap = { x: clientX, y: clientY, at: performance.now() }
      if (!onCell && isDoubleTap(lastTap, tap, orbit)) {
        lastTap = null
        handleRef.current?.reset()
        return
      }
      lastTap = onCell ? null : tap
    })

    apply()
    const watched = [FREE_SCENE_ROW_SELECTOR, TOAST_ZONE_SELECTOR, SHEET_ZONE_SELECTOR]
      .map((selector) => document.querySelector<HTMLElement>(selector))
      .filter((element): element is HTMLElement => element !== null)
    const observer = new ResizeObserver(apply)
    observer.observe(canvas)
    for (const element of watched) observer.observe(element)
    return () => {
      observer.disconnect()
      detachTap()
      canvas.removeEventListener('gesturestart', refuse)
      canvas.removeEventListener('gesturechange', refuse)
      controls.removeEventListener('change', onChange)
      controls.removeEventListener('start', onStart)
      controls.dispose()
      controlsRef.current = null
      handleRef.current = null
      homeRef.current = null
      camera.clearViewOffset()
    }
  }, [get, interior, invalidate, objectsRef, handleRef])

  useEffect(() => {
    reducedRef.current = reduced
    const controls = controlsRef.current
    if (controls !== null) controls.enableDamping = !reduced
  }, [reduced])

  useFrame(() => {
    const controls = controlsRef.current
    const home = homeRef.current
    if (controls === null || home === null) return
    if (resettingRef.current) {
      const { camera } = get()
      const offset = camera.position.clone().sub(controls.target)
      const now = new Spherical().setFromVector3(offset)
      const step = easeToward(now, home, reduced ? 1 : apartmentConfig.orbit.resetEase)
      now.set(step.pose.radius, step.pose.phi, step.pose.theta)
      camera.position.copy(controls.target).add(offset.setFromSpherical(now))
      controls.update()
      if (step.done) {
        resettingRef.current = false
        callbacks.current.onTurned(false)
      } else {
        invalidate()
      }
      return
    }
    // Damping carries a gesture on after the finger lifts: one more frame while it moves.
    if (controls.enableDamping && controls.update()) invalidate()
  })

  return null
}
