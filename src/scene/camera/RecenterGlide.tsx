'use client'

/**
 * The Map tab's "back to me" (src/state/mapTab.ts): on a recentre request the camera glides to
 * the default view over the player (where the avatar rests, or the home's cluster on a wide
 * screen, as the map opened), at the default distance, tilt and turn. A cut under
 * `prefers-reduced-motion` (CLAUDE.md "Art direction"). Any input of the player's on the map ends
 * the glide where it is, as with a flight to a place (pins/PlacePins.tsx).
 *
 * Every step goes through the controls, so the rig's extent clamp and on-demand rendering apply.
 */
import { useCallback, useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { MapControls } from 'three/addons/controls/MapControls.js'
import type { LocalPoint } from '@/lib/geo/projection'
import { onMapRecenter } from '@/state/mapRecenter'
import { beginContinuous, endContinuous } from '../quality/continuity'
import { easeInOut, mixPose, type CameraPose } from './focus'
import { initialPose } from './limits'

interface RecenterGlideProps {
  /** Where the default view looks: the camera's start for where the player is now. */
  readonly at: LocalPoint
  readonly groundY: number
  readonly distanceM: number
  readonly polarDeg: number
  readonly azimuthDeg: number
  readonly durationMs: number
}

interface Glide {
  readonly from: CameraPose
  readonly to: CameraPose
  elapsedMs: number
  started: boolean
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function RecenterGlide({
  at,
  groundY,
  distanceM,
  polarDeg,
  azimuthDeg,
  durationMs,
}: RecenterGlideProps) {
  // Only a dependency: the effect re-runs when the camera rig installs its controls.
  const controls = useThree((state) => state.controls)
  const invalidate = useThree((state) => state.invalidate)
  const get = useThree((state) => state.get)
  const glide = useRef<Glide | null>(null)
  const applyRef = useRef<((pose: CameraPose) => void) | null>(null)
  const stop = useCallback(() => {
    glide.current = null
    endContinuous('recenter')
  }, [])

  useEffect(() => {
    // Mutated through the store's own reference (three's model), not the hook value.
    const rig = get().controls
    if (!(rig instanceof MapControls)) return
    const apply = (pose: CameraPose) => {
      const { camera } = get()
      rig.target.set(pose.target.x, pose.target.y, pose.target.z)
      camera.position.set(pose.position.x, pose.position.y, pose.position.z)
      // Fires the controls' change event: the rig clamps the target and requests a frame.
      rig.update()
    }
    const recenter = () => {
      const { camera } = get()
      const from: CameraPose = {
        target: { x: rig.target.x, y: rig.target.y, z: rig.target.z },
        position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      }
      const to = initialPose(at, groundY, distanceM, polarDeg, azimuthDeg)
      if (durationMs === 0 || prefersReducedMotion()) {
        stop()
        apply(to)
        return
      }
      glide.current = { from, to, elapsedMs: 0, started: false }
      beginContinuous('recenter')
      invalidate()
    }
    rig.addEventListener('start', stop)
    applyRef.current = apply
    const off = onMapRecenter(recenter)
    return () => {
      rig.removeEventListener('start', stop)
      off()
      stop()
      applyRef.current = null
    }
  }, [controls, get, invalidate, stop, at, groundY, distanceM, polarDeg, azimuthDeg, durationMs])

  useFrame((_, deltaS) => {
    const current = glide.current
    const apply = applyRef.current
    if (current === null || apply === null) return
    // The first frame's delta spans the idle time before it (on-demand rendering): skip it.
    if (current.started) current.elapsedMs += deltaS * 1000
    current.started = true
    const t = Math.min(1, current.elapsedMs / durationMs)
    apply(mixPose(current.from, current.to, easeInOut(t)))
    if (t >= 1) stop()
    else invalidate()
  })

  return null
}
