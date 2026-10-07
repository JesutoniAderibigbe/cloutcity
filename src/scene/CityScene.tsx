/**
 * Server mount of the 3D map: resolves config, palette tokens, projected start and bounds, and
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
import { perf, scene } from '@/lib/data/config'
import { geoBounds } from '@/lib/data/content'
import { geoVersion } from '@/lib/data/geo'
import { project } from '@/lib/geo/projection'
import { scenePalette } from '@/lib/theme'
import { boundsToLocal } from './camera/limits'
import { CitySceneClient } from './CitySceneClient'
import { MapAttribution } from './MapAttribution'
import type { SceneProps } from './types'

export function CityScene() {
  const overlayRows = overlayGridTemplateRows(overlayLayout)
  const props: SceneProps = {
    geoUrl: `/geo/base?v=${geoVersion}`,
    fallbackUrl: `/geo/fallback?v=${geoVersion}`,
    palette: scenePalette(),
    config: scene,
    startLocal: project(scene.camera.start),
    boundsLocal: boundsToLocal(geoBounds),
    // Quality tiers arrive with S04b; until then every device gets the mid tier's cap.
    dprCap: perf.dprCap.mid,
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
      <MapAttribution
        nyc={copy('map.attribution.nyc')}
        mta={copy('map.attribution.mta')}
        compact={copy('map.attribution.compact')}
        credits={copy('map.attribution.credits')}
        gridTemplateRows={overlayRows}
        row={FREE_SCENE_GRID_ROW}
      />
    </div>
  )
}
