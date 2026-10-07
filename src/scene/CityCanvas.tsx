'use client'

/**
 * The 3D chunk's entry (loaded with next/dynamic, ssr: false, from CitySceneClient): the
 * react-three-fiber canvas with the city, place pins, the player's avatar, lights, camera rig and
 * test hooks. Renders on demand only, so an idle map draws zero frames.
 *
 * A lost WebGL context (S04c) is restored in place: three re-creates its GL state when the
 * browser restores the context, so the canvas is never remounted; this only reports the loss
 * and, after the first frame drawn again, the recovery.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { PCFShadowMap } from 'three'
import { usePlayerHome } from '@/state/playerHome'
import { PlayerAvatar } from './avatar/PlayerAvatar'
import { CameraRig } from './camera/CameraRig'
import { FreeRowFraming } from './camera/FreeRowFraming'
import { nearFar } from './camera/limits'
import { City, type CityObjects } from './City'
import { landTopY } from './geo/buildLand'
import type { ModelTier } from './models/types'
import type { GeoLoadFailure } from './geo/load'
import { safeParseGeoBase } from './geo/schema'
import { TestHooks } from './testHooks'
import type { SceneProps } from './types'

// R3F turns a boolean `shadows` into PCFSoftShadowMap, which three 0.182 deprecates with a
// console warning; an object leaves the type explicit (and shadows off until S04b's tiers).
const SHADOWS = { enabled: false, type: PCFShadowMap }

// Quality tiers arrive with S04b; until then the map draws models at the mid tier, matching the
// mid DPR cap CityScene passes.
const MODEL_TIER: ModelTier = 'mid'

const GL = {
  antialias: true,
  alpha: false,
  stencil: false,
  powerPreference: 'high-performance',
} as const

export interface CityCanvasProps extends Pick<
  SceneProps,
  'palette' | 'config' | 'homesLocal' | 'startHome' | 'boundsLocal' | 'dprCap' | 'playerModel'
> {
  /** The downloaded geo body, validated here before the canvas mounts. */
  readonly geoBody: unknown
  /** Called (once) instead of mounting the canvas when the body fails the schema. */
  readonly onInvalidGeo: (failure: GeoLoadFailure) => void
  readonly label: string
  /** The "expanding soon" chip text, rendered by the server. */
  readonly expandingSoon: string
  readonly onReady: () => void
  /** The WebGL context was lost: the map shows nothing until it is restored. */
  readonly onContextLost: () => void
  /** A frame has drawn again after the context came back. */
  readonly onContextRestored: () => void
}

function ContextWatcher({
  onLost,
  onRestored,
}: {
  readonly onLost: () => void
  readonly onRestored: () => void
}) {
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const restored = useRef(false)

  useEffect(() => {
    const canvas = gl.domElement
    // three's renderer listens first and calls preventDefault(), which is what lets the browser
    // restore the context at all.
    const lost = () => {
      restored.current = false
      onLost()
    }
    const back = () => {
      restored.current = true
      invalidate()
    }
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', back)
    return () => {
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', back)
    }
  }, [gl, invalidate, onLost])

  useFrame(() => {
    if (!restored.current) return
    restored.current = false
    onRestored()
  })

  return null
}

export default function CityCanvas({
  geoBody,
  onInvalidGeo,
  palette,
  config,
  homesLocal,
  startHome,
  boundsLocal,
  dprCap,
  playerModel,
  label,
  expandingSoon,
  onReady,
  onContextLost,
  onContextRestored,
}: CityCanvasProps) {
  const readyRef = useRef(false)
  // Hand-made models stay off the playable path: they start loading once the city has drawn.
  const [drawn, setDrawn] = useState(false)
  // The camera starts over the player's home and the avatar stands there (S05).
  const home = homesLocal[usePlayerHome() ?? startHome]
  const cityRef = useRef<CityObjects | null>(null)
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
    <div
      role="img"
      aria-label={label}
      data-cc-feature="cc-feature:city-scene"
      className="absolute inset-0"
    >
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
        <CameraRig camera={camera} start={home} bounds={boundsLocal} groundY={groundY} />
        <FreeRowFraming />
        <City
          geo={geo}
          palette={palette}
          config={config}
          expandingSoon={expandingSoon}
          cityRef={cityRef}
          onReady={() => {
            readyRef.current = true
            setDrawn(true)
            onReady()
          }}
        />
        <PlayerAvatar
          at={home}
          groundY={groundY}
          color={palette.player}
          toonRamp={palette.toonRamp}
          avatar={config.avatar}
          model={playerModel}
          models={config.models}
          tier={MODEL_TIER}
          loadModel={drawn}
        />
        <ContextWatcher onLost={onContextLost} onRestored={onContextRestored} />
        <TestHooks readyRef={readyRef} cityRef={cityRef} />
      </Canvas>
    </div>
  )
}
