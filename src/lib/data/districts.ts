/**
 * District buildings and procedural blocks (S04d) as the server sees them: which per-tier files
 * exist, their versioned URLs, and the district circles the scene loads and culls by. Server
 * only (classic zod, node:fs): the scene receives `districtAssets(tier)` as props and fetches
 * the files from the prerendered routes /geo/districts/<tier>/<id> and /geo/blocks/<tier>.
 *
 * Every URL carries `?v=` with its file's content hash (data/geo/manifest.derived.json), so a
 * rebuilt district gets a new URL and the long-lived caches (next.config.ts headers, the service
 * worker's geo cache, S04e) never serve a stale copy.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import ambientJson from '@data/config/ambient.json'
import geoConfigJson from '@data/config/geo.json'
import { project } from '@/lib/geo/projection'
import type { BuildingDistrictId } from '@/lib/geo/sources'
import type { AmbientAssets, AmbientModelAsset } from '@/scene/ambient/assets'
import { pedestrianModelIds } from '@/scene/ambient/kitIds'
import type { StreetPropsAssets } from '@/scene/props/layer'
import { perf, props as propsConfig } from './config'
import { geoManifest } from './geo'
import { modelRef } from './models'
import { parseDataFile } from './parse'
import {
  GeoConfigSchema,
  QUALITY_TIERS,
  STREET_PROP_MODELS,
  type QualityTier,
} from './schemas/config'
import { AmbientConfigSchema } from './schemas/scene'
import {
  BlocksFileSchema,
  BuildingsFileSchema,
  StreetsFileSchema,
  type BlocksFile,
  type BuildingsFile,
  type StreetsFile,
} from './schemas/world'

export const geoConfig = parseDataFile('config/geo.json', GeoConfigSchema, geoConfigJson)
const ambientConfig = parseDataFile('config/ambient.json', AmbientConfigSchema, ambientJson)

/** data/ path of one district's buildings for one tier (as scripts/geo/transform.ts writes it). */
export const districtDataPath = (id: string, tier: QualityTier) =>
  `geo/districts/${id}.${tier}.derived.json`
/** data/ path of one tier's procedural blocks. */
export const blocksDataPath = (tier: QualityTier) => `geo/blocks.${tier}.derived.json`
/** data/ path of the street props' chains (S04i), one file for the tiers that draw props. */
export const STREETS_DATA_PATH = 'geo/streets.derived.json'

/** The first 12 hex digits of a data file's sha256 in the geo manifest. */
function fileVersion(path: string): string {
  const entry = geoManifest.files.find((file) => file.path === path)
  if (entry === undefined) throw new Error(`geo manifest has no ${path}: run npm run geo:build`)
  return entry.sha256.slice(0, 12)
}

export interface DistrictAsset {
  readonly id: BuildingDistrictId
  /** /geo/districts/<tier>/<id>?v=<hash>. */
  readonly url: string
  /** The district circle in local metres: footprints were kept inside it. */
  readonly centre: { readonly x: number; readonly y: number }
  readonly radiusM: number
}

export interface DistrictAssets {
  readonly tier: QualityTier
  /** In data/config/geo.json order. */
  readonly districts: readonly DistrictAsset[]
  /** /geo/blocks/<tier>?v=<hash>. */
  readonly blocksUrl: string
  /** Street props (S04i), or null where the tier draws none (low: nothing is ever fetched). */
  readonly props: StreetPropsAssets | null
  /** The living city (S04l, every tier): loaded after playable, never precached. */
  readonly ambient: AmbientAssets
}

/** Everything the scene loads for one tier's buildings. */
export function districtAssets(tier: QualityTier): DistrictAssets {
  return {
    tier,
    districts: geoConfig.districts.map((district) => {
      const centre = project(district.center)
      return {
        id: district.id,
        url: `/geo/districts/${tier}/${district.id}?v=${fileVersion(districtDataPath(district.id, tier))}`,
        centre: { x: Math.round(centre.x), y: Math.round(centre.y) },
        radiusM: district.radiusM,
      }
    }),
    blocksUrl: `/geo/blocks/${tier}?v=${fileVersion(blocksDataPath(tier))}`,
    props: streetPropsAssets(tier),
    ambient: ambientAssets(tier),
  }
}

/**
 * The living city's assets for one tier (S04l): the streets (fetched after playable, on low
 * too: perf.json `streetsGzKB.low`) and the GLB of every model its vehicle and pedestrian kits
 * bake, a kind whose perf.json `ambient` cap is 0 left out so it is never downloaded.
 */
export function ambientAssets(tier: QualityTier): AmbientAssets {
  const caps = perf.ambient.instancesMax
  const asset = (id: string): AmbientModelAsset => {
    const ref = modelRef(id)
    return [ref.id, ref.kind, ref.files[tier], ref.slots.join(',')]
  }
  const vehicles = ambientConfig.vehicles.models[tier].filter((id) =>
    id.startsWith('bus') ? caps.bus[tier] > 0 : caps.vehicle[tier] > 0,
  )
  const pedestrians = caps.pedestrian[tier] > 0 ? pedestrianModelIds(tier) : []
  return {
    streetsUrl: streetsUrl(),
    vehicles: vehicles.map(asset),
    pedestrians: pedestrians.map(asset),
  }
}

/** /geo/streets?v=<hash>: fetched by street props and the living city, never warmed or precached. */
export const streetsUrl = () => `/geo/streets?v=${fileVersion(STREETS_DATA_PATH)}`

/**
 * What the page carries for one tier's street props (kept small: it rides in the page's
 * payload): the streets URL, the distance that loads them, the water towers' height range (so
 * the buildings keep only candidate masses) and the GLB of every model data/config/props.json places
 * there, a model capped at 0 instances left out so it is never downloaded. The lazy props chunk
 * reads the rest of props.json and perf.json `streetProps` itself. Null where the tier
 * draws no chunk (low): nothing is ever fetched there.
 */
export function streetPropsAssets(tier: QualityTier): StreetPropsAssets | null {
  const budget = perf.streetProps
  if (tier === 'low' || budget.drawCallsMax[tier] === 0) return null
  const props = propsConfig
  const placed = new Set<string>([
    'streetlight',
    ...props.rules.tree.models,
    'hydrant',
    'bench',
    ...props.rules.parked.models[tier],
    'traffic-light',
    'water-tower',
  ])
  const ids = STREET_PROP_MODELS.filter((id) => placed.has(id) && budget.instancesMax[id][tier] > 0)
  return {
    url: streetsUrl(),
    prefetchBelowDistanceM: props.prefetchBelowDistanceM[tier],
    towerHeightM: [props.rules.waterTower.minHeightM, props.rules.waterTower.maxHeightM],
    files: Object.fromEntries(ids.map((id) => [id, modelRef(id).files[tier]])),
  }
}

/** The street chains, validated (prerendered into /geo/streets). */
export async function readStreets(): Promise<StreetsFile> {
  return parseDataFile(STREETS_DATA_PATH, StreetsFileSchema, await readDataJson(STREETS_DATA_PATH))
}

/**
 * Every building URL of one tier, districts first then the blocks: what the scene can fetch for
 * that tier, and what the service worker warms for it (S04e part 2).
 */
export function districtAssetUrls(tier: QualityTier): string[] {
  const assets = districtAssets(tier)
  return [...assets.districts.map((district) => district.url), assets.blocksUrl]
}

/** Route params of every prerendered district body. */
export function districtRouteParams(): { tier: QualityTier; id: BuildingDistrictId }[] {
  return QUALITY_TIERS.flatMap((tier) => geoConfig.districts.map(({ id }) => ({ tier, id })))
}

const isTier = (tier: string): tier is QualityTier =>
  (QUALITY_TIERS as readonly string[]).includes(tier)

async function readDataJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(join(process.cwd(), 'data', path), 'utf8')) as unknown
}

/**
 * One district's buildings for one tier, validated, or null for an unknown tier or district.
 * Read from disk while the route is prerendered, so the ~2 MB of building JSON never sits in a
 * server bundle.
 */
export async function readDistrictBuildings(
  tier: string,
  id: string,
): Promise<BuildingsFile | null> {
  if (!isTier(tier) || !geoConfig.districts.some((district) => district.id === id)) return null
  const path = districtDataPath(id, tier)
  return parseDataFile(path, BuildingsFileSchema, await readDataJson(path))
}

/** One tier's procedural blocks, validated, or null for an unknown tier. */
export async function readBlocks(tier: string): Promise<BlocksFile | null> {
  if (!isTier(tier)) return null
  const path = blocksDataPath(tier)
  return parseDataFile(path, BlocksFileSchema, await readDataJson(path))
}
