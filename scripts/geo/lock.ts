/**
 * scripts/geo/sources.lock.json: the pinned upstream files the geo build reads. The source
 * definitions below are the single source of truth for what is downloaded and from where; the
 * lock adds what was actually retrieved (date, sha256, size), so a changed upstream file fails
 * the build instead of silently changing the map.
 */
import { z } from 'zod'
import {
  GEO_SOURCE_IDS,
  LION_SOURCE_IDS,
  LION_STREETS,
  type GeoSourceId,
} from '../../src/lib/geo/sources.ts'

const httpsUrl = z.url({ protocol: /^https$/ })

const TermsSchema = z.strictObject({ name: z.string().min(1), url: httpsUrl })

const SourceDefinitionSchema = z.strictObject({
  id: z.enum(GEO_SOURCE_IDS),
  title: z.string().min(1),
  publisher: z.string().min(1),
  /** Human-readable catalogue page for the dataset. */
  catalogUrl: httpsUrl,
  /** The exact URL downloaded. */
  url: httpsUrl,
  /** File name in the cache (.cache/geo/). */
  file: z.string().regex(/^[a-z0-9-]+\.(?:geojson|zip)$/),
  terms: TermsSchema,
})
export type SourceDefinition = z.infer<typeof SourceDefinitionSchema>

export const LockEntrySchema = SourceDefinitionSchema.extend({
  retrieved: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.int().positive(),
})
export type LockEntry = z.infer<typeof LockEntrySchema>

/**
 * A lock whose source list may be incomplete or out of order: what `--update` accepts as the
 * previous lock, so adding a source keeps the retrieval dates of the ones already pinned.
 */
export const PartialLockSchema = z.strictObject({
  version: z.literal(1),
  sources: z.array(LockEntrySchema),
})

export const LockSchema = PartialLockSchema.refine(
  (lock) =>
    lock.sources.length === GEO_SOURCE_IDS.length &&
    lock.sources.every((entry, index) => entry.id === GEO_SOURCE_IDS[index]),
  { error: `sources must list ${GEO_SOURCE_IDS.join(', ')} in that order` },
)
export type Lock = z.infer<typeof LockSchema>

const ARCGIS = 'https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/arcgis/rest/services'
const NYC_OPEN_DATA_TERMS = {
  name: 'NYC Open Data Terms of Use',
  url: 'https://www.nyc.gov/html/data/terms.html',
}

/** ArcGIS item of DCP's LION FeatureServer (the street centerline file, release 26C). */
export const LION_ITEM_ID = 'db6fdacfc5ff44e7a244e2f798d98a7d'
/**
 * Only the fields the frames build reads. Ordered by segment id so the response, and its hash,
 * stay byte-identical between downloads of the same release.
 */
const LION_FIELDS = 'Street,SegmentID,SegmentTyp,RW_TYPE,FeatureTyp'

function lionQueryUrl(street: string): string {
  const query = new URLSearchParams({
    where: `Street='${street}'`,
    outFields: LION_FIELDS,
    outSR: '4326',
    orderByFields: 'SegmentID,OBJECTID',
    f: 'geojson',
  })
  return `${ARCGIS}/LION/FeatureServer/0/query?${query.toString()}`
}

const lionDefinitions = LION_SOURCE_IDS.map((id) => ({
  id,
  title: `LION street centerline: ${LION_STREETS[id]}`,
  publisher: 'NYC Department of City Planning',
  catalogUrl: `https://www.arcgis.com/home/item.html?id=${LION_ITEM_ID}`,
  url: lionQueryUrl(LION_STREETS[id]),
  file: `${id}.geojson`,
  terms: NYC_OPEN_DATA_TERMS,
}))

/** In GEO_SOURCE_IDS order. */
export const SOURCE_DEFINITIONS: readonly SourceDefinition[] = z
  .array(SourceDefinitionSchema)
  .parse([
    {
      id: 'dcp-borough-boundaries',
      title: 'Borough Boundaries (clipped to shoreline)',
      publisher: 'NYC Department of City Planning',
      catalogUrl: 'https://data.cityofnewyork.us/d/gthc-hcne',
      url: `${ARCGIS}/NYC_Borough_Boundary/FeatureServer/0/query?where=1%3D1&outFields=BoroCode,BoroName&outSR=4326&orderByFields=BoroCode&f=geojson`,
      file: 'dcp-borough-boundaries.geojson',
      terms: NYC_OPEN_DATA_TERMS,
    },
    {
      id: 'dcp-nta-2020',
      title: '2020 Neighborhood Tabulation Areas (NTAs)',
      publisher: 'NYC Department of City Planning',
      catalogUrl: 'https://data.cityofnewyork.us/d/9nt8-h7nd',
      url: `${ARCGIS}/NYC_Neighborhood_Tabulation_Areas_2020/FeatureServer/0/query?where=1%3D1&outFields=BoroCode,BoroName,NTA2020,NTAName,NTAType,CDTA2020,CDTAName&outSR=4326&orderByFields=NTA2020&f=geojson`,
      file: 'dcp-nta-2020.geojson',
      terms: NYC_OPEN_DATA_TERMS,
    },
    {
      id: 'mta-gtfs-subway',
      title: 'MTA New York City Transit subway static GTFS',
      publisher: 'Metropolitan Transportation Authority (MTA)',
      catalogUrl: 'https://www.mta.info/developers',
      url: 'https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip',
      file: 'mta-gtfs-subway.zip',
      terms: {
        name: 'MTA Developer Terms and Conditions (updated 2024-03-13)',
        url: 'https://www.mta.info/developers/terms-and-conditions',
      },
    },
    ...lionDefinitions,
  ] satisfies (SourceDefinition & { id: GeoSourceId })[])
