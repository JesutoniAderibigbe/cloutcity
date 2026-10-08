'use client'

/**
 * Category icons and nearby name labels on the place pins (S04k, buildPinMarks.ts). CityCanvas loads
 * this component with `React.lazy` once the city is playable, so its code and atlas never join
 * the playable path (perf.json `totalJsToPlayableGzKB`); the chunk is runtime-cached rather than
 * precached (src/lib/pwa/lazyChunks.ts `pin-marks`), and until it arrives the pins draw as
 * before. Its config (data/config/pinMarks.json) loads with it, and the label text is the pins'
 * own `name` (the server's copy in the geo body), so nothing joins the page's props. The marks
 * follow the camera in `useFrame`, which only runs for frames something else requested: an
 * the marks add no frames of their own. The mount itself requests one frame.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Color, Mesh, PerspectiveCamera, type Material, type Vector3 } from 'three'
// Read directly (validated by PinMarksConfigSchema in src/lib/data/data.test.ts): the classic-zod
// loader must stay out of client chunks.
import pinMarksJson from '@data/config/pinMarks.json'
import type { MapStyle, PinMarksConfig } from '@/lib/data/schemas/scene'
import { worldHex } from '@/lib/world/mapDressing'
import type { ScenePalette } from '../types'
import type { PinObjects } from './buildPins'
import { buildPinMarks, CHIPS_MESH_NAME } from './buildPinMarks'

const baseMarks = pinMarksJson as PinMarksConfig

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
  /** The map style (S04m): bubble size, venue pin lift and cones, and its colours. */
  readonly look: MapStyle
}

/** A mesh's single material colour, or null. */
function colorOf(object: unknown): Color | null {
  if (!(object instanceof Mesh)) return null
  const material = object.material as Material | Material[]
  return !Array.isArray(material) && 'color' in material && material.color instanceof Color
    ? material.color
    : null
}

export default function PinMarks({ pins, palette, look }: PinMarksProps) {
  const invalidate = useThree((state) => state.invalidate)
  const scene = useThree((state) => state.scene)
  const settings = useMemo(() => ({ ...baseMarks, ...look.marks }), [look])
  const marks = useMemo(
    () => buildPinMarks(pins.pins, palette, settings),
    [pins, palette, settings],
  )
  useEffect(() => {
    invalidate()
    return () => marks.dispose()
  }, [marks, invalidate])

  // The style's pins and colours (S04m): venue pins float over their plots or stand on the
  // ground, their cones show or give way to the bubbles, and the land and parks take the style's
  // colours. Plain property changes on the city's existing materials: no shader program.
  const colors = look.colors
  // Boroughs whose land a style recoloured: put back when the next style leaves them alone.
  const touched = useRef(new Set<string>())
  useEffect(() => {
    pins.setVenueLift(look.pins.venueLift)
    const cones = scene.getObjectByName('pins-venue')
    const drawn = cones?.visible === true || cones?.userData.styleHidden === true
    if (cones !== undefined && drawn) {
      cones.visible = look.pins.venueCones
      cones.userData.styleHidden = !look.pins.venueCones
    }
    const land = colors.land ?? {}
    for (const id of new Set([...touched.current, ...Object.keys(land)])) {
      const token = land[id]
      const base = palette.land[id as keyof ScenePalette['land']]
      colorOf(scene.getObjectByName(`land-${id}`))?.set(
        token === undefined ? base : worldHex(token),
      )
      if (token === undefined) touched.current.delete(id)
      else touched.current.add(id)
    }
    colorOf(scene.getObjectByName('parks-park'))?.set(
      colors.park === undefined ? palette.park : worldHex(colors.park),
    )
    // The city's own ribbons (City.tsx), not another layer's object of the same name.
    const city = scene.getObjectByName('city')
    for (const name of ['subway', 'subway-casing']) {
      const line = city?.getObjectByName(name)
      if (line === undefined) continue
      line.position.y = look.subwayLiftM
      line.updateMatrix()
    }
    invalidate()
    return () => {
      pins.setVenueLift(false)
      for (const name of ['subway', 'subway-casing']) {
        const line = city?.getObjectByName(name)
        if (line !== undefined) line.position.y = 0
      }
      if (cones?.userData.styleHidden === true) {
        cones.visible = true
        cones.userData.styleHidden = false
      }
    }
  }, [pins, look, colors, palette, scene, invalidate])

  // The style's water: the day/night rig's keyframe colour scaled per channel by the style's
  // water over the palette's, so night water stays dark. Rewritten only when the rig changed it.
  const water = useRef({
    base: new Color(),
    set: new Color(-1, -1, -1),
    color: null as Color | null,
  })
  const tint = useMemo(() => {
    if (colors.water === undefined) return null
    const to = new Color(worldHex(colors.water))
    const from = new Color(palette.water)
    return new Color(to.r / from.r, to.g / from.g, to.b / from.b)
  }, [colors.water, palette.water])
  useEffect(() => {
    const state = water.current
    state.color = colorOf(scene.getObjectByName('water'))
    const color = state.color
    // Back to the rig's own colour when the style has no water of its own.
    if (color !== null && tint === null && color.equals(state.set)) color.copy(state.base)
    state.set.setScalar(-1)
    invalidate()
  }, [tint, scene, invalidate])

  useFrame(({ camera, controls, gl, scene, size }) => {
    if (tint !== null) {
      const state = water.current
      const color = state.color
      if (color !== null && !color.equals(state.set)) {
        state.base.copy(color)
        color.multiply(tint)
        state.set.copy(color)
      }
    }
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
      pointOf: pins.pointOf,
      chips: chips instanceof Mesh ? chips : null,
      topInsetPx: topInset(gl.domElement),
    })
  })

  return <primitive object={marks.mesh} />
}
