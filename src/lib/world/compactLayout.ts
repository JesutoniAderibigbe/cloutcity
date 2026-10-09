/**
 * The game map's compact venue layout (S04n): each neighbourhood's venues packed on a grid
 * around an anchor, so the default view shows a cluster of places like a game map's rather than
 * a few pins scattered across real blocks. See data/config/compactLayout.json
 * (CompactLayoutConfigSchema) for the rules. Pure and deterministic: the server plans it once,
 * from the same data every time, into the places layer (placesLayer.ts `gx`/`gy`).
 *
 * Trips match the map (S04s): on both map styles, travel plans to these points
 * (data/places/game-points.derived.json, src/lib/world/tripEnds.ts), so the trip times on offer
 * are the ones the game map shows and the style can never change a trip's cost.
 */
import type { CompactLayoutConfig } from '@/lib/data/schemas/scene'
import type { PreparedArea } from '@/lib/geo/lookup'
import { bboxOf, distanceToSegment, pointInPolygon, type BBox } from '@/lib/geo/polygon'
import type { LocalPoint } from '@/lib/geo/projection'

/** A venue that may move: its id, category, zone and real point. */
export interface LayoutVenue {
  readonly id: string
  readonly category: string
  readonly zoneId: string
  readonly x: number
  readonly y: number
}

/** A home: it never moves, anchors its zone's grid and holds a plot. */
export interface LayoutHome {
  readonly id: string
  readonly zoneId: string
  readonly x: number
  readonly y: number
}

export interface LayoutInput {
  /** Venues that stand on plots (fixed categories included: they keep their place). */
  readonly venues: readonly LayoutVenue[]
  readonly homes: readonly LayoutHome[]
  /** Every landmark's point: plots keep `landmarkClearM` from each. */
  readonly landmarks: readonly LocalPoint[]
  /** The zones (neighbourhoods) venues must stay inside. */
  readonly zones: readonly PreparedArea[]
  /** Park-layer areas plots keep off (when `avoidParks`). */
  readonly parks: readonly PreparedArea[]
  /** The subway ribbons, as polylines. */
  readonly lines: readonly (readonly LocalPoint[])[]
  /** A plot's side (data/config/plots.json `plotM`). */
  readonly plotM: number
}

interface Segment {
  readonly a: LocalPoint
  readonly b: LocalPoint
  readonly box: BBox
}

const dist = (a: LocalPoint, b: LocalPoint) => Math.hypot(a.x - b.x, a.y - b.y)

function inArea(point: LocalPoint, area: PreparedArea): boolean {
  return area.polygons.some(({ rings, bbox }) => pointInPolygon(point, rings, bbox))
}

/** The plot's centre and four corners. */
function plotPoints(centre: LocalPoint, half: number): LocalPoint[] {
  return [
    centre,
    { x: centre.x - half, y: centre.y - half },
    { x: centre.x + half, y: centre.y - half },
    { x: centre.x - half, y: centre.y + half },
    { x: centre.x + half, y: centre.y + half },
  ]
}

/**
 * The compact position of every venue that moves, by id. Fixed-category venues, venues of an
 * unknown zone and any venue no free slot fits are left out: they keep their real position.
 */
export function planCompactLayout(
  input: LayoutInput,
  config: CompactLayoutConfig,
): Map<string, LocalPoint> {
  const half = input.plotM / 2
  const fixed = new Set(config.fixedCategories)
  const zonesById = new Map(input.zones.map((zone) => [zone.id, zone]))
  const segments: Segment[] = []
  for (const line of input.lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]
      const b = line[i]
      if (a === undefined || b === undefined) continue
      segments.push({ a, b, box: bboxOf([a, b]) })
    }
  }

  // Every plot already standing: homes and fixed venues first.
  const occupied: LocalPoint[] = [
    ...input.homes,
    ...input.venues.filter((venue) => fixed.has(venue.category)),
  ]
  const clearOfOthers = (point: LocalPoint) =>
    occupied.every(
      (other) =>
        Math.max(Math.abs(point.x - other.x), Math.abs(point.y - other.y)) >= config.pitchM - 1e-6,
    )
  const nearLine = (point: LocalPoint) =>
    segments.some(
      ({ a, b, box }) =>
        point.x >= box.minX - config.subwayClearM &&
        point.x <= box.maxX + config.subwayClearM &&
        point.y >= box.minY - config.subwayClearM &&
        point.y <= box.maxY + config.subwayClearM &&
        distanceToSegment(point, a, b) < config.subwayClearM,
    )
  const fits = (centre: LocalPoint, zone: PreparedArea) => {
    const points = plotPoints(centre, half)
    if (!points.every((point) => inArea(point, zone))) return false
    if (config.avoidParks && points.some((p) => input.parks.some((park) => inArea(p, park)))) {
      return false
    }
    if (input.landmarks.some((landmark) => dist(landmark, centre) < config.landmarkClearM)) {
      return false
    }
    return !nearLine(centre)
  }

  const movable = new Map<string, LayoutVenue[]>()
  for (const venue of input.venues) {
    if (fixed.has(venue.category) || !zonesById.has(venue.zoneId)) continue
    const list = movable.get(venue.zoneId) ?? []
    list.push(venue)
    movable.set(venue.zoneId, list)
  }

  const nearestHome = (point: LocalPoint) => {
    let best: LayoutHome | undefined
    for (const home of input.homes) {
      if (best === undefined || dist(home, point) < dist(best, point)) best = home
    }
    return best
  }

  /** The grid's anchor: the zone's home, else a fixed venue, else the pulled centre. */
  const anchorOf = (zoneId: string, venues: readonly LayoutVenue[], zone: PreparedArea) => {
    const home = input.homes.find((candidate) => candidate.zoneId === zoneId)
    if (home !== undefined) return home
    const centre = {
      x: venues.reduce((sum, venue) => sum + venue.x, 0) / venues.length,
      y: venues.reduce((sum, venue) => sum + venue.y, 0) / venues.length,
    }
    const station = input.venues
      .filter((venue) => venue.zoneId === zoneId && fixed.has(venue.category))
      .sort((a, b) => dist(a, centre) - dist(b, centre) || a.id.localeCompare(b.id))[0]
    if (station !== undefined) return station
    const toward = nearestHome(centre)
    if (toward === undefined) return centre
    // The fitting point of the zone (sampled every `anchorStepM`) that best trades the pull
    // toward the home against staying near the venues' own centre.
    const box = zone.polygons.reduce(
      (all, { bbox }) => ({
        minX: Math.min(all.minX, bbox.minX),
        minY: Math.min(all.minY, bbox.minY),
        maxX: Math.max(all.maxX, bbox.maxX),
        maxY: Math.max(all.maxY, bbox.maxY),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    )
    let best: { point: LocalPoint; score: number } | undefined
    for (let x = box.minX + half; x <= box.maxX - half; x += config.anchorStepM) {
      for (let y = box.minY + half; y <= box.maxY - half; y += config.anchorStepM) {
        const point = { x, y }
        const score =
          config.pullToHome * dist(point, toward) + (1 - config.pullToHome) * dist(point, centre)
        if (best !== undefined && score >= best.score) continue
        if (fits(point, zone) && clearOfOthers(point)) best = { point, score }
      }
    }
    return best?.point ?? centre
  }

  // Zones with a home first (the player's own clusters), then the rest nearest a home first.
  const order = [...movable.keys()].sort((a, b) => {
    const homeA = input.homes.some((home) => home.zoneId === a) ? 0 : 1
    const homeB = input.homes.some((home) => home.zoneId === b) ? 0 : 1
    return homeA - homeB || a.localeCompare(b)
  })

  const placed = new Map<string, LocalPoint>()
  for (const zoneId of order) {
    const zone = zonesById.get(zoneId)
    const venues = movable.get(zoneId)
    if (zone === undefined || venues === undefined) continue
    const pulled = anchorOf(zoneId, venues, zone)
    // Whole metres, like every geo layer: the grid's slots are then whole metres too.
    const anchor = { x: Math.round(pulled.x), y: Math.round(pulled.y) }
    // Venues gather around a point offset from the anchor: the default camera frames its target
    // high in the free row, so most of the view lies south of it.
    const centre = { x: anchor.x + config.centreOffsetM.x, y: anchor.y + config.centreOffsetM.y }
    const slots: LocalPoint[] = []
    for (let i = -config.maxRings; i <= config.maxRings; i++) {
      for (let j = -config.maxRings; j <= config.maxRings; j++) {
        const point = { x: anchor.x + i * config.pitchM, y: anchor.y + j * config.pitchM }
        if (fits(point, zone)) slots.push(point)
      }
    }
    const queue = [...venues].sort(
      (a, b) => dist(a, anchor) - dist(b, anchor) || a.id.localeCompare(b.id),
    )
    for (const venue of queue) {
      let best: { point: LocalPoint; score: number } | undefined
      for (const slot of slots) {
        if (!clearOfOthers(slot)) continue
        const score = dist(slot, centre) + config.realBias * dist(slot, venue)
        // Slots are in a fixed order, so the first of equal scores wins: deterministic.
        if (best === undefined || score < best.score - 1e-9) best = { point: slot, score }
      }
      if (best === undefined) continue
      occupied.push(best.point)
      placed.set(venue.id, best.point)
    }
  }
  return placed
}
