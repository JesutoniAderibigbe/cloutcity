/**
 * Name chips of the modelled landmarks (S07a): one flat rounded plate per landmark floating
 * above its model, all quads in one geometry sampling one runtime atlas (one draw call). The
 * names are the server's copy, passed in as props (generic labels for generic-name landmarks,
 * CLAUDE.md "Map and landmarks"); the models carry no text. three only, no React; the atlas
 * needs a 2D canvas (browser).
 */
import { BufferAttribute, BufferGeometry, CanvasTexture, Matrix4, SRGBColorSpace } from 'three'
import type { SceneConfig } from '@/lib/data/schemas/scene'
import { LAY_FLAT_X } from '../geo/coords'

const FONT_STACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

type ChipConfig = SceneConfig['landmarkChips']

/** The chips mesh's name: pin labels (src/scene/pins/buildPinMarks.ts) keep clear of it. */
export const LANDMARK_CHIPS_NAME = 'landmark-name-chips'

export interface NameChip {
  /** Local metres of the chip's centre (x east, y north). */
  readonly x: number
  readonly y: number
  /** Scene height of the chip. */
  readonly height: number
  readonly text: string
}

/** The atlas: one row per chip, a rounded plate in `fill` with the name in `ink`. */
export function createNameAtlas(
  texts: readonly string[],
  fill: string,
  ink: string,
  chips: ChipConfig,
): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = chips.atlasWidthPx
  canvas.height = Math.max(1, texts.length) * chips.cellHeightPx
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('landmark chips: 2D canvas is unavailable')
  const width = canvas.width
  const cell = chips.cellHeightPx
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.font = `800 ${Math.round(cell * chips.fontScale)}px ${FONT_STACK}`
  texts.forEach((text, row) => {
    const top = row * cell
    context.fillStyle = fill
    context.beginPath()
    context.roundRect(0, top + cell * 0.08, width, cell * 0.84, cell * chips.cornerRadius)
    context.fill()
    context.fillStyle = ink
    context.fillText(text, width / 2, top + cell / 2, width * chips.textMaxWidth)
  })
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/**
 * How large chips draw at a camera distance (S07c): full size from `fullSizeDistanceM` out,
 * shrinking in proportion closer in, never below `minScale`.
 */
export function chipScale(
  distanceM: number,
  size: Pick<ChipConfig, 'fullSizeDistanceM' | 'minScale'>,
): number {
  return Math.min(1, Math.max(size.minScale, distanceM / size.fullSizeDistanceM))
}

const _flat = new Matrix4().makeRotationX(LAY_FLAT_X)

/**
 * Writes every chip's quad, `scale` times its configured size about its own centre, into a
 * position attribute (in the XY plane, then laid flat like the rest of the map).
 */
export function writeChipPositions(
  positions: BufferAttribute,
  chips: readonly NameChip[],
  size: Pick<ChipConfig, 'widthM' | 'heightM'>,
  scale = 1,
): void {
  const halfW = (size.widthM / 2) * scale
  const halfH = (size.heightM / 2) * scale
  const array = positions.array
  chips.forEach((chip, i) => {
    const west = chip.x - halfW
    const east = chip.x + halfW
    const south = chip.y - halfH
    const north = chip.y + halfH
    // In the XY plane (x east, y north, z up) before laying flat: z carries the height.
    array.set(
      [
        west,
        south,
        chip.height,
        east,
        south,
        chip.height,
        east,
        north,
        chip.height,
        west,
        north,
        chip.height,
      ],
      i * 12,
    )
  })
  positions.applyMatrix4(_flat)
  positions.needsUpdate = true
}

/** One flat quad per chip (facing up, reading north-up), each sampling its atlas row. */
export function buildNameChipGeometry(
  chips: readonly NameChip[],
  size: Pick<ChipConfig, 'widthM' | 'heightM'>,
): BufferGeometry {
  const positions = new BufferAttribute(new Float32Array(chips.length * 12), 3)
  const uvs = new Float32Array(chips.length * 8)
  const index = new Uint16Array(chips.length * 6)
  const rows = Math.max(1, chips.length)
  writeChipPositions(positions, chips, size)
  chips.forEach((_chip, i) => {
    // Canvas rows run top-down; texture v runs bottom-up.
    const bottom = 1 - (i + 1) / rows
    const top = 1 - i / rows
    uvs.set([0, bottom, 1, bottom, 1, top, 0, top], i * 8)
    const v = i * 4
    index.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6)
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', positions)
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setIndex(new BufferAttribute(index, 1))
  geometry.computeBoundingSphere()
  return geometry
}
