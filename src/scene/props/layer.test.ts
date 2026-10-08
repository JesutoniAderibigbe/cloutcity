import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BoxGeometry, BufferAttribute, Matrix4, MeshBasicMaterial, Mesh } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { props, scene } from '@/lib/data/config'
import { streetPropsAssets } from '@/lib/data/districts'
import { project } from '@/lib/geo/projection'
import { createWindowMask } from '../buildings/materials'
import type { LoadedModel } from '../models/prepare'
import { createStreetPropsLayer, noRaycast, propsSettings, type StreetPropsLayer } from './layer'

const ROOT = join(import.meta.dirname, '../../..')
const streets = JSON.parse(
  readFileSync(join(ROOT, 'data/geo/streets.derived.json'), 'utf8'),
) as unknown
const assets = streetPropsAssets('mid')
if (assets === null) throw new Error('mid draws street props')
const home = project({ lat: 40.7651, lng: -73.9247 })

function box(): LoadedModel {
  const geometry = new BoxGeometry(1, 1, 1)
  const count = geometry.getAttribute('position').count
  geometry.setAttribute('color', new BufferAttribute(new Uint8Array(count * 3).fill(200), 3, true))
  geometry.setAttribute(
    '_emissive',
    new BufferAttribute(new Uint8Array(count * 3).fill(255), 3, true),
  )
  return { kind: 'static', geometry, matrix: new Matrix4(), triangles: 12 }
}

function layerWith(overrides: { fetchJson?: (url: string) => Promise<unknown> } = {}) {
  const fetched: string[] = []
  const release = vi.fn()
  const onChange = vi.fn()
  const material = new MeshBasicMaterial()
  const layer = createStreetPropsLayer({
    assets: assets!,
    tier: 'mid',
    buildings: scene.buildings,
    mask: createWindowMask(scene.buildings),
    cacheMaxEntries: 8,
    material,
    groundY: 2,
    pins: [],
    prepare: async () => undefined,
    onChange,
    fetchJson:
      overrides.fetchJson ??
      (async (url) => {
        fetched.push(url)
        return streets
      }),
    loadModels: (refs) => ({ models: Promise.resolve(refs.map(() => box())), release }),
    yieldFn: async () => undefined,
  })
  return { layer, fetched, release, onChange, material }
}

async function settle(layer: StreetPropsLayer) {
  for (let i = 0; i < 400 && layer.view().busy; i++) await new Promise((r) => setTimeout(r, 5))
}

describe('street props layer', () => {
  it('fetches nothing until the camera comes within the prefetch distance', async () => {
    const { layer, fetched } = layerWith()
    layer.setView(props.prefetchBelowDistanceM.mid + 1, home)
    await settle(layer)
    expect(fetched).toEqual([])
    expect(layer.view().status).toBe('idle')
    layer.setView(props.prefetchBelowDistanceM.mid, home)
    await settle(layer)
    expect(fetched).toEqual([assets!.url])
    expect(layer.view().status).toBe('ready')
    // Loaded but above the show distance: nothing drawn.
    expect(layer.view().chunksDrawn).toBe(0)
    layer.dispose()
  })

  it('draws the nearest chunks within the caps, on the given material, never pickable', async () => {
    const { layer, material, onChange } = layerWith()
    layer.setView(props.showBelowDistanceM.mid, home)
    await settle(layer)
    const view = layer.view()
    const { caps } = propsSettings('mid')
    expect(view.chunksDrawn).toBeGreaterThan(0)
    expect(view.chunksDrawn).toBeLessThanOrEqual(caps.drawCallsMax)
    const distances = view.chunks.map((c) => c.distance)
    expect(distances).toEqual([...distances].sort((a, b) => a - b))
    for (const [model, n] of Object.entries(view.instances)) {
      expect(n).toBeLessThanOrEqual(caps.instancesMax[model] ?? 0)
    }
    expect(view.triangles).toBeLessThanOrEqual(caps.trianglesMax)
    // The fake streetlight and taxi glow everywhere; every other model none.
    expect(view.glowVertices).toBeGreaterThan(0)
    for (const mesh of layer.meshes()) {
      expect(mesh).toBeInstanceOf(Mesh)
      expect(mesh.material).toBe(material)
      expect(mesh.raycast).toBe(noRaycast)
    }
    expect(onChange).toHaveBeenCalled()

    // Zoomed out again: hidden, one redraw, and nothing more on a repeat of the same view.
    onChange.mockClear()
    layer.setView(props.showBelowDistanceM.mid + 1, home)
    expect(layer.view().chunksDrawn).toBe(0)
    expect(onChange).toHaveBeenCalledTimes(1)
    layer.setView(props.showBelowDistanceM.mid + 1, home)
    expect(onChange).toHaveBeenCalledTimes(1)
    layer.dispose()
  })

  it('drops street props inside fill blocks that arrive after the props drew (S04i)', async () => {
    const { layer, onChange } = layerWith()
    layer.setView(props.showBelowDistanceM.mid, home)
    await settle(layer)
    expect(Object.keys(layer.view().instances).length).toBeGreaterThan(0)
    onChange.mockClear()
    // One 4 km block over the whole focus area.
    layer.setBlocks({
      sizeM: 4000,
      groups: [{ angleDeg: 0, p: [Math.round(home.x), Math.round(home.y)] }],
    })
    await settle(layer)
    expect(layer.view().instances).toEqual({})
    expect(onChange).toHaveBeenCalled()
    layer.dispose()
  })

  it('adds roof water towers from district masses, on the tower rule', async () => {
    const { layer } = layerWith()
    const ring = (x: number, y: number) => [
      [
        { x: x - 15, y: y - 15 },
        { x: x + 15, y: y - 15 },
        { x: x + 15, y: y + 15 },
        { x: x - 15, y: y + 15 },
      ],
    ]
    const masses = Array.from({ length: 200 }, (_, i) => ({
      h: 30,
      rings: ring(home.x + (i % 10) * 20 - 100, home.y + Math.floor(i / 10) * 20 - 200),
    }))
    layer.addTowers('astoria', masses)
    layer.setView(props.showBelowDistanceM.mid, home)
    await settle(layer)
    expect(layer.view().instances['water-tower'] ?? 0).toBeGreaterThan(0)
    layer.dispose()
  })

  it('fails quietly on a bad streets file and releases the models', async () => {
    const { layer, release } = layerWith({ fetchJson: async () => ({ nope: true }) })
    layer.setView(props.showBelowDistanceM.mid, home)
    await settle(layer)
    expect(layer.view().status).toBe('failed')
    expect(release).toHaveBeenCalled()
    expect(layer.meshes()).toEqual([])
    layer.dispose()
  })

  it('dispose releases the models and empties the group', async () => {
    const { layer, release } = layerWith()
    layer.setView(props.showBelowDistanceM.mid, home)
    await settle(layer)
    layer.dispose()
    expect(release).toHaveBeenCalled()
    expect(layer.meshes()).toEqual([])
  })
})

describe('street props assets', () => {
  it('low draws none; mid and high name a GLB per placed model, none capped at 0', () => {
    expect(streetPropsAssets('low')).toBeNull()
    expect(Object.keys(assets!.files)).not.toContain('hatchback')
    expect(Object.keys(streetPropsAssets('high')?.files ?? {})).toContain('hatchback')
    expect(assets!.url).toMatch(/^\/geo\/streets\?v=[0-9a-f]{12}$/)
    expect(assets!.prefetchBelowDistanceM).toBe(props.prefetchBelowDistanceM.mid)
  })
})
