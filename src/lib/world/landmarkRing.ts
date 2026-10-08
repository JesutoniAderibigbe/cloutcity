/**
 * The game map's famous-places ring (S07d): a few iconic landmarks drawn around the start home's
 * venue cluster, so the default view shows the Statue of Liberty or the Deco spire beside the
 * player's venues, the way a game map shows its sights. See data/config/compactLayout.json
 * `landmarkRing` (CompactLayoutConfigSchema) for the rules. Pure and deterministic: the server
 * plans it once into the places layer (placesLayer.ts, the landmark pins' `gx`/`gy`/`game`).
 *
 * Only where a landmark is drawn on the game map moves. Travel time, fares and distances stay
 * on the real positions (src/engine/transit), as for the compact venues (S04n).
 */
import type { LandmarkRingConfig } from '@/lib/data/schemas/scene'
import type { PreparedArea } from '@/lib/geo/lookup'
import { bboxOf, distanceToSegment, pointInPolygon, type BBox } from '@/lib/geo/polygon'
import type { LocalPoint } from '@/lib/geo/projection'

/** A square that stands on the map already: a plot, a home, a fixed venue. */
export interface RingSquare {
  readonly x: number
  readonly y: number
  /** Half the square's side. */
  readonly half: number
}

/** A landmark the ring may place: its full-size footprint radius around its anchor. */
export interface RingCandidate {
  readonly id: string
  /** Metres from the anchor that hold all of the model at full size. */
  readonly radiusM: number
}

/** A landmark that stays where it is, keeping its ground clear. */
export interface RingObstacle {
  readonly x: number
  readonly y: number
  readonly radiusM: number
}

export interface RingInput {
  /** The cluster's centre the ring is laid around. */
  readonly centre: LocalPoint
  readonly candidates: readonly RingCandidate[]
  /** Every plot, home and fixed venue square on the game map. */
  readonly squares: readonly RingSquare[]
  /** Landmarks the ring leaves at their real points. */
  readonly obstacles: readonly RingObstacle[]
  /** The land the ring stands on (the home's borough). */
  readonly land: PreparedArea
  readonly parks: readonly PreparedArea[]
  readonly lines: readonly (readonly LocalPoint[])[]
  /** A footprint keeps this far from every subway ribbon (compactLayout.json `subwayClearM`). */
  readonly subwayClearM: number
}

/** Where a ring landmark stands on the game map, and how it is drawn there. */
export interface RingPlacement {
  readonly id: string
  /** Whole metres. */
  readonly x: number
  readonly y: number
  /** The model's size on the game map, scaled about the land top. */
  readonly scale: number
  /** The ground it keeps clear: its scaled footprint, or its pond. */
  readonly clearM: number
  /** It stands on an island in a pond of this radius. */
  readonly pondM?: number
}

interface Segment {
  readonly a: LocalPoint
  readonly b: LocalPoint
  readonly box: BBox
}

/** Points sampled around a footprint's edge to keep it wholly on land and off parks. */
const EDGE_SAMPLES = 12

function inArea(point: LocalPoint, area: PreparedArea): boolean {
  return area.polygons.some(({ rings, bbox }) => pointInPolygon(point, rings, bbox))
}

/** Distance from a point to a square's edge (0 inside it). */
function toSquare(point: LocalPoint, square: RingSquare): number {
  const dx = Math.max(0, Math.abs(point.x - square.x) - square.half)
  const dy = Math.max(0, Math.abs(point.y - square.y) - square.half)
  return Math.hypot(dx, dy)
}

/**
 * Each configured landmark's spot: walking out from the centre along its bearing in `stepM`
 * steps, the first distance at which the bearing, or one swept either side of it (nearest
 * first), fits. A landmark no spot fits is left out: it keeps its real point.
 */
export function planLandmarkRing(input: RingInput, config: LandmarkRingConfig): RingPlacement[] {
  const segments: Segment[] = []
  for (const line of input.lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]
      const b = line[i]
      if (a === undefined || b === undefined) continue
      segments.push({ a, b, box: bboxOf([a, b]) })
    }
  }
  const byId = new Map(input.candidates.map((candidate) => [candidate.id, candidate]))
  const placed: RingPlacement[] = []
  const offsets = [0]
  for (let d = config.sweepStepDeg; d <= config.sweepDeg + 1e-9; d += config.sweepStepDeg) {
    offsets.push(d, -d)
  }

  const fits = (point: LocalPoint, radius: number): boolean => {
    if (input.squares.some((square) => toSquare(point, square) < radius + config.gapM)) {
      return false
    }
    const clearOf = (other: { x: number; y: number }, otherRadius: number) =>
      Math.hypot(point.x - other.x, point.y - other.y) >= radius + otherRadius + config.gapM
    if (!placed.every((other) => clearOf(other, other.clearM))) return false
    if (!input.obstacles.every((other) => clearOf(other, other.radiusM))) return false
    const reach = radius + input.subwayClearM
    const nearLine = segments.some(
      ({ a, b, box }) =>
        point.x >= box.minX - reach &&
        point.x <= box.maxX + reach &&
        point.y >= box.minY - reach &&
        point.y <= box.maxY + reach &&
        distanceToSegment(point, a, b) < reach,
    )
    if (nearLine) return false
    const samples = [point]
    for (let k = 0; k < EDGE_SAMPLES; k++) {
      const angle = (k / EDGE_SAMPLES) * Math.PI * 2
      samples.push({ x: point.x + radius * Math.cos(angle), y: point.y + radius * Math.sin(angle) })
    }
    if (!samples.every((sample) => inArea(sample, input.land))) return false
    return !samples.some((sample) => input.parks.some((park) => inArea(sample, park)))
  }

  for (const entry of config.landmarks) {
    const candidate = byId.get(entry.id)
    if (candidate === undefined) continue
    const scale = entry.scale ?? config.scale
    const radius = Math.max(candidate.radiusM * scale, entry.pondM ?? 0)
    let spot: LocalPoint | undefined
    for (let d = config.stepM; d <= config.maxM && spot === undefined; d += config.stepM) {
      for (const offset of offsets) {
        const bearing = ((entry.bearingDeg + offset) * Math.PI) / 180
        // Whole metres, like every geo layer.
        const point = {
          x: Math.round(input.centre.x + d * Math.sin(bearing)),
          y: Math.round(input.centre.y + d * Math.cos(bearing)),
        }
        if (fits(point, radius)) {
          spot = point
          break
        }
      }
    }
    if (spot === undefined) continue
    placed.push({
      id: entry.id,
      x: spot.x,
      y: spot.y,
      scale,
      clearM: Math.ceil(radius),
      ...(entry.pondM === undefined ? {} : { pondM: entry.pondM }),
    })
  }
  return placed
}

/**
 * A landmark's footprint radius from its ground rectangles (frames.derived.json `grounds`, else
 * its kit `exclusion`): the farthest any rectangle reaches from the anchor, whatever its turn.
 */
export function footprintRadius(
  anchor: LocalPoint,
  rects: readonly {
    readonly x: number
    readonly y: number
    readonly halfLengthM: number
    readonly halfWidthM: number
  }[],
): number {
  let radius = 0
  for (const rect of rects) {
    const reach =
      Math.hypot(rect.x - anchor.x, rect.y - anchor.y) +
      Math.hypot(rect.halfLengthM, rect.halfWidthM)
    radius = Math.max(radius, reach)
  }
  return radius
}
