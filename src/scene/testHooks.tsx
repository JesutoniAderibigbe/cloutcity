'use client'

/**
 * Test-mode hook for the e2e suite: camera state and renderer counters on
 * `window.__CLOUTCITY_TEST__.scene`. Only builds with NEXT_PUBLIC_TEST_HOOKS=1 (inlined at build
 * time; the e2e build sets it and writes to its own distDir). In every other build the effect
 * body is dead code and is removed, so the hook never ships: `npm run budget` fails if the
 * marker reaches `.next`.
 */
import { useEffect, type RefObject } from 'react'
import { useThree } from '@react-three/fiber'
import { MapControls } from 'three/addons/controls/MapControls.js'
import { radToDeg } from './camera/limits'

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
}

declare global {
  interface Window {
    __CLOUTCITY_TEST__?: { scene?: SceneTestHook }
  }
}

const vec = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z })

export function TestHooks({ readyRef }: { readonly readyRef: RefObject<boolean> }) {
  const gl = useThree((state) => state.gl)
  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls)
  const get = useThree((state) => state.get)

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_TEST_HOOKS !== '1') return
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
    }
    window.__CLOUTCITY_TEST__ = { ...window.__CLOUTCITY_TEST__, scene: hook }
    return () => {
      delete window.__CLOUTCITY_TEST__?.scene
    }
  }, [gl, camera, controls, get, readyRef])

  return null
}
