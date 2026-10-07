'use client'

/**
 * The shell side of the 3D map: a static background, the scene status, and the lazily loaded
 * canvas. The canvas is a `next/dynamic` import with `ssr: false`, so the shell (HUD, tabs) is
 * interactive before the 3D chunk arrives. Before the canvas mounts, the shell checks for WebGL2
 * and downloads and validates the geo layers (in parallel with the 3D chunk); an expected
 * failure (no WebGL, a failed or invalid download) shows the error status over the static
 * background with one structured warning, and nothing throws into React.
 */
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useState } from 'react'
import { log } from '@/lib/log'
import { loadGeoBase, type GeoLoadFailure } from './geo/load'
import { SCENE_FAILED_MESSAGE, SceneErrorBoundary } from './SceneErrorBoundary'
import type { SceneFailure, SceneProps, SceneStatus } from './types'
import { webgl2Available } from './webgl'

const CityCanvas = dynamic(() => import('./CityCanvas'), { ssr: false })

type SceneState =
  | { readonly status: 'loading' }
  /** Geo downloaded: the 3D chunk validates it, then mounts the canvas; `drawn` after frame 1. */
  | { readonly status: 'starting'; readonly body: unknown; readonly drawn: boolean }
  | { readonly status: 'error'; readonly failure: SceneFailure }

export function CitySceneClient(props: SceneProps) {
  const [state, setState] = useState<SceneState>({ status: 'loading' })
  const { geoUrl, copy, overlayRows, freeRow } = props

  useEffect(() => {
    let active = true
    const fail = (failure: SceneFailure, context: Record<string, unknown>) => {
      if (!active) return
      log.warn(SCENE_FAILED_MESSAGE, context)
      setState({ status: 'error', failure })
    }
    // Probe and download run after this effect returns (the result arrives in a callback).
    void Promise.resolve().then(async () => {
      if (!webgl2Available()) {
        fail('device', { reason: 'no-webgl' })
        return
      }
      const result = await loadGeoBase(geoUrl)
      if (!active) return
      if (result.ok) setState({ status: 'starting', body: result.body, drawn: false })
      else fail('load', { ...result.failure })
    })
    return () => {
      active = false
    }
  }, [geoUrl])

  const onReady = useCallback(
    () =>
      setState((current) =>
        current.status === 'starting' ? { ...current, drawn: true } : current,
      ),
    [],
  )
  const onInvalidGeo = useCallback((failure: GeoLoadFailure) => {
    log.warn(SCENE_FAILED_MESSAGE, { ...failure })
    setState({ status: 'error', failure: 'load' })
  }, [])
  const onError = useCallback(() => setState({ status: 'error', failure: 'load' }), [])

  const status: SceneStatus =
    state.status === 'error'
      ? 'error'
      : state.status === 'starting' && state.drawn
        ? 'ready'
        : 'loading'
  const message =
    state.status === 'error'
      ? state.failure === 'device'
        ? copy.errorDevice
        : copy.errorLoad
      : status === 'loading'
        ? copy.loading
        : ''

  return (
    <div data-scene-root="" data-scene-status={status} className="absolute inset-0">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-b from-night-800 via-night-900 to-night-950"
      />
      {state.status === 'starting' ? (
        <SceneErrorBoundary onError={onError}>
          <CityCanvas
            geoBody={state.body}
            onInvalidGeo={onInvalidGeo}
            palette={props.palette}
            config={props.config}
            startLocal={props.startLocal}
            boundsLocal={props.boundsLocal}
            dprCap={props.dprCap}
            label={copy.label}
            onReady={onReady}
          />
        </SceneErrorBoundary>
      ) : null}
      <div
        className="pointer-events-none absolute inset-0 grid grid-cols-1"
        style={{ gridTemplateRows: overlayRows }}
      >
        <p
          role="status"
          className="flex min-h-0 items-center justify-center px-4 text-center text-sm font-semibold text-ink-300"
          style={{ gridRow: freeRow }}
        >
          {message}
        </p>
      </div>
    </div>
  )
}
