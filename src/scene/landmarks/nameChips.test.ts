import { describe, expect, it } from 'vitest'
import { scene } from '@/lib/data/config'
import { landmarks } from '@/lib/data/content'
import { landmarksLayer } from '@/lib/world/landmarksLayer'
import { mapPlaces, placeName } from '@/lib/world/places'
import { BufferAttribute } from 'three'
import { buildNameChipGeometry, chipScale, writeChipPositions } from './nameChips'

describe('landmark name chips', () => {
  it('lies one flat quad per chip at its height, each sampling its own atlas row', () => {
    const chips = [
      { x: 0, y: 0, height: 50, text: 'a' },
      { x: 1000, y: 500, height: 80, text: 'b' },
    ]
    const geometry = buildNameChipGeometry(chips, scene.landmarkChips)
    const pos = geometry.getAttribute('position')
    const uv = geometry.getAttribute('uv')
    expect(pos.count).toBe(8)
    expect(pos.getY(0)).toBe(50)
    expect(pos.getY(4)).toBe(80)
    // North is -z once laid flat.
    expect(pos.getZ(6)).toBeCloseTo(-(500 + scene.landmarkChips.heightM / 2), 6)
    expect([uv.getY(0), uv.getY(2)]).toEqual([0.5, 1])
    expect([uv.getY(4), uv.getY(6)]).toEqual([0, 0.5])
  })

  it('names generic-name landmarks only by their generic copy label (LEGAL-1)', () => {
    const modelled = new Set(landmarksLayer.models.map((m) => m.id))
    for (const place of mapPlaces().filter((p) => modelled.has(p.id))) {
      const landmark = landmarks.find((l) => l.id === place.id)
      expect(landmark?.nameMode, place.id).toBeDefined()
      // The chip text is the copy name; the model data carries none.
      expect(placeName(place).length).toBeGreaterThan(0)
      expect(JSON.stringify(landmarksLayer.models.find((m) => m.id === place.id))).not.toContain(
        placeName(place),
      )
    }
  })
})

describe('chip size at focus distance (S07c)', () => {
  const size = { widthM: 1000, heightM: 200, fullSizeDistanceM: 4500, minScale: 0.35 }
  it('is full size from the full-size distance out and shrinks closer in, never below the floor', () => {
    expect(chipScale(6000, size)).toBe(1)
    expect(chipScale(4500, size)).toBe(1)
    expect(chipScale(2250, size)).toBe(0.5)
    expect(chipScale(300, size)).toBe(0.35)
  })

  it('shrinks each chip about its own centre', () => {
    const chips = [{ x: 100, y: 200, height: 30, text: 'A' }]
    const geometry = buildNameChipGeometry(chips, size)
    const positions = geometry.getAttribute('position')
    if (!(positions instanceof BufferAttribute)) throw new Error('no positions')
    writeChipPositions(positions, chips, size, 0.5)
    const xs = [0, 1, 2, 3].map((i) => positions.getX(i))
    expect(Math.min(...xs)).toBeCloseTo(-150)
    expect(Math.max(...xs)).toBeCloseTo(350)
    const ys = [0, 1, 2, 3].map((i) => positions.getY(i))
    expect(ys.every((y) => Math.abs(y - 30) < 1e-6)).toBe(true)
  })
})
