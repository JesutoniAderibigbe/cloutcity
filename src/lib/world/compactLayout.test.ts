import { describe, expect, it } from 'vitest'
import { compactLayout, plots, scene } from '@/lib/data/config'
import { homes } from '@/lib/data/content'
import { land, parks, subway, zoneShapes } from '@/lib/data/geo'
import { decodePath } from '@/lib/geo/codec'
import { prepareAreas, zoneAt } from '@/lib/geo/lookup'
import { distanceToPolyline } from '@/lib/geo/polygon'
import { project } from '@/lib/geo/projection'
import { planCompactLayout, type LayoutInput } from './compactLayout'
import { mapPlaces } from './places'
import { placesLayer } from './placesLayer'

const byBorough = compactLayout.clusterBy === 'borough'
const zones = prepareAreas(byBorough ? land.boroughs : zoneShapes.zones)
const parkAreas = prepareAreas(parks.parks)
const lines = subway.lines.flatMap((line) => line.paths.map((path) => decodePath(path)))
const homePoints = Object.values(homes).map((home) => {
  const point = project(home.location)
  return { x: Math.round(point.x), y: Math.round(point.y) }
})
const zoneOf = new Map(
  mapPlaces().map((place) => [place.id, byBorough ? place.borough : place.zoneId]),
)
const half = plots.plotM / 2
const corners = (p: { x: number; y: number }) => [
  p,
  { x: p.x - half, y: p.y - half },
  { x: p.x + half, y: p.y - half },
  { x: p.x - half, y: p.y + half },
  { x: p.x + half, y: p.y + half },
]

describe('compact game-map layout (S04n)', () => {
  const venues = placesLayer.pins.filter(
    (pin) => pin.kind === 'venue' && pin.style === 'normal' && plots.styles[pin.category],
  )
  const moved = venues.filter((pin) => pin.gx !== undefined)
  const fixed = venues.filter((pin) => compactLayout.fixedCategories.includes(pin.category))

  it('moves every plot venue but the fixed categories, and never a landmark', () => {
    expect(moved.length).toBe(venues.length - fixed.length)
    expect(fixed.every((pin) => pin.gx === undefined && pin.gy === undefined)).toBe(true)
    expect(
      placesLayer.pins.filter((pin) => pin.kind === 'landmark' && pin.gx !== undefined),
    ).toEqual([])
  })

  it('keeps each plot wholly inside its own cluster area, off parks and the subway', () => {
    for (const pin of moved) {
      const at = { x: pin.gx ?? 0, y: pin.gy ?? 0 }
      for (const point of corners(at)) {
        expect(zoneAt(point, zones), pin.id).toBe(zoneOf.get(pin.id))
        expect(zoneAt(point, parkAreas), pin.id).toBeUndefined()
      }
      for (const line of lines) {
        expect(distanceToPolyline(at, line), pin.id).toBeGreaterThanOrEqual(
          compactLayout.subwayClearM,
        )
      }
    }
  })

  it('never overlaps two plots and leaves a road between them', () => {
    expect(compactLayout.pitchM - plots.plotM).toBeGreaterThanOrEqual(2 * plots.clearM)
    const all = [
      ...homePoints,
      ...venues.map((pin) => ({ x: pin.gx ?? pin.x, y: pin.gy ?? pin.y })),
    ]
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]
        const b = all[j]
        if (a === undefined || b === undefined) continue
        const gap = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
        expect(gap).toBeGreaterThanOrEqual(compactLayout.pitchM - 1)
      }
    }
  })

  it("packs the start cluster (the home's borough or zone) around the home", () => {
    const home = project(homes['queens-room'].location)
    // S41: Queens' ~24 plot venues fill a block about six plots wide south of the home.
    const near = moved.filter(
      (pin) =>
        Math.hypot((pin.gx ?? 0) - home.x, (pin.gy ?? 0) - home.y) <= 6 * compactLayout.pitchM,
    )
    expect(near.length).toBe(
      moved.filter((pin) => zoneOf.get(pin.id) === (byBorough ? 'queens' : 'qn01')).length,
    )
  })

  it('is deterministic', () => {
    const input: LayoutInput = {
      venues: [
        { id: 'a', category: 'bodega', zoneId: 'z', x: 900, y: 0 },
        { id: 'b', category: 'gym', zoneId: 'z', x: -900, y: 0 },
        { id: 's', category: 'subway-station', zoneId: 'z', x: 0, y: 500 },
      ],
      homes: [{ id: 'h', zoneId: 'z', x: 0, y: 0 }],
      landmarks: [],
      zones: [{ id: 'z', polygons: [{ rings: [square(2000)], bbox: box(2000) }] }],
      parks: [],
      lines: [],
      plotM: plots.plotM,
    }
    const centred = { ...compactLayout, centreOffsetM: { x: 0, y: 0 } }
    const first = planCompactLayout(input, centred)
    expect(planCompactLayout(input, centred)).toEqual(first)
    // The home holds the centre slot; the fixed station keeps its place and gets no entry.
    expect(first.has('s')).toBe(false)
    expect(first.get('a')).toEqual({ x: compactLayout.pitchM, y: 0 })
    expect(first.get('b')).toEqual({ x: -compactLayout.pitchM, y: 0 })
    // The centre offset moves the cluster, on the grid.
    const south = planCompactLayout(input, {
      ...compactLayout,
      centreOffsetM: { x: 0, y: -2 * compactLayout.pitchM },
    })
    expect([...south.values()].every((p) => p.y < 0 && p.y % compactLayout.pitchM === 0)).toBe(true)
  })

  it('keeps a venue at its real point when no slot fits', () => {
    const tiny = {
      venues: [{ id: 'a', category: 'bodega', zoneId: 'z', x: 0, y: 0 }],
      homes: [],
      landmarks: [],
      zones: [{ id: 'z', polygons: [{ rings: [square(10)], bbox: box(10) }] }],
      parks: [],
      lines: [],
      plotM: plots.plotM,
    }
    expect(planCompactLayout(tiny, compactLayout).size).toBe(0)
  })
})

function square(r: number) {
  return [
    { x: -r, y: -r },
    { x: r, y: -r },
    { x: r, y: r },
    { x: -r, y: r },
  ]
}
function box(r: number) {
  return { minX: -r, minY: -r, maxX: r, maxY: r }
}

describe('the game map camera on a wide screen (S04p)', () => {
  it('starts over the cluster centre the layout gathers venues around', () => {
    expect(scene.mapStyles.game.camera.wideStartOffsetM).toEqual(compactLayout.centreOffsetM)
    // The real style has no cluster: it starts over the home.
    expect(scene.mapStyles.real.camera.wideStartOffsetM).toBeUndefined()
  })
})
