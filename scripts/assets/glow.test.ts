/**
 * Which hand-made models glow at night, and in which colours (S04f night-glow contract on S04h
 * models). Pinned so a catalog or pack change cannot quietly light up the wrong surfaces again:
 * GLOW-1 found Kenney's commercial buildings paint trim, frames and glass with one grey, so their
 * glow keeps only the window panes set back into the facade (recess.ts, `glowRule: recessed`),
 * and the taxi's hood highlight sat next to the lamp colour, so a tight remap pins it to taxi
 * yellow (only the roof sign glows).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type BufferAttribute, Color, Mesh, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { describe, expect, it } from 'vitest'
import { ModelManifestSchema } from '../../src/lib/data/schemas/assets.ts'

const ROOT = join(import.meta.dirname, '../..')
const read = (file: string): unknown => JSON.parse(readFileSync(join(ROOT, file), 'utf8'))
const manifest = ModelManifestSchema.parse(read('data/assets/manifest.json'))
const theme = read('data/config/theme.json') as { models: Record<string, string> }
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)

/** Model id → the theme tokens its night glow may use. */
const GLOWING: Readonly<Record<string, readonly string[]>> = {
  taxi: ['lamp-200'],
  sedan: ['lamp-200'],
  hatchback: ['lamp-200'],
  streetlight: ['lamp-200'],
  'traffic-light': ['signal-500', 'amber-400', 'go-500'],
  'block-a': ['window-200'],
  'block-b': ['window-200'],
  'block-c': ['window-200'],
  'block-d': ['window-200'],
  'block-e': ['window-200'],
  'block-f': ['window-200'],
  'building-a': ['window-200'],
  'building-b': ['window-200'],
  'building-c': ['window-200'],
  'building-d': ['window-200'],
  'floor-lamp': ['lamp-200'],
  'table-lamp': ['lamp-200'],
}

/** Every triangle of a model in world space, with whether its corners glow. */
async function trianglesOf(file: string) {
  const bytes = readFileSync(join(ROOT, 'public', file))
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  )
  gltf.scene.updateMatrixWorld(true)
  const out: { v: Vector3[]; normal: Vector3; area: number; glows: boolean }[] = []
  gltf.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const geometry = object.geometry
    const position = geometry.getAttribute('position')
    const glow = geometry.getAttribute('_emissive') as BufferAttribute | undefined
    const index = geometry.getIndex()
    const count = index ? index.count : position.count
    for (let t = 0; t < count; t += 3) {
      const corners = [0, 1, 2].map((k) => (index ? index.getX(t + k) : t + k))
      const v = corners.map((i) =>
        new Vector3().fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld),
      )
      const [a, b, c] = v as [Vector3, Vector3, Vector3]
      const cross = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a))
      const area = cross.length() / 2
      if (area === 0) continue
      const glows =
        glow !== undefined &&
        corners.some((i) => glow.getX(i) + glow.getY(i) + glow.getZ(i) > 0)
      out.push({ v, normal: cross.normalize(), area, glows })
    }
  })
  return out
}

async function glowOf(file: string) {
  const bytes = readFileSync(join(ROOT, 'public', file))
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  )
  gltf.scene.updateMatrixWorld(true)
  const colours = new Set<string>()
  const points: Vector3[] = []
  gltf.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const glow = object.geometry.getAttribute('_emissive') as BufferAttribute | undefined
    if (glow === undefined) return
    const position = object.geometry.getAttribute('position')
    for (let i = 0; i < glow.count; i++) {
      const rgb = [glow.getX(i), glow.getY(i), glow.getZ(i)]
      if (rgb.every((v) => v === 0)) continue
      colours.add(rgb.map((v) => Math.round(v * 255)).join(','))
      points.push(new Vector3().fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld))
    }
  })
  return { colours, points }
}

/** A token's colour as the build stores `_EMISSIVE`: linear RGB, 8-bit. */
function tokenGlow(token: string): string {
  const hex = theme.models[token]
  if (hex === undefined) throw new Error(`unknown token ${token}`)
  const c = new Color(hex)
  return [c.r, c.g, c.b].map((v) => Math.round(v * 255)).join(',')
}

describe('night glow per model', () => {
  it('only the listed models carry `_EMISSIVE`', () => {
    const glowing = manifest.models.filter((model) => model.emissive).map((model) => model.id)
    expect(glowing.sort()).toEqual(Object.keys(GLOWING).sort())
  })

  it.each(manifest.models.filter((model) => model.emissive).map((model) => [model.id, model]))(
    '%s glows only in its tokens on every tier',
    async (id, model) => {
      const allowed = new Set((GLOWING[id] ?? []).map(tokenGlow))
      for (const tier of ['low', 'mid', 'high'] as const) {
        const { colours } = await glowOf(model.tiers[tier].file)
        expect(colours.size, `${id} ${tier}`).toBeGreaterThan(0)
        for (const colour of colours) expect(allowed, `${id} ${tier} ${colour}`).toContain(colour)
      }
    },
  )

  it('the taxi glows only at its roof sign, not on the hood', async () => {
    const taxi = manifest.models.find((model) => model.id === 'taxi')
    if (taxi?.bounds === undefined) throw new Error('taxi missing')
    const roof = taxi.bounds.max[1] * 0.75
    for (const tier of ['low', 'high'] as const) {
      const { points } = await glowOf(taxi.tiers[tier].file)
      expect(points.length).toBeGreaterThan(0)
      for (const point of points) expect(point.y, `taxi ${tier}`).toBeGreaterThan(roof)
    }
  })

  it.each(['building-a', 'building-b', 'building-c', 'building-d'])(
    '%s glows only in window panes set back into its facade (GLOW-1)',
    async (id) => {
      const model = manifest.models.find((entry) => entry.id === id)
      if (model === undefined) throw new Error(`${id} missing`)
      for (const tier of ['low', 'mid', 'high'] as const) {
        const triangles = await trianglesOf(model.tiers[tier].file)
        const glowing = triangles.filter((t) => t.glows)
        expect(glowing.length, `${id} ${tier}`).toBeGreaterThan(0)
        const faceArea = new Map<string, { all: number; glow: number }>()
        for (const t of glowing) {
          // Panes are vertical; sills, roofs and soffits never glow.
          expect(Math.abs(t.normal.y), `${id} ${tier} vertical`).toBeLessThan(0.3)
          // Never on the outermost plane in its direction (frames and trim bands stand there).
          const depth = t.v[0]?.dot(t.normal) ?? 0
          const outermost = Math.max(...triangles.flatMap((u) => u.v.map((p) => p.dot(t.normal))))
          expect(depth, `${id} ${tier} recessed`).toBeLessThan(outermost - 0.05)
        }
        for (const t of triangles) {
          if (Math.abs(t.normal.y) >= 0.3) continue
          const key = [t.normal.x, t.normal.z].map((n) => Math.round(n)).join(',')
          const entry = faceArea.get(key) ?? { all: 0, glow: 0 }
          entry.all += t.area
          if (t.glows) entry.glow += t.area
          faceArea.set(key, entry)
        }
        // The main facade (the side with the most glass) reads as windows, not a lit wall.
        const front = [...faceArea.values()].sort((a, b) => b.glow - a.glow)[0]
        const share = front === undefined ? 0 : front.glow / front.all
        expect(share, `${id} ${tier} glass share`).toBeGreaterThan(0.03)
        expect(share, `${id} ${tier} glass share`).toBeLessThan(0.6)
      }
    },
  )
})
