'use client'

/**
 * The 3D chunk's entry (loaded with next/dynamic, ssr: false, from CitySceneClient): the
 * react-three-fiber canvas with the city, lights, camera rig and test hooks. Renders on demand
 * only, so an idle map draws zero frames.
 */
import { useEffect, useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { PCFShadowMap } from 'three'
import { CameraRig } from './camera/CameraRig'
import { nearFar } from './camera/limits'
import { City } from './City'
import { landTopY } from './geo/buildLand'
import type { GeoLoadFailure } from './geo/load'
import { safeParseGeoBase } from './geo/schema'
import { TestHooks } from './testHooks'
import type { SceneProps } from './types'

// R3F turns a boolean `shadows` into PCFSoftShadowMap, which three 0.182 deprecates with a
// console warning; an object leaves the type explicit (and shadows off until S04b's tiers).
const SHADOWS = { enabled: false, type: PCFShadowMap }

const GL = {
  antialias: true,
  alpha: false,
  stencil: false,
  powerPreference: 'high-performance',
} as const

export interface CityCanvasProps extends Pick<
  SceneProps,
  'palette' | 'config' | 'startLocal' | 'boundsLocal' | 'dprCap'
> {
  /** The downloaded geo body, validated here before the canvas mounts. */
  readonly geoBody: unknown
  /** Called (once) instead of mounting the canvas when the body fails the schema. */
  readonly onInvalidGeo: (failure: GeoLoadFailure) => void
  readonly label: string
  readonly onReady: () => void
}

export default function CityCanvas({
  geoBody,
  onInvalidGeo,
  palette,
  config,
  startLocal,
  boundsLocal,
  dprCap,
  label,
  onReady,
}: CityCanvasProps) {
  const readyRef = useRef(false)
  // Validated outside the R3F root and without throwing: an invalid body is an expected
  // failure, reported to the shell instead of reaching React's error logging.
  const parsed = useMemo(() => safeParseGeoBase(geoBody), [geoBody])
  useEffect(() => {
    if (!parsed.ok) onInvalidGeo({ reason: 'geo-invalid', paths: parsed.paths })
  }, [parsed, onInvalidGeo])
  const { camera, lights } = config
  const groundY = landTopY(config.land)
  const clip = nearFar(camera.distanceM, camera)
  const sun = lights.sunDirection

  if (!parsed.ok) return null
  const geo = parsed.geo

  return (
    <div role="img" aria-label={label} className="absolute inset-0">
      <Canvas
        frameloop="demand"
        dpr={[1, dprCap]}
        flat
        shadows={SHADOWS}
        gl={GL}
        camera={{ fov: camera.fovDeg, near: clip.near, far: clip.far }}
      >
        <color attach="background" args={[palette.background]} />
        <ambientLight color={palette.ambientLight} intensity={lights.ambientIntensity} />
        <directionalLight
          color={palette.sunLight}
          intensity={lights.sunIntensity}
          position={[sun.x, sun.y, sun.z]}
        />
        <CameraRig camera={camera} start={startLocal} bounds={boundsLocal} groundY={groundY} />
        <City
          geo={geo}
          palette={palette}
          config={config}
          onReady={() => {
            readyRef.current = true
            onReady()
          }}
        />
        <TestHooks readyRef={readyRef} />
      </Canvas>
    </div>
  )
}
