'use client'

/**
 * The base city: borough land, water, parks, subway ribbons, station markers and line letters,
 * built once from the fetched geo layers into merged/instanced meshes (about a dozen draw
 * calls). Renders state only; the camera rig owns the view.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Group, InstancedMesh, Mesh } from 'three'
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
import type { GeoBase } from './geo/schema'
import { createCityMaterials } from './materials'
import type { ScenePalette } from './types'

/** The built scene graph plus the per-view updates the camera drives. */
interface CityObjects {
  readonly group: Group
  /** Rescales station markers and toggles line letters for a camera distance. */
  applyDistance(distance: number): void
  dispose(): void
}

function buildCity(geo: GeoBase, palette: ScenePalette, config: SceneConfig): CityObjects {
  const top = landTopY(config.land)
  const colorById = lineColors(geo.subway.lines, palette.subwayLines)
  const atlas = createLabelAtlas(geo.subway.lines, colorById, palette.labelInk, config.labels)
  const materials = createCityMaterials(palette, config, atlas.texture)
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

  const parkY = top + config.parks.liftM
  for (const kind of ['park', 'cemetery'] as const) {
    const polygons = polygonsOfKind(geo.parks.parks, kind)
    if (polygons.length === 0) continue
    const mesh = new Mesh(buildParkGeometry(polygons, parkY), materials[kind])
    mesh.name = `parks-${kind}`
    group.add(mesh)
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

  let scaledFor = 0
  return {
    group,
    applyDistance(distance) {
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
      materials.dispose()
    },
  }
}

interface CityProps {
  /** Validated before the canvas mounts (CitySceneClient). */
  readonly geo: GeoBase
  readonly palette: ScenePalette
  readonly config: SceneConfig
  /** Called once, after the first frame that shows the city. */
  readonly onReady: () => void
}

export function City({ geo, palette, config, onReady }: CityProps) {
  const city = useMemo(() => buildCity(geo, palette, config), [geo, palette, config])
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

  return <primitive object={city.group} />
}
