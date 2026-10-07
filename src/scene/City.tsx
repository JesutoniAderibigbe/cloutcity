'use client'

/**
 * The base city: borough land, water, parks, subway ribbons, station markers and line letters,
 * plus the place pins and the "expanding soon" chips on dimmed boroughs (S04c), built once from
 * the fetched geo layers into merged/instanced meshes (under twenty draw calls). Renders state
 * only; the camera rig owns the view and PlacePins owns picking.
 */
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Group, InstancedMesh, Mesh, MeshBasicMaterial } from 'three'
import { MapControls } from 'three/addons/controls/MapControls.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import type { SceneConfig } from '@/lib/data/schemas/scene'
import { buildLandGeometry, buildWaterGeometry, landTopY } from './geo/buildLand'
import { buildLabelGeometry, terminalChips } from './geo/buildLabels'
import { buildParkGeometry, polygonsOfKind } from './geo/buildParks'
import {
  buildStationGeometry,
  stationPositions,
  stationRadius,
  writeStationMatrices,
} from './geo/buildStations'
import { buildSubwayGeometry, lineColors, subwaySegments } from './geo/buildSubway'
import { createLabelAtlas } from './geo/labelAtlas'
import type { BoroughId, GeoBase } from './geo/schema'
import { createCityMaterials } from './materials'
import { buildChipGeometry, chipAnchor, createChipTexture } from './pins/buildChips'
import { buildPins, type PinObjects } from './pins/buildPins'
import { PlacePins } from './pins/PlacePins'
import type { ScenePalette } from './types'

/** How one borough is drawn (the test hook reports it). */
export interface BoroughView {
  readonly id: BoroughId
  readonly land: 'normal' | 'dimmed'
  readonly pinCount: number
  /** Whether an "expanding soon" chip lies on it. */
  readonly chip: boolean
}

/** The built scene graph plus the per-view updates the camera drives. */
export interface CityObjects {
  readonly group: Group
  readonly pins: PinObjects
  readonly boroughs: readonly BoroughView[]
  /** Rescales station markers and pins and toggles line letters for a camera distance. */
  applyDistance(distance: number): void
  dispose(): void
}

function buildCity(
  geo: GeoBase,
  palette: ScenePalette,
  config: SceneConfig,
  expandingSoon: string,
): CityObjects {
  const top = landTopY(config.land)
  const colorById = lineColors(geo.subway.lines, palette.subwayLines)
  const atlas = createLabelAtlas(geo.subway.lines, colorById, palette.labelInk, config.labels)
  const dimmed = new Set(
    geo.places.boroughs.filter((borough) => borough.render === 'dimmed').map((b) => b.id),
  )
  const materials = createCityMaterials(palette, config, atlas.texture, dimmed)
  const group = new Group()
  group.name = 'city'

  for (const borough of geo.land.boroughs) {
    const mesh = new Mesh(
      buildLandGeometry(borough.polygons, config.land),
      materials.land[borough.id],
    )
    mesh.name = `land-${borough.id}`
    group.add(mesh)
  }

  const water = new Mesh(buildWaterGeometry(geo.water.sea, config.water.extraM), materials.water)
  water.name = 'water'
  group.add(water)

  // Parks on dimmed land draw dimmed, in their own mesh per kind (one extra call each).
  const parkY = top + config.parks.liftM
  for (const isDimmed of [false, true]) {
    for (const kind of ['park', 'cemetery'] as const) {
      const polygons = polygonsOfKind(geo.parks.parks, kind, { ids: dimmed, exclude: !isDimmed })
      if (polygons.length === 0) continue
      const material = isDimmed ? materials[`${kind}Dimmed`] : materials[kind]
      const mesh = new Mesh(buildParkGeometry(polygons, parkY), material)
      mesh.name = isDimmed ? `parks-${kind}-dimmed` : `parks-${kind}`
      group.add(mesh)
    }
  }

  const subwayGeometry = buildSubwayGeometry(
    subwaySegments(geo.subway.lines, colorById, top + config.subway.liftM),
  )
  if (config.subway.casing) {
    const casing = new LineSegments2(subwayGeometry, materials.subwayCasing)
    casing.name = 'subway-casing'
    casing.renderOrder = 1
    group.add(casing)
  }
  const ribbons = new LineSegments2(subwayGeometry, materials.subway)
  ribbons.name = 'subway'
  ribbons.renderOrder = 2
  group.add(ribbons)

  const stationsAt = stationPositions(geo.subway.stations, top)
  const stations = new InstancedMesh(
    buildStationGeometry(config.stations.radialSegments),
    materials.station,
    geo.subway.stations.length,
  )
  stations.name = 'stations'
  group.add(stations)

  const chips = terminalChips(geo.subway.lines, geo.subway.stations)
  const labels = new Mesh(
    buildLabelGeometry(
      chips,
      atlas.cellIndex,
      atlas.layout,
      config.labels,
      top + config.labels.liftM,
    ),
    materials.label,
  )
  labels.name = 'line-labels'
  group.add(labels)

  const anchors = geo.land.boroughs.flatMap((borough) => {
    if (!dimmed.has(borough.id)) return []
    const anchor = chipAnchor(borough.polygons)
    return anchor === null ? [] : [{ id: borough.id, anchor }]
  })
  const chipTexture = createChipTexture(
    expandingSoon,
    palette.chip.fill,
    palette.chip.ink,
    config.chips,
  )
  const chipMaterial = new MeshBasicMaterial({
    map: chipTexture,
    alphaTest: config.chips.alphaTest,
  })
  if (anchors.length > 0) {
    const chips = new Mesh(
      buildChipGeometry(
        anchors.map((entry) => entry.anchor),
        config.chips,
        top + config.chips.liftM,
      ),
      chipMaterial,
    )
    chips.name = 'expanding-soon-chips'
    group.add(chips)
  }

  const pins = buildPins(geo.places.pins, palette, config, top, materials.gradientMap)
  group.add(pins.group)

  const chipped = new Set(anchors.map((entry) => entry.id))
  const boroughs: BoroughView[] = geo.places.boroughs.map((borough) => ({
    id: borough.id,
    land: borough.render,
    pinCount: pins.pins.filter((pin) => pin.borough === borough.id).length,
    chip: chipped.has(borough.id),
  }))

  let scaledFor = 0
  return {
    group,
    pins,
    boroughs,
    applyDistance(distance) {
      pins.applyDistance(distance)
      labels.visible = distance <= config.labels.maxDistanceM
      const ratio =
        scaledFor === 0 ? Infinity : Math.max(distance / scaledFor, scaledFor / distance)
      if (ratio > config.stations.rescaleRatio) {
        scaledFor = distance
        writeStationMatrices(
          stations,
          stationsAt,
          stationRadius(distance, config.stations),
          config.stations.heightM,
        )
      }
    },
    dispose() {
      group.traverse((object) => {
        if (object instanceof Mesh) object.geometry.dispose()
      })
      stations.dispose()
      pins.dispose()
      chipMaterial.dispose()
      chipTexture.dispose()
      materials.dispose()
    },
  }
}

interface CityProps {
  /** Validated before the canvas mounts (CitySceneClient). */
  readonly geo: GeoBase
  readonly palette: ScenePalette
  readonly config: SceneConfig
  /** The chip text (map.expandingSoon), rendered by the server. */
  readonly expandingSoon: string
  /** Called once, after the first frame that shows the city. */
  readonly onReady: () => void
  /** Receives the built city for the test hooks. */
  readonly cityRef: RefObject<CityObjects | null>
}

export function City({ geo, palette, config, expandingSoon, onReady, cityRef }: CityProps) {
  const city = useMemo(
    () => buildCity(geo, palette, config, expandingSoon),
    [geo, palette, config, expandingSoon],
  )

  useEffect(() => {
    cityRef.current = city
    return () => {
      if (cityRef.current === city) cityRef.current = null
    }
  }, [city, cityRef])
  const controls = useThree((state) => state.controls)
  const invalidate = useThree((state) => state.invalidate)
  const placed = useRef(false)
  const reported = useRef(false)

  useEffect(() => () => city.dispose(), [city])

  useEffect(() => {
    if (!(controls instanceof MapControls)) return
    const update = () => city.applyDistance(controls.getDistance())
    update()
    placed.current = true
    controls.addEventListener('change', update)
    invalidate()
    return () => controls.removeEventListener('change', update)
  }, [city, controls, invalidate])

  // Ready once a frame has drawn the city with its markers placed for the camera.
  useFrame(() => {
    if (reported.current || !placed.current) return
    reported.current = true
    onReady()
  })

  return (
    <>
      <primitive object={city.group} />
      <PlacePins pins={city.pins} config={config} groundY={landTopY(config.land)} />
    </>
  )
}
