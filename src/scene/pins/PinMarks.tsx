'use client'

/**
 * Category icons and nearby name labels on the place pins (S04k, buildPinMarks.ts). CityCanvas loads
 * this component with `React.lazy` once the city is playable, so its code and atlas never join
 * the playable path (perf.json `totalJsToPlayableGzKB`); the chunk is runtime-cached rather than
 * precached (src/lib/pwa/lazyChunks.ts `pin-marks`), and until it arrives the pins draw as
 * before. Its config (data/config/pinMarks.json) loads with it, and the label text is the pins'
 * own `name` (the server's copy in the geo body), so nothing joins the page's props. The marks
 * follow the camera in `useFrame`, which only runs for frames something else requested: an
 * idle map still renders no frames. The mount itself requests one frame.
 */
import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Mesh, PerspectiveCamera, type Vector3 } from 'three'
// Read directly (validated by PinMarksConfigSchema in src/lib/data/data.test.ts): the classic-zod
// loader must stay out of client chunks.
import pinMarksJson from '@data/config/pinMarks.json'
import type { PinMarksConfig } from '@/lib/data/schemas/scene'
import type { ScenePalette } from '../types'
import type { PinObjects } from './buildPins'
import { buildPinMarks, CHIPS_MESH_NAME } from './buildPinMarks'

const marksConfig = pinMarksJson as PinMarksConfig

/**
 * How far the free scene row (the scene's status row, which repeats the overlay grid) starts
 * below the canvas top: the HUD covers everything above it. Read from the DOM by attribute, not
 * through src/scene/types.ts, which would pull that module into this chunk.
 */
function topInset(canvas: HTMLCanvasElement): number {
  const row = document.querySelector('[data-free-scene-row]')
  if (row === null) return 0
  return Math.max(0, row.getBoundingClientRect().top - canvas.getBoundingClientRect().top)
}

interface OrbitLike {
  readonly target: Vector3
  getDistance(): number
}

interface PinMarksProps {
  readonly pins: PinObjects
  readonly palette: ScenePalette
}

export default function PinMarks({ pins, palette }: PinMarksProps) {
  const invalidate = useThree((state) => state.invalidate)
  const marks = useMemo(() => buildPinMarks(pins.pins, palette, marksConfig), [pins, palette])
  useEffect(() => {
    invalidate()
    return () => marks.dispose()
  }, [marks, invalidate])

  useFrame(({ camera, controls, gl, scene, size }) => {
    // The camera rig's MapControls, read by shape: importing the class here would split it out
    // of the 3D chunk into a chunk of its own.
    const rig = controls as Partial<OrbitLike> | null
    if (!(camera instanceof PerspectiveCamera) || rig?.target === undefined) return
    if (typeof rig.getDistance !== 'function') return
    const chips = scene.getObjectByName(CHIPS_MESH_NAME)
    marks.update({
      camera,
      width: size.width,
      height: size.height,
      target: rig.target,
      distance: rig.getDistance(),
      pinHeight: pins.height(),
      headY: pins.headY,
      chips: chips instanceof Mesh ? chips : null,
      topInsetPx: topInset(gl.domElement),
    })
  })

  return <primitive object={marks.mesh} />
}
