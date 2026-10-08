/**
 * The `places` layer of GET /geo/base (S04c): every venue and landmark as a pin, and how the
 * scene draws each borough. Built on the server at build time from the same data the game uses
 * (src/lib/world/places.ts), so the 3D chunk needs no place data, copy or engine config.
 */
import homesJson from '@data/homes/homes.json'
import landJson from '@data/geo/land.derived.json'
import parksJson from '@data/geo/parks.derived.json'
import subwayJson from '@data/geo/subway.derived.json'
import zoneShapesJson from '@data/zones/zone-shapes.derived.json'
import type { Borough } from '@/lib/data/schemas/content'
import type { PinStyle } from '@/scene/geo/schema'
import { compactLayout, plots } from '@/lib/data/config'
import { modelRef } from '@/lib/data/models'
import { decodePath } from '@/lib/geo/codec'
import { prepareAreas } from '@/lib/geo/lookup'
import { project, type LocalPoint } from '@/lib/geo/projection'
import { planCompactLayout } from './compactLayout'
import { landmarkPinLifts } from './landmarksLayer'
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

/**
 * The game map's compact venue positions (compactLayout.ts) for the playable venues that stand on
 * plots. The geo files are read directly (validated in src/lib/data/data.test.ts, which gates
 * every build): src/lib/data/geo.ts imports this module, so it cannot be imported back.
 */
function compactPositions(
  places: readonly MapPlace[],
  styleOf: (place: MapPlace) => PinStyle,
): Map<string, LocalPoint> {
  // Clusters gather per borough (the whole borough's venues around its home, S04n2) or per
  // neighbourhood zone; a plot always stays inside the area it was gathered in.
  const byBorough = compactLayout.clusterBy === 'borough'
  const homes = Object.entries(
    homesJson.homes as Record<
      string,
      { zoneId: string; borough: string; location: { lat: number; lng: number } }
    >,
  ).map(([id, home]) => {
    const point = project(home.location)
    const zoneId = byBorough ? home.borough : home.zoneId
    return { id, zoneId, x: Math.round(point.x), y: Math.round(point.y) }
  })
  return planCompactLayout(
    {
      venues: places
        .filter(
          (place) =>
            place.kind === 'venue' &&
            styleOf(place) === 'normal' &&
            plots.styles[place.category] !== undefined,
        )
        .map((place) => ({
          id: place.id,
          category: place.category,
          zoneId: byBorough ? place.borough : place.zoneId,
          x: Math.round(place.x),
          y: Math.round(place.y),
        })),
      homes,
      landmarks: places.filter((place) => place.kind === 'landmark'),
      zones: prepareAreas(byBorough ? landJson.boroughs : zoneShapesJson.zones),
      parks: prepareAreas(parksJson.parks),
      lines: subwayJson.lines.flatMap((line) => line.paths.map((path) => decodePath(path))),
      plotM: plots.plotM,
    },
    compactLayout,
  )
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
  )
  const styleOf = (place: MapPlace): PinStyle => {
    const render = renderOf.get(place.borough)
    if (render === undefined) throw new Error(`places layer: no borough "${place.borough}"`)
    return pinStyle(place, render)
  }
  const compact = compactPositions(mapPlaces(), styleOf)
  const pins = mapPlaces().map((place): PlacePin => {
    const game = compact.get(place.id)
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
    }
  })
  return { pins, boroughs: renders }
}

/** The layer GET /geo/base serves (built once per server process). */
export const placesLayer: PlacesLayer = buildPlacesLayer()
