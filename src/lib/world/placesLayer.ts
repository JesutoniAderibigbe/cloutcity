/**
 * The `places` layer of GET /geo/base (S04c): every venue and landmark as a pin, and how the
 * scene draws each borough. Built on the server at build time from the same data the game uses
 * (src/lib/world/places.ts), so the 3D chunk needs no place data, copy or engine config.
 */
import homesJson from '@data/homes/homes.json'
import framesJson from '@data/landmarks/frames.derived.json'
import landJson from '@data/geo/land.derived.json'
import parksJson from '@data/geo/parks.derived.json'
import subwayJson from '@data/geo/subway.derived.json'
import zoneShapesJson from '@data/zones/zone-shapes.derived.json'
import type { Borough } from '@/lib/data/schemas/content'
import type { PinStyle } from '@/scene/geo/schema'
import { compactLayout, plots, scene } from '@/lib/data/config'
import { modelRef } from '@/lib/data/models'
import { parseDataFile } from '@/lib/data/parse'
import { LandmarkFramesFileSchema } from '@/lib/data/schemas/world'
import { decodePath } from '@/lib/geo/codec'
import { prepareAreas } from '@/lib/geo/lookup'
import { project, type LocalPoint } from '@/lib/geo/projection'
import { planCompactLayout } from './compactLayout'
import { footprintRadius, planLandmarkRing, type RingPlacement } from './landmarkRing'
import { chipShifts, landmarkPinLifts } from './landmarksLayer'
import { boroughRenderState, boroughs, mapPlaces, placeName, type MapPlace } from './places'
import { plotPinLifts } from './venuePlots'

export interface PlacePin {
  readonly id: string
  readonly kind: MapPlace['kind']
  readonly category: MapPlace['category']
  readonly borough: Borough
  /**
   * The place's display name from the server's copy (a generic label where the real name is
   * trademarked), for the pin's label (S04k). Data in the geo body, so no copy ships in a chunk.
   */
  readonly name: string
  /** Local metres, rounded to whole metres like every other geo layer. */
  readonly x: number
  readonly y: number
  /** A playable place, a teaser on "expanding soon" land, or a muted memorial. */
  readonly style: PinStyle
  /**
   * Extra height above the land top: S07a lifts pins over landmark models, S04m over a venue's
   * plot building. Omitted when 0.
   */
  readonly liftM?: number
  /**
   * The landmark has a 3D model (S07a): its pin is a compact badge floating over the model
   * instead of the placeholder marker. Omitted otherwise.
   */
  readonly badge?: true
  /**
   * Where the venue stands on the game map style (S04n, compactLayout.ts), local metres; omitted
   * when it stands at its real point there too. Never used for travel or distances.
   */
  readonly gx?: number
  readonly gy?: number
  /**
   * A ring landmark on the game map (S07d, landmarkRing.ts), standing at `gx`/`gy`: its model's
   * size there, its pin's lift over the scaled model, the ground buildings keep clear of, its
   * pond (if it stands on one) and its name chip's shift there. Omitted otherwise.
   */
  readonly game?: PinGame
}

export interface PinGame {
  readonly scale: number
  readonly liftM: number
  readonly clearM: number
  readonly pondM?: number
  readonly chipShiftM?: number
}

export interface BoroughRender {
  readonly id: Borough
  /** `dimmed`: "expanding soon" land, drawn but not playable. */
  readonly render: 'normal' | 'dimmed'
  /** Places shown as teaser pins on dimmed land. */
  readonly teaserIds: readonly string[]
}

export interface PlacesLayer {
  readonly pins: readonly PlacePin[]
  /** In data/boroughs/boroughs.json order. */
  readonly boroughs: readonly BoroughRender[]
}

function pinStyle(place: MapPlace, render: BoroughRender): PinStyle {
  if (place.category === 'memorial') return 'memorial'
  return render.render === 'dimmed' ? 'teaser' : 'normal'
}

const homes = Object.entries(
  homesJson.homes as Record<
    string,
    { zoneId: string; borough: string; location: { lat: number; lng: number } }
  >,
).map(([id, home]) => {
  const point = project(home.location)
  return {
    id,
    zoneId: home.zoneId,
    borough: home.borough,
    x: Math.round(point.x),
    y: Math.round(point.y),
  }
})

/**
 * The game map's layout: the compact venue positions (compactLayout.ts) for the playable venues
 * that stand on plots, then the famous-places ring around the start home's cluster
 * (landmarkRing.ts). The geo files are read directly (validated in src/lib/data/data.test.ts,
 * which gates every build): src/lib/data/geo.ts imports this module, so it cannot be imported
 * back.
 */
function gameLayout(
  places: readonly MapPlace[],
  styleOf: (place: MapPlace) => PinStyle,
): { readonly venues: Map<string, LocalPoint>; readonly ring: readonly RingPlacement[] } {
  // Clusters gather per borough (the whole borough's venues around its home, S04n2) or per
  // neighbourhood zone; a plot always stays inside the area it was gathered in.
  const byBorough = compactLayout.clusterBy === 'borough'
  const clusterOf = (place: { zoneId: string; borough: string }) =>
    byBorough ? place.borough : place.zoneId
  const parks = prepareAreas(parksJson.parks)
  const lines = subwayJson.lines.flatMap((line) => line.paths.map((path) => decodePath(path)))
  const plotted = places.filter(
    (place) =>
      place.kind === 'venue' &&
      styleOf(place) === 'normal' &&
      plots.styles[place.category] !== undefined,
  )
  const venues = planCompactLayout(
    {
      venues: plotted.map((place) => ({
        id: place.id,
        category: place.category,
        zoneId: clusterOf(place),
        x: Math.round(place.x),
        y: Math.round(place.y),
      })),
      homes: homes.map((home) => ({ ...home, zoneId: clusterOf(home) })),
      landmarks: places.filter((place) => place.kind === 'landmark'),
      zones: prepareAreas(byBorough ? landJson.boroughs : zoneShapesJson.zones),
      parks,
      lines,
      plotM: plots.plotM,
    },
    compactLayout,
  )
  const ring = compactLayout.landmarkRing
  if (ring === undefined) return { venues, ring: [] }
  const home = homes.find((candidate) => candidate.id === ring.aroundHome)
  if (home === undefined) throw new Error(`places layer: no ring home "${ring.aroundHome}"`)
  const land = prepareAreas(landJson.boroughs).find((area) => area.id === home.borough)
  if (land === undefined) throw new Error(`places layer: no land for "${home.borough}"`)
  const ringIds = new Set(ring.landmarks.map((entry) => entry.id))
  const radiusOf = (frame: (typeof frames)[number]) =>
    footprintRadius(
      frame.anchor,
      frame.grounds ?? (frame.exclusion === undefined ? [] : [frame.exclusion]),
    )
  for (const id of ringIds) {
    const place = places.find((candidate) => candidate.id === id)
    const frame = frames.find((candidate) => candidate.id === id)
    // A memorial stays a quiet, look-only stop where it stands; teasers and bridges cannot move.
    if (
      place === undefined ||
      place.kind !== 'landmark' ||
      styleOf(place) !== 'normal' ||
      frame === undefined ||
      frame.base !== 'land' ||
      radiusOf(frame) === 0
    ) {
      throw new Error(`places layer: "${id}" cannot stand in the landmark ring`)
    }
  }
  // The home's cluster: its plots and the home itself.
  const cluster = [
    home,
    ...plotted
      .filter((place) => clusterOf(place) === clusterOf(home))
      .flatMap((place) => {
        const at = venues.get(place.id)
        return at === undefined ? [] : [at]
      }),
  ]
  const centre = {
    x: cluster.reduce((sum, point) => sum + point.x, 0) / cluster.length,
    y: cluster.reduce((sum, point) => sum + point.y, 0) / cluster.length,
  }
  const plotHalf = plots.plotM / 2 + plots.clearM
  const fixed = new Set(compactLayout.fixedCategories)
  const squares = [
    ...homes.map((point) => ({ x: point.x, y: point.y, half: plotHalf })),
    ...plotted.flatMap((place) => {
      const at = venues.get(place.id) ?? (fixed.has(place.category) ? place : undefined)
      return at === undefined ? [] : [{ x: at.x, y: at.y, half: plotHalf }]
    }),
    ...places
      .filter((place) => place.kind === 'venue' && fixed.has(place.category))
      .map((place) => ({ x: place.x, y: place.y, half: plotHalf })),
  ]
  const obstacles = frames
    .filter((frame) => !ringIds.has(frame.id))
    .map((frame) => ({ x: frame.anchor.x, y: frame.anchor.y, radiusM: radiusOf(frame) }))
  return {
    venues,
    ring: planLandmarkRing(
      {
        centre,
        candidates: [...ringIds].map((id) => {
          const frame = frames.find((candidate) => candidate.id === id)
          return { id, radiusM: frame === undefined ? 0 : radiusOf(frame) }
        }),
        squares,
        obstacles,
        land,
        parks,
        lines,
        subwayClearM: compactLayout.subwayClearM,
      },
      ring,
    ),
  }
}

const frames = parseDataFile(
  'landmarks/frames.derived.json',
  LandmarkFramesFileSchema,
  framesJson,
).landmarks

/** A ring landmark's pin lift over its model scaled about the land top (landmarkPinLifts). */
function scaledLift(id: string, scale: number): number {
  const frame = frames.find((candidate) => candidate.id === id)
  if (frame === undefined) return 0
  return Math.max(0, Math.ceil(frame.pinLiftM * scene.landmarks.heightScale * scale))
}

export function buildPlacesLayer(): PlacesLayer {
  const renders: BoroughRender[] = boroughs.map((entry) => {
    const state = boroughRenderState(entry.id)
    return { id: entry.id, render: state.state, teaserIds: [...state.teaserLandmarkIds] }
  })
  const renderOf = new Map(renders.map((render) => [render.id, render]))
  const lifts = landmarkPinLifts()
  const venueLifts = plotPinLifts(
    mapPlaces()
      .filter((place) => place.kind === 'venue')
      .map((place) => ({ ...place, kind: 'venue' as const, style: 'normal' })),
    plots,
    (id) => modelRef(id).bounds,
    compactLayout.fixedCategories,
  )
  const styleOf = (place: MapPlace): PinStyle => {
    const render = renderOf.get(place.borough)
    if (render === undefined) throw new Error(`places layer: no borough "${place.borough}"`)
    return pinStyle(place, render)
  }
  const layout = gameLayout(mapPlaces(), styleOf)
  const ringOf = new Map(layout.ring.map((entry) => [entry.id, entry]))
  // Name chips on the game map: ring landmarks at their ring spots, the rest where they stand,
  // laid out so no two overlap from the game map's default pitch (UX-14).
  const gameShifts = chipShifts(
    mapPlaces()
      .filter((place) => place.kind === 'landmark' && lifts.has(place.id))
      .map((place) => {
        const entry = ringOf.get(place.id)
        return entry === undefined
          ? { id: place.id, x: place.x, y: place.y, liftM: lifts.get(place.id) ?? 0 }
          : { id: place.id, x: entry.x, y: entry.y, liftM: scaledLift(place.id, entry.scale) }
      }),
    scene.landmarkChips,
    scene.mapStyles.game.camera.polarDeg,
  )
  const pins = mapPlaces().map((place): PlacePin => {
    const entry = ringOf.get(place.id)
    const game = entry ?? layout.venues.get(place.id)
    const lift = place.kind === 'landmark' ? lifts.get(place.id) : undefined
    const venueLift = place.kind === 'venue' ? venueLifts.get(place.id) : undefined
    return {
      id: place.id,
      kind: place.kind,
      category: place.category,
      borough: place.borough,
      name: placeName(place),
      x: Math.round(place.x),
      y: Math.round(place.y),
      style: styleOf(place),
      ...(lift === undefined ? {} : { badge: true as const }),
      ...(lift === undefined || lift === 0 ? {} : { liftM: lift }),
      ...(venueLift === undefined || venueLift === 0 ? {} : { liftM: venueLift }),
      ...(game === undefined ? {} : { gx: game.x, gy: game.y }),
      ...(entry === undefined
        ? {}
        : {
            game: {
              scale: entry.scale,
              liftM: scaledLift(place.id, entry.scale),
              clearM: entry.clearM,
              ...(entry.pondM === undefined ? {} : { pondM: entry.pondM }),
              ...((gameShifts.get(place.id) ?? 0) === 0
                ? {}
                : { chipShiftM: gameShifts.get(place.id) }),
            },
          }),
    }
  })
  return { pins, boroughs: renders }
}

/** The layer GET /geo/base serves (built once per server process). */
export const placesLayer: PlacesLayer = buildPlacesLayer()
