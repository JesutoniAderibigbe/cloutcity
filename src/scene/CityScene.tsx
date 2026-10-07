/**
 * Server mount of the 3D map: resolves config, palette tokens, projected homes and bounds, and
 * copy into small serialisable props, so the client scene needs no config loader, classic zod
 * or colour literal.
 */
import {
  FREE_SCENE_GRID_ROW,
  overlayGridTemplateRows,
  overlayLayout,
} from '@/components/overlay/layers'
import { copy } from '@/lib/copy'
// The map copy renders here on the server and reaches the client as props, so the map
// namespace never ships in the shell (DEC-11).
import '@/lib/copy/ns/map'
import { balance, perf, scene } from '@/lib/data/config'
import { QUALITY_TIERS, type QualityTier } from '@/lib/data/schemas/config'
import { geoBounds, homes } from '@/lib/data/content'
import { geoVersion } from '@/lib/data/geo'
import { HOME_IDS } from '@/lib/data/homes'
import { project } from '@/lib/geo/projection'
import { scenePalette } from '@/lib/theme'
import { ApartmentMount } from './apartment/ApartmentMount'
import { boundsToLocal } from './camera/limits'
import { CitySceneClient } from './CitySceneClient'
import { MapAttribution } from './MapAttribution'
import type { SceneProps, SceneQuality, TierRenderSettings } from './types'

function tierSettings(tier: QualityTier): TierRenderSettings {
  return {
    dprCap: perf.dprCap[tier],
    antialias: perf.antialias[tier],
    shadows: perf.shadows[tier],
    shadowMapSizePx: perf.shadowMapSizePx[tier],
    outlines: perf.outlines[tier],
    buildingDensity: perf.buildingDensity[tier],
    lodDistanceScale: perf.lodDistanceScale[tier],
  }
}

/** The tier picker's thresholds and every tier's settings, so the client loads no config. */
function sceneQuality(): SceneQuality {
  return {
    picker: perf.tierPicker,
    stepDown: perf.fpsStepDown,
    tiers: Object.fromEntries(
      QUALITY_TIERS.map((tier) => [tier, tierSettings(tier)]),
    ) as SceneQuality['tiers'],
  }
}

export function CityScene() {
  const overlayRows = overlayGridTemplateRows(overlayLayout)
  const props: SceneProps = {
    geoUrl: `/geo/base?v=${geoVersion}`,
    fallbackUrl: `/geo/fallback?v=${geoVersion}`,
    palette: scenePalette(),
    config: scene,
    homesLocal: Object.fromEntries(
      HOME_IDS.map((id) => [id, project(homes[id].location)]),
    ) as SceneProps['homesLocal'],
    startHome: balance.start.home,
    boundsLocal: boundsToLocal(geoBounds),
    quality: sceneQuality(),
    overlayRows,
    freeRow: FREE_SCENE_GRID_ROW,
    copy: {
      label: copy('map.label'),
      loading: copy('map.loading'),
      errorDevice: copy('map.error.device'),
      errorLoad: copy('map.error.load'),
      lost: copy('map.lost'),
      fallback: copy('map.fallback'),
      expandingSoon: copy('map.expandingSoon'),
    },
  }
  return (
    <div className="absolute inset-0">
      <CitySceneClient {...props} />
      {/* The apartment's canvas draws here while the Home panel shows the room (S16,
          src/scene/apartment/ApartmentMount.tsx); empty, it takes no space or pointer events. */}
      <div data-scene-slot="room" className="absolute inset-0 empty:hidden">
        <ApartmentMount />
      </div>
      <MapAttribution
        nyc={copy('map.attribution.nyc')}
        mta={copy('map.attribution.mta')}
        compact={copy('map.attribution.compact')}
        credits={copy('map.attribution.credits')}
        toggle={copy('map.attribution.toggle')}
        gridTemplateRows={overlayRows}
        row={FREE_SCENE_GRID_ROW}
      />
    </div>
  )
}
