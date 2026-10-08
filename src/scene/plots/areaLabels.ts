/**
 * The game map's area names (S04m): "EAST RIVER" painted flat on the water and neighbourhood
 * names floating flat just over the flattened background, like a game map's big labels. One
 * mesh of ground-aligned quads over one runtime atlas, drawn with an unlit MeshBasicMaterial with
 * a map and alphaTest: the settings the name and "expanding soon" chips already compile, so the
 * names add one draw call and no shader program. Never pickable; part of the lazy plots chunk.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  SRGBColorSpace,
} from 'three'
import type { PlotsConfig } from '@/lib/data/schemas/scene'
import type { AreaName } from '@/lib/world/mapDressing'

const FONT_STACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

export interface AreaLabelsObjects {
  readonly mesh: Mesh
  dispose(): void
}

/**
 * Builds the names. `waterY` and `landY` are the water plane's and the land top's heights;
 * `hex` resolves a theme token (the page's plot colours).
 */
export function buildAreaLabels(
  names: readonly AreaName[],
  config: PlotsConfig['areas'],
  waterY: number,
  landY: number,
  hex: (token: string) => string,
): AreaLabelsObjects | null {
  if (names.length === 0) return null
  const font = `800 ${config.fontPx}px ${FONT_STACK}`
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (context === null) return null
  const rowH = Math.ceil(config.fontPx * 1.4)
  const pad = Math.ceil(config.fontPx * 0.3)
  const spacing = config.fontPx * config.letterSpacing
  context.font = font
  // Letter-spaced capitals, measured one character at a time (canvas letterSpacing is not
  // everywhere yet).
  const lines = names.map((name) => {
    const chars = [...name.text.toLocaleUpperCase('en-US')]
    const widths = chars.map((char) => context.measureText(char).width)
    const width = widths.reduce((sum, w) => sum + w, 0) + spacing * Math.max(0, chars.length - 1)
    return { name, chars, widths, width: Math.ceil(width) + 2 * pad }
  })
  canvas.width = Math.min(4096, Math.max(...lines.map((line) => line.width)))
  canvas.height = rowH * lines.length
  context.font = font
  context.textBaseline = 'middle'
  context.lineJoin = 'round'
  lines.forEach((line, row) => {
    const look = config[line.name.kind]
    const y = row * rowH + rowH / 2
    let x = pad
    line.chars.forEach((char, i) => {
      if (look.halo !== null && look.haloWidth > 0) {
        context.strokeStyle = hex(look.halo)
        context.lineWidth = config.fontPx * look.haloWidth
        context.strokeText(char, x, y)
      }
      context.fillStyle = hex(look.fill)
      context.fillText(char, x, y)
      x += (line.widths[i] ?? 0) + spacing
    })
  })
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace

  const positions = new Float32Array(lines.length * 12)
  const uvs = new Float32Array(lines.length * 8)
  const index = new Uint16Array(lines.length * 6)
  lines.forEach((line, i) => {
    const look = config[line.name.kind]
    const height = look.heightM * (rowH / config.fontPx)
    const width = height * (line.width / rowH)
    const angle = (line.name.angleDeg * Math.PI) / 180
    const ux = Math.cos(angle)
    const uy = Math.sin(angle)
    const y = (line.name.kind === 'water' ? waterY : landY) + look.liftM
    // Corners in local metres (x east, y north), then scene space (x, y up, z = -north).
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const
    corners.forEach(([sx, sy], k) => {
      const dx = (sx * width) / 2
      const dy = (sy * height) / 2
      const px = line.name.x + dx * ux - dy * uy
      const py = line.name.y + dx * uy + dy * ux
      positions.set([px, y, -py], i * 12 + k * 3)
    })
    const u1 = line.width / canvas.width
    const v0 = 1 - ((i + 1) * rowH) / canvas.height
    const v1 = 1 - (i * rowH) / canvas.height
    uvs.set([0, v0, u1, v0, u1, v1, 0, v1], i * 8)
    const v = i * 4
    index.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6)
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setIndex(new BufferAttribute(index, 1))
  geometry.computeBoundingSphere()
  const material = new MeshBasicMaterial({
    map: texture,
    alphaTest: config.alphaTest,
    depthWrite: false,
  })
  const mesh = new Mesh(geometry, material)
  mesh.name = 'area-names'
  mesh.raycast = () => {}
  mesh.matrixAutoUpdate = false
  // Over the ground and the water, under the buildings that stand above them.
  mesh.renderOrder = 1
  return {
    mesh,
    dispose() {
      geometry.dispose()
      material.dispose()
      texture.dispose()
    },
  }
}
