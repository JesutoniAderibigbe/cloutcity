/**
 * Pin marks (S04k): a category icon on each playable pin's head and a short name label over
 * the nearest few, like the icon pins of a city map. Everything is one mesh of camera-facing
 * quads sampling one runtime atlas, drawn with an unlit `MeshBasicMaterial` (map + alphaTest),
 * the settings the landmark name chips and the "expanding soon" chips already compile, so the
 * marks add one draw call and no shader program (perf.json `programsMax`).
 *
 * The quads are rewritten on the CPU for each rendered frame whose view changed (PinMarks.tsx
 * calls {@link PinMarksObjects.update} from `useFrame`, which never requests a frame itself, so
 * the marks add no frames of their own). Icons keep a constant size on screen. Labels go to the
 * pins nearest the camera target, in that order, and a label that would cover an icon, a
 * landmark name chip or a label already placed is left out (UX-14). Memorial and teaser pins
 * stay plain: no icon, no label. three only, no React; the atlas needs a 2D canvas (browser).
 *
 * This module loads lazily after the map is playable (PinMarks.tsx), never on the playable path.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DynamicDrawUsage,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  SRGBColorSpace,
  Vector3,
} from 'three'
import type { PinMarksConfig } from '@/lib/data/schemas/scene'
import type { PlaceIconGroup } from '@/lib/data/schemas/content'
import { placeIcon, placeIconGroup, type PlaceCategory } from '@/lib/world/placeIcons'
import type { GeoPin } from '../geo/schema'
import type { ScenePalette } from '../types'

/**
 * The landmark name chips' mesh name (src/scene/landmarks/nameChips.ts LANDMARK_CHIPS_NAME,
 * kept equal by buildPinMarks.test.ts). Not imported: that would pull the module out of the 3D
 * chunk into one shared with this lazy chunk, which grows the playable path.
 */
export const CHIPS_MESH_NAME = 'landmark-name-chips'

/** Marker text the budget's optional-chunk filter finds in this chunk (lazyChunks.ts). */
export const PIN_MARKS_FEATURE = 'cc-feature:pin-marks'

type MarksConfig = PinMarksConfig

const FONT_STACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
const EMOJI_STACK = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'

/** Screen rectangle in CSS pixels. */
export interface Rect {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

/** One label candidate: its pin's index and screen rectangle, nearest the target first. */
export interface LabelCandidate {
  readonly index: number
  readonly rect: Rect
  readonly distance: number
}

/**
 * Which labels show: nearest the camera target first, at most `max`, skipping any that would
 * cover an obstacle (icons, name chips) or a label already placed. Pure, for the tests.
 */
export function pickLabels(
  candidates: readonly LabelCandidate[],
  obstacles: readonly Rect[],
  max: number,
): number[] {
  const placed: Rect[] = []
  const picked: number[] = []
  for (const candidate of [...candidates].sort((a, b) => a.distance - b.distance)) {
    if (picked.length >= max) break
    if (obstacles.some((rect) => overlaps(rect, candidate.rect))) continue
    if (placed.some((rect) => overlaps(rect, candidate.rect))) continue
    placed.push(candidate.rect)
    picked.push(candidate.index)
  }
  return picked
}

/** A label's text: the name, cut at a word boundary with an ellipsis past `maxChars`. */
export function shortName(name: string, maxChars: number): string {
  if (name.length <= maxChars) return name
  const cut = name.slice(0, maxChars - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > maxChars / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** The pins that get marks, and what each one draws. */
export interface MarkPlan {
  readonly pin: GeoPin
  /** The atlas cell of the pin's icon (shared by every pin of the same kind and group). */
  readonly iconCell: number
  /** The label's atlas cell, or -1: badged landmarks have name chips instead. */
  readonly labelCell: number
  readonly text: string | null
}

export interface MarkLayout {
  readonly plans: readonly MarkPlan[]
  /** One per icon cell: the pin kind (ring colour) and icon group. */
  readonly icons: readonly { readonly kind: GeoPin['kind']; readonly group: PlaceIconGroup }[]
  readonly labels: readonly string[]
}

/** Plans the marks and the atlas cells. Pure, for the tests. */
export function planMarks(pins: readonly GeoPin[], maxChars: number): MarkLayout {
  const icons: { kind: GeoPin['kind']; group: PlaceIconGroup }[] = []
  const iconIndex = new Map<string, number>()
  const labels: string[] = []
  const plans: MarkPlan[] = []
  for (const pin of pins) {
    if (pin.style !== 'normal') continue
    const group = placeIconGroup(pin.category as PlaceCategory)
    const key = `${pin.kind}|${group}`
    let iconCell = iconIndex.get(key)
    if (iconCell === undefined) {
      iconCell = icons.length
      iconIndex.set(key, iconCell)
      icons.push({ kind: pin.kind, group })
    }
    const text = pin.badge === true || pin.name === '' ? null : shortName(pin.name, maxChars)
    const labelCell = text === null ? -1 : labels.length
    if (text !== null) labels.push(text)
    plans.push({ pin, iconCell, labelCell, text })
  }
  return { plans, icons, labels }
}

interface AtlasLayout {
  readonly width: number
  readonly height: number
  /** Top-left pixel of each icon cell, then of each label cell. */
  readonly iconAt: (cell: number) => readonly [number, number]
  readonly labelAt: (cell: number) => readonly [number, number]
}

function atlasLayout(layout: MarkLayout, config: MarksConfig): AtlasLayout {
  const width = config.labelCellWidthPx * config.atlasColumns
  const iconsPerRow = Math.max(1, Math.floor(width / config.iconCellPx))
  const iconRows = Math.ceil(layout.icons.length / iconsPerRow)
  const labelTop = iconRows * config.iconCellPx
  const labelRows = Math.ceil(layout.labels.length / config.atlasColumns)
  return {
    width,
    height: Math.max(1, labelTop + labelRows * config.labelCellHeightPx),
    iconAt: (cell) => [
      (cell % iconsPerRow) * config.iconCellPx,
      Math.floor(cell / iconsPerRow) * config.iconCellPx,
    ],
    labelAt: (cell) => [
      (cell % config.atlasColumns) * config.labelCellWidthPx,
      labelTop + Math.floor(cell / config.atlasColumns) * config.labelCellHeightPx,
    ],
  }
}

function drawAtlas(
  layout: MarkLayout,
  atlas: AtlasLayout,
  palette: ScenePalette,
  config: MarksConfig,
): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = atlas.width
  canvas.height = atlas.height
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('pin marks: 2D canvas is unavailable')
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  const cell = config.iconCellPx
  layout.icons.forEach((icon, i) => {
    const [x, y] = atlas.iconAt(i)
    const cx = x + cell / 2
    const cy = y + cell / 2
    // Inset by a pixel or two, so mipmaps never bleed a neighbour's colour in.
    const radius = cell / 2 - 3
    context.fillStyle = palette.pins[icon.kind]
    context.beginPath()
    context.arc(cx, cy, radius, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = palette.chip.fill
    context.beginPath()
    context.arc(cx, cy, radius * (1 - config.ringWidth * 2), 0, Math.PI * 2)
    context.fill()
    context.font = `${Math.round(cell * config.iconFontScale)}px ${EMOJI_STACK}`
    context.fillStyle = palette.chip.ink
    // Emoji sit a little high on their em box in most fonts.
    context.fillText(placeIcon(icon.group), cx, cy + cell * 0.04)
  })
  const w = config.labelCellWidthPx
  const h = config.labelCellHeightPx
  context.font = `800 ${Math.round(h * config.labelFontScale)}px ${FONT_STACK}`
  layout.labels.forEach((text, i) => {
    const [x, y] = atlas.labelAt(i)
    const textWidth = Math.min(context.measureText(text).width, w * 0.92)
    const plateW = Math.min(w - 4, textWidth + h * 0.6)
    context.fillStyle = palette.chip.fill
    context.beginPath()
    context.roundRect(x + (w - plateW) / 2, y + h * 0.1, plateW, h * 0.8, h * 0.4)
    context.fill()
    context.fillStyle = palette.chip.ink
    context.fillText(text, x + w / 2, y + h / 2, w * 0.92)
  })
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

export interface MarksView {
  readonly camera: PerspectiveCamera
  /** The canvas in CSS pixels. */
  readonly width: number
  readonly height: number
  /** The camera target (where the player looks) and its distance from the camera. */
  readonly target: Vector3
  readonly distance: number
  /** The pins' current height (buildPins `height()`); 0 before the first rescale. */
  readonly pinHeight: number
  /** A pin's head height at that scale (buildPins `headY`). */
  readonly headY: (pin: GeoPin) => number
  /** Landmark name chips to keep labels off, or null while they are hidden. */
  readonly chips: Mesh | null
  /** Canvas pixels from the top that the HUD covers: no label is placed above this line. */
  readonly topInsetPx: number
}

export interface PinMarksObjects {
  readonly mesh: Mesh
  /** Rewrites the quads for a view; returns false when nothing changed. */
  update(view: MarksView): boolean
  /** Pin ids whose label shows (for the test hooks). */
  labelled(): readonly string[]
  dispose(): void
}

const _right = new Vector3()
const _up = new Vector3()
const _back = new Vector3()
const _head = new Vector3()
const _centre = new Vector3()
const _ndc = new Vector3()
const _corner = new Vector3()

export function buildPinMarks(
  pins: readonly GeoPin[],
  palette: ScenePalette,
  settings: PinMarksConfig,
): PinMarksObjects {
  const layout = planMarks(pins, settings.labelMaxChars)
  const atlas = atlasLayout(layout, settings)
  const texture = drawAtlas(layout, atlas, palette, settings)
  // Over the buildings and the name chips, like a map's icons: depth is GL state, not a shader
  // define, so the program stays the chips' one.
  const material = new MeshBasicMaterial({
    map: texture,
    alphaTest: settings.alphaTest,
    depthTest: false,
  })

  const plans = layout.plans
  // One quad per icon (plans order), then one per label (same order, -1 cells skipped).
  const labelPlans = plans.filter((plan) => plan.labelCell >= 0)
  const quads = plans.length + labelPlans.length
  const positions = new Float32Array(quads * 12)
  const uvs = new Float32Array(quads * 8)
  const index = new Uint16Array(quads * 6)
  const setUv = (quad: number, x: number, y: number, w: number, h: number) => {
    const u0 = x / atlas.width
    const u1 = (x + w) / atlas.width
    // Canvas rows run top-down; texture v runs bottom-up.
    const v0 = 1 - (y + h) / atlas.height
    const v1 = 1 - y / atlas.height
    uvs.set([u0, v0, u1, v0, u1, v1, u0, v1], quad * 8)
    const v = quad * 4
    index.set([v, v + 1, v + 2, v, v + 2, v + 3], quad * 6)
  }
  plans.forEach((plan, i) => {
    const [x, y] = atlas.iconAt(plan.iconCell)
    setUv(i, x, y, settings.iconCellPx, settings.iconCellPx)
  })
  labelPlans.forEach((plan, i) => {
    const [x, y] = atlas.labelAt(plan.labelCell)
    setUv(plans.length + i, x, y, settings.labelCellWidthPx, settings.labelCellHeightPx)
  })
  const geometry = new BufferGeometry()
  const position = new BufferAttribute(positions, 3)
  position.setUsage(DynamicDrawUsage)
  geometry.setAttribute('position', position)
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setIndex(new BufferAttribute(index, 1))
  const mesh = new Mesh(geometry, material)
  mesh.name = 'pin-marks'
  mesh.userData.feature = PIN_MARKS_FEATURE
  // The quads move every view: bounds would be stale, so the mesh is never culled.
  mesh.frustumCulled = false
  mesh.renderOrder = 2
  mesh.raycast = () => {}

  const labelAspect = settings.labelCellWidthPx / settings.labelCellHeightPx
  let lastKey = ''
  let labelled: string[] = []

  /** Writes one camera-facing quad; `halfW`/`halfH` 0 collapses it (nothing drawn). */
  const writeQuad = (quad: number, centre: Vector3, halfW: number, halfH: number) => {
    const at = quad * 12
    const corners = [
      [-halfW, -halfH],
      [halfW, -halfH],
      [halfW, halfH],
      [-halfW, halfH],
    ] as const
    corners.forEach(([dx, dy], k) => {
      _corner
        .copy(centre)
        .addScaledVector(_right, dx)
        .addScaledVector(_up, dy)
        .toArray(positions, at + k * 3)
    })
  }

  const toScreen = (point: Vector3, camera: PerspectiveCamera, width: number, height: number) => {
    _ndc.copy(point).project(camera)
    return { x: ((_ndc.x + 1) / 2) * width, y: ((1 - _ndc.y) / 2) * height, z: _ndc.z }
  }

  const chipRects = (view: MarksView): Rect[] => {
    const chips = view.chips
    if (chips === null || !chips.visible) return []
    const attribute = chips.geometry.getAttribute('position')
    const rects: Rect[] = []
    for (let quad = 0; quad + 3 < attribute.count; quad += 4) {
      let left = Infinity
      let top = Infinity
      let right = -Infinity
      let bottom = -Infinity
      let behind = false
      for (let k = 0; k < 4; k++) {
        _corner.fromBufferAttribute(attribute, quad + k).applyMatrix4(chips.matrixWorld)
        const p = toScreen(_corner, view.camera, view.width, view.height)
        if (p.z > 1) behind = true
        left = Math.min(left, p.x)
        right = Math.max(right, p.x)
        top = Math.min(top, p.y)
        bottom = Math.max(bottom, p.y)
      }
      if (!behind) rects.push({ left, top, right, bottom })
    }
    return rects
  }

  return {
    mesh,
    update(view) {
      const { camera, width, height } = view
      if (view.pinHeight === 0 || width === 0 || height === 0) return false
      camera.updateMatrixWorld()
      const key = `${camera.matrixWorld.elements.join(',')}|${camera.projectionMatrix.elements.join(',')}|${view.pinHeight}|${width}x${height}|${view.chips?.visible === true}`
      if (key === lastKey) return false
      lastKey = key
      _right.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
      _up.setFromMatrixColumn(camera.matrixWorld, 1).normalize()
      _back.setFromMatrixColumn(camera.matrixWorld, 2).normalize()
      const eye = camera.getWorldPosition(new Vector3())
      const tanHalf = Math.tan((camera.fov * Math.PI) / 360) / camera.zoom
      const labelsOn = view.distance <= settings.labelMaxDistanceM

      const icons: Rect[] = []
      const candidates: LabelCandidate[] = []
      const centres: Vector3[] = []
      const metresPerPx: number[] = []
      plans.forEach((plan, i) => {
        const { pin } = plan
        _head.set(pin.x, view.headY(pin), -pin.y)
        _centre.copy(_head).addScaledVector(_back, settings.pullToCamera * view.pinHeight)
        const depth = -_back.dot(_corner.copy(_centre).sub(eye))
        const centre = _centre.clone()
        centres.push(centre)
        if (depth <= camera.near) {
          metresPerPx.push(0)
          writeQuad(i, centre, 0, 0)
          return
        }
        const mpp = (2 * depth * tanHalf) / height
        metresPerPx.push(mpp)
        const half = (settings.iconPx / 2) * mpp
        writeQuad(i, centre, half, half)
        const p = toScreen(centre, camera, width, height)
        const r = settings.iconPx / 2
        icons.push({ left: p.x - r, top: p.y - r, right: p.x + r, bottom: p.y + r })
        if (!labelsOn || plan.labelCell < 0) return
        const ground = Math.hypot(pin.x - view.target.x, -pin.y - view.target.z)
        if (ground > settings.labelRadiusM) return
        const lh = settings.labelPx
        const lw = lh * labelAspect
        const bottom = p.y - r - settings.labelGapPx
        // Whole on screen and below the HUD, or not at all: a clipped name reads as a glitch.
        if (p.x - lw / 2 < 0 || p.x + lw / 2 > width || bottom - lh < view.topInsetPx) return
        if (bottom > height) return
        candidates.push({
          index: i,
          distance: ground,
          rect: { left: p.x - lw / 2, top: bottom - lh, right: p.x + lw / 2, bottom },
        })
      })
      // The label's plate is narrower than its cell; the overlap test uses the cell (safe side).
      const shown = new Set(
        pickLabels(candidates, [...icons, ...chipRects(view)], settings.maxLabels),
      )
      labelled = []
      labelPlans.forEach((plan, i) => {
        const at = plans.indexOf(plan)
        const quad = plans.length + i
        const mpp = metresPerPx[at] ?? 0
        const centre = centres[at]
        if (!shown.has(at) || mpp === 0 || centre === undefined) {
          writeQuad(quad, _head.set(0, 0, 0), 0, 0)
          return
        }
        labelled.push(plan.pin.id)
        const halfH = (settings.labelPx / 2) * mpp
        const lift = (settings.iconPx / 2 + settings.labelGapPx) * mpp + halfH
        writeQuad(quad, _centre.copy(centre).addScaledVector(_up, lift), halfH * labelAspect, halfH)
      })
      position.needsUpdate = true
      return true
    },
    labelled: () => labelled,
    dispose() {
      geometry.dispose()
      material.dispose()
      texture.dispose()
    },
  }
}
