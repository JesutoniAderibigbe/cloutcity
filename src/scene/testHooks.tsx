'use client'

/**
 * Test-mode hook for the e2e suite: camera state and renderer counters on
 * `window.__cloutcityTest.scene`. Only builds with NEXT_PUBLIC_TEST_HOOKS=1 (inlined at build
 * time; the e2e build sets it and writes to its own distDir). In every other build the effect
 * body is dead code and is removed, so the hook never ships: `npm run budget` (shell-guard)
 * fails if `__cloutcityTest` reaches `.next`.
 */
import { useEffect, type RefObject } from 'react'
import { useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { MapControls } from 'three/addons/controls/MapControls.js'
import { PLAYER_AVATAR_NAME } from './avatar/buildAvatar'
import { radToDeg } from './camera/limits'
import type { BoroughView, CityObjects } from './City'
import type { PinKind, PinStyle } from './geo/schema'

interface Vec3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface SceneCameraState {
  readonly position: Vec3
  readonly target: Vec3
  readonly distance: number
  readonly polarDeg: number
  readonly azimuthDeg: number
  readonly near: number
  readonly far: number
}

/** The player's avatar (S05). */
export interface ScenePlayerState {
  /** Where it stands, in local metres (x east, y north). */
  readonly local: { readonly x: number; readonly y: number }
  /** The height of its feet (the land top). */
  readonly groundY: number
  /** Its current height in metres (it rescales with the camera distance). */
  readonly sizeM: number
  /** Its feet on screen, in CSS pixels from the viewport's top left. */
  readonly screen: { readonly x: number; readonly y: number }
}

/** A pin as the test sees it: where to tap, in client (viewport) CSS pixels. */
export interface ScenePinState {
  readonly id: string
  readonly kind: PinKind
  readonly style: PinStyle
  readonly borough: string
  /** Absent when the pin is behind the camera or off the canvas. */
  readonly screen: { readonly x: number; readonly y: number } | null
}

export interface SceneTestHook {
  /** True once a frame has drawn the city. */
  readonly ready: boolean
  /** Frames rendered so far (renderer.info.render.frame). */
  frames(): number
  /** Frames requested but not yet rendered (0 = idle: on-demand rendering has nothing to do). */
  pendingFrames(): number
  camera(): SceneCameraState | null
  /** Draw calls and triangles of the last rendered frame. */
  renderInfo(): { calls: number; triangles: number }
  /** The player's avatar, or null before it is in the scene. */
  player(): ScenePlayerState | null
  /** Every place pin (S04c), with its tap point for the current camera. */
  pins(): ScenePinState[]
  pinCount(): number
  /** Per-borough land style, pin count and chip (S04c, S07 render half). */
  boroughs(): BoroughView[]
  /** The place under the selection ring, or null. */
  selectedPlaceId(): string | null
  /** Loses / restores the WebGL context through WEBGL_lose_context; false if unsupported. */
  loseContext(): boolean
  restoreContext(): boolean
}

declare global {
  interface Window {
    __cloutcityTest?: CloutcityTestHooks
  }
  /** One property per feature hook (merged with src/components/events/eventTestHook.ts). */
  interface CloutcityTestHooks {
    scene?: SceneTestHook
  }
}

const vec = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z })

export function TestHooks({
  readyRef,
  cityRef,
}: {
  readonly readyRef: RefObject<boolean>
  readonly cityRef: RefObject<CityObjects | null>
}) {
  const gl = useThree((state) => state.gl)
  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls)
  const get = useThree((state) => state.get)
  const scene = useThree((state) => state.scene)

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_TEST_HOOKS !== '1') return
    // Kept from the loss: a lost context returns null for getExtension.
    let loseExtension: WEBGL_lose_context | null = null
    const hook: SceneTestHook = {
      get ready() {
        return readyRef.current
      },
      frames: () => gl.info.render.frame,
      pendingFrames: () => get().internal.frames,
      camera: () => {
        if (!(controls instanceof MapControls)) return null
        return {
          position: vec(camera.position),
          target: vec(controls.target),
          distance: controls.getDistance(),
          polarDeg: radToDeg(controls.getPolarAngle()),
          azimuthDeg: radToDeg(controls.getAzimuthalAngle()),
          near: 'near' in camera ? camera.near : 0,
          far: 'far' in camera ? camera.far : 0,
        }
      },
      renderInfo: () => ({ calls: gl.info.render.calls, triangles: gl.info.render.triangles }),
      player: () => {
        const avatar = scene.getObjectByName(PLAYER_AVATAR_NAME)
        if (avatar === undefined) return null
        avatar.updateMatrixWorld(true)
        const feet = avatar.getWorldPosition(new Vector3())
        const ndc = feet.clone().project(camera)
        const rect = gl.domElement.getBoundingClientRect()
        return {
          local: { x: feet.x, y: -feet.z },
          groundY: feet.y,
          sizeM: avatar.scale.y,
          screen: {
            x: rect.left + ((ndc.x + 1) / 2) * rect.width,
            y: rect.top + ((1 - ndc.y) / 2) * rect.height,
          },
        }
      },
      pins: () => {
        const city = cityRef.current
        if (city === null) return []
        const rect = gl.domElement.getBoundingClientRect()
        const onScreen = new Map(
          city.pins
            .screenPins(get().camera, rect.width, rect.height)
            .filter(
              (pin) => pin.x >= 0 && pin.y >= 0 && pin.x <= rect.width && pin.y <= rect.height,
            )
            .map((pin) => [pin.id, { x: pin.x + rect.left, y: pin.y + rect.top }]),
        )
        return city.pins.pins.map((pin) => ({
          id: pin.id,
          kind: pin.kind,
          style: pin.style,
          borough: pin.borough,
          screen: onScreen.get(pin.id) ?? null,
        }))
      },
      pinCount: () => cityRef.current?.pins.pins.length ?? 0,
      boroughs: () => [...(cityRef.current?.boroughs ?? [])],
      selectedPlaceId: () => cityRef.current?.pins.selectedId() ?? null,
      loseContext: () => {
        loseExtension ??= gl.getContext().getExtension('WEBGL_lose_context')
        loseExtension?.loseContext()
        return loseExtension !== null
      },
      restoreContext: () => {
        loseExtension?.restoreContext()
        return loseExtension !== null
      },
    }
    window.__cloutcityTest = { ...window.__cloutcityTest, scene: hook }
    return () => {
      delete window.__cloutcityTest?.scene
    }
  }, [gl, camera, controls, get, scene, readyRef, cityRef])

  return null
}
