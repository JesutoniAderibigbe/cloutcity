import { describe, expect, it } from 'vitest'
import { compactLayout, plots, scene } from '@/lib/data/config'
import { homes } from '@/lib/data/content'
import { land, parks, subway } from '@/lib/data/geo'
import type { LandmarkRingConfig } from '@/lib/data/schemas/scene'
import { decodePath } from '@/lib/geo/codec'
import { prepareAreas, zoneAt } from '@/lib/geo/lookup'
import { distanceToPolyline } from '@/lib/geo/polygon'
import { project } from '@/lib/geo/projection'
import { footprintRadius, planLandmarkRing, type RingInput } from './landmarkRing'
import { placesLayer } from './placesLayer'

// S07d: the game map's famous-places ring around the start home's cluster.
const ring = compactLayout.landmarkRing as LandmarkRingConfig
const ringPins = placesLayer.pins.filter((pin) => pin.game !== undefined)
const lines = subway.lines.flatMap((line) => line.paths.map((path) => decodePath(path)))
const parkAreas = prepareAreas(parks.parks)
const boroughs = prepareAreas(land.boroughs)
const home = homes[ring.aroundHome as keyof typeof homes]

describe('famous-places ring on the game map (S07d)', () => {
  it('places every configured landmark, and moves no other landmark', () => {
    expect(ringPins.map((pin) => pin.id).sort()).toEqual(
      ring.landmarks.map((entry) => entry.id).sort(),
    )
    for (const pin of placesLayer.pins.filter((p) => p.kind === 'landmark')) {
      expect(pin.gx !== undefined, pin.id).toBe(pin.game !== undefined)
    }
  })

  it('keeps the real point for travel: x/y are untouched', () => {
    for (const pin of ringPins) {
      expect(Math.hypot((pin.gx ?? 0) - pin.x, (pin.gy ?? 0) - pin.y), pin.id).toBeGreaterThan(0)
    }
  })

  it('stands each footprint near the home, wholly on its borough, off parks and the subway', () => {
    const at = project(home.location)
    for (const pin of ringPins) {
      const centre = { x: pin.gx ?? 0, y: pin.gy ?? 0 }
      const radius = pin.game?.clearM ?? 0
      expect(Math.hypot(centre.x - at.x, centre.y - at.y), pin.id).toBeLessThan(ring.maxM)
      for (let k = 0; k < 16; k++) {
        const angle = (k / 16) * Math.PI * 2
        const point = {
          x: centre.x + radius * Math.cos(angle),
          y: centre.y + radius * Math.sin(angle),
        }
        expect(zoneAt(point, boroughs), pin.id).toBe(home.borough)
        expect(zoneAt(point, parkAreas), pin.id).toBeUndefined()
      }
      for (const line of lines) {
        expect(distanceToPolyline(centre, line), pin.id).toBeGreaterThanOrEqual(
          radius + compactLayout.subwayClearM - 1,
        )
      }
    }
  })

  it('never overlaps a plot, a home or another ring landmark', () => {
    const half = plots.plotM / 2 + plots.clearM
    const squares = [
      ...placesLayer.pins
        .filter((pin) => pin.kind === 'venue')
        .map((pin) => ({ x: pin.gx ?? pin.x, y: pin.gy ?? pin.y })),
      ...Object.values(homes).map((h) => project(h.location)),
    ]
    for (const pin of ringPins) {
      const centre = { x: pin.gx ?? 0, y: pin.gy ?? 0 }
      const radius = pin.game?.clearM ?? 0
      for (const square of squares) {
        const dx = Math.max(0, Math.abs(centre.x - square.x) - half)
        const dy = Math.max(0, Math.abs(centre.y - square.y) - half)
        expect(Math.hypot(dx, dy), pin.id).toBeGreaterThanOrEqual(radius + ring.gapM - 1)
      }
      for (const other of ringPins) {
        if (other === pin) continue
        const gap = Math.hypot((other.gx ?? 0) - centre.x, (other.gy ?? 0) - centre.y)
        expect(gap, `${pin.id}/${other.id}`).toBeGreaterThanOrEqual(
          radius + (other.game?.clearM ?? 0) + ring.gapM - 1,
        )
      }
    }
  })

  it('draws the models at their game scale with the pin lifted over the scaled model', () => {
    for (const pin of ringPins) {
      const entry = ring.landmarks.find((candidate) => candidate.id === pin.id)
      expect(pin.game?.scale, pin.id).toBe(entry?.scale ?? ring.scale)
      expect(pin.game?.liftM ?? 0, pin.id).toBeLessThanOrEqual(pin.liftM ?? 0)
      expect(pin.badge, pin.id).toBe(true)
    }
  })

  it('puts the harbour statue on its pond', () => {
    const statue = ringPins.find((pin) => pin.id === 'statue-of-liberty')
    const entry = ring.landmarks.find((candidate) => candidate.id === 'statue-of-liberty')
    expect(statue?.game?.pondM).toBe(entry?.pondM)
    expect(statue?.game?.clearM).toBeGreaterThanOrEqual(entry?.pondM ?? Infinity)
  })

  it('keeps every ring landmark playable and look-only stops in place', () => {
    for (const pin of ringPins) {
      expect(pin.style, pin.id).toBe('normal')
      expect(pin.category, pin.id).not.toBe('memorial')
    }
  })

  it('keeps ring name chips from overlapping from the game map pitch', () => {
    const chips = scene.landmarkChips
    const placed = placesLayer.pins
      .filter((pin) => pin.kind === 'landmark' && pin.badge === true)
      .map((pin) => ({
        x: pin.gx ?? pin.x,
        y: (pin.gy ?? pin.y) + (pin.game?.chipShiftM ?? 0),
        lift: pin.game?.liftM ?? pin.liftM ?? 0,
        id: pin.id,
      }))
    const rise = Math.tan((scene.mapStyles.game.camera.polarDeg * Math.PI) / 180)
    for (const a of placed) {
      for (const b of placed) {
        if (a.id >= b.id) continue
        const ay = a.y + a.lift * rise
        const by = b.y + b.lift * rise
        const apart = Math.abs(a.x - b.x) >= chips.widthM || Math.abs(ay - by) >= chips.heightM
        expect(apart, `${a.id}/${b.id}`).toBe(true)
      }
    }
  })
})

describe('planLandmarkRing', () => {
  const [field] = prepareAreas([
    { id: 'field', polygons: [[[-2000, -2000, 4000, 0, 0, 4000, -4000, 0]]] },
  ])
  if (field === undefined) throw new Error('no field')
  const config: LandmarkRingConfig = {
    aroundHome: 'queens-room',
    scale: 0.5,
    gapM: 10,
    maxM: 1500,
    stepM: 10,
    sweepDeg: 30,
    sweepStepDeg: 5,
    landmarks: [
      { id: 'a', bearingDeg: 0 },
      { id: 'b', bearingDeg: 0 },
      { id: 'c', bearingDeg: 90, pondM: 60 },
    ],
  }
  const input: RingInput = {
    centre: { x: 0, y: 0 },
    candidates: [
      { id: 'a', radiusM: 100 },
      { id: 'b', radiusM: 100 },
      { id: 'c', radiusM: 40 },
    ],
    squares: [{ x: 0, y: 0, half: 100 }],
    obstacles: [],
    land: field,
    parks: [],
    lines: [],
    subwayClearM: 20,
  }

  it('walks out along each bearing to the first spot that fits, deterministically', () => {
    const placed = planLandmarkRing(input, config)
    expect(placed).toEqual(planLandmarkRing(input, config))
    const a = placed.find((entry) => entry.id === 'a')
    // 100 (square) + 10 (gap) + 50 (the half-size footprint): 160 north.
    expect(a).toMatchObject({ x: 0, y: 160, scale: 0.5, clearM: 50 })
    const b = placed.find((entry) => entry.id === 'b')
    expect(b).toBeDefined()
    expect(Math.hypot((b?.x ?? 0) - 0, (b?.y ?? 0) - 160)).toBeGreaterThanOrEqual(110)
    const c = placed.find((entry) => entry.id === 'c')
    // The pond is the footprint: 100 + 10 + 60.
    expect(c).toMatchObject({ x: 170, y: 0, clearM: 60, pondM: 60 })
  })

  it('leaves out a landmark no spot fits (it keeps its real point)', () => {
    const tight = planLandmarkRing({ ...input, squares: [{ x: 0, y: 0, half: 1990 }] }, config)
    expect(tight).toEqual([])
  })

  it('keeps clear of the subway and of landmarks that stay put', () => {
    const placed = planLandmarkRing(
      {
        ...input,
        lines: [
          [
            { x: -500, y: 200 },
            { x: 500, y: 200 },
          ],
        ],
        obstacles: [{ x: 170, y: 0, radiusM: 30 }],
      },
      config,
    )
    for (const entry of placed) {
      expect(Math.abs(entry.y - 200), entry.id).toBeGreaterThanOrEqual(entry.clearM + 20)
      expect(Math.hypot(entry.x - 170, entry.y), entry.id).toBeGreaterThanOrEqual(
        entry.clearM + 30 + 10,
      )
    }
  })
})

describe('footprintRadius', () => {
  it('reaches the farthest corner of any ground rectangle', () => {
    expect(
      footprintRadius({ x: 0, y: 0 }, [
        { x: 0, y: 0, halfLengthM: 30, halfWidthM: 40 },
        { x: 100, y: 0, halfLengthM: 3, halfWidthM: 4 },
      ]),
    ).toBe(105)
    expect(footprintRadius({ x: 0, y: 0 }, [])).toBe(0)
  })
})
