/**
 * Every file under /data is validated by a zod schema, and the cross-file references hold
 * (copy keys, balance ids, coordinates inside the NYC extent).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { parseDataFile } from './parse'
import {
  BalanceConfigSchema,
  type BalanceConfig,
  CopyConfigSchema,
  GeoConfigSchema,
  JOB_IDS,
  LayoutConfigSchema,
  ModerationConfigSchema,
  OnboardingConfigSchema,
  PerfConfigSchema,
  RealtimeConfigSchema,
  ThemeConfigSchema,
} from './schemas/config'
import {
  EventsFileSchema,
  ItemsFileSchema,
  JobsFileSchema,
  LandmarksFileSchema,
  PremiumFileSchema,
  VenuesFileSchema,
} from './schemas/content'
import { BaseCopySchema, SlangPackSchema } from './schemas/copy'
import {
  AudioManifestSchema,
  GeoBoundsSchema,
  GeoManifestSchema,
  LandFileSchema,
  ParksFileSchema,
  SubwayFileSchema,
  WaterFileSchema,
  ZoneShapesFileSchema,
  ZonesFileSchema,
} from './schemas/world'
import { balance, onboarding, perf, realtime, theme } from './config'
import { events, geoBounds, items, jobs, landmarks, premiumItems, venues } from './content'
import { baseCopy } from '@/lib/copy'

const DATA = join(import.meta.dirname, '../../../data')

/** The schema for each data file. Files under copy/packs/ all use SlangPackSchema. */
const SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  'audio/manifest.json': AudioManifestSchema,
  'config/balance.json': BalanceConfigSchema,
  'config/copy.json': CopyConfigSchema,
  'config/geo.json': GeoConfigSchema,
  'config/layout.json': LayoutConfigSchema,
  'config/moderation.json': ModerationConfigSchema,
  'config/onboarding.json': OnboardingConfigSchema,
  'config/perf.json': PerfConfigSchema,
  'config/realtime.json': RealtimeConfigSchema,
  'config/theme.json': ThemeConfigSchema,
  'copy/base.json': BaseCopySchema,
  'events/events.json': EventsFileSchema,
  'geo/bounds.json': GeoBoundsSchema,
  'geo/land.derived.json': LandFileSchema,
  'geo/manifest.derived.json': GeoManifestSchema,
  'geo/parks.derived.json': ParksFileSchema,
  'geo/subway.derived.json': SubwayFileSchema,
  'geo/water.derived.json': WaterFileSchema,
  'items/items.json': ItemsFileSchema,
  'jobs/jobs.json': JobsFileSchema,
  'landmarks/landmarks.json': LandmarksFileSchema,
  'premium/premium.json': PremiumFileSchema,
  'venues/venues.json': VenuesFileSchema,
  'zones/zone-shapes.derived.json': ZoneShapesFileSchema,
  'zones/zones.derived.json': ZonesFileSchema,
}

function schemaFor(file: string): z.ZodType | undefined {
  return file.startsWith('copy/packs/') ? SlangPackSchema : SCHEMAS[file]
}

/** Extensions the data loaders parse. Every file with one of these needs a schema. */
const DATA_EXTENSIONS = ['.json', '.geojson']

/** Documentation that may sit next to data (by file name). Everything else must be data. */
const NON_DATA_FILES = new Set(['SOURCES.md', 'README.md'])

/** OS artefacts that are gitignored and never shipped. */
const IGNORED_FILES = new Set(['.DS_Store'])

function allFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && !IGNORED_FILES.has(entry.name))
    .map((entry) => relative(DATA, join(entry.parentPath, entry.name)).split('\\').join('/'))
    .sort()
}

const isDataFile = (file: string) => DATA_EXTENSIONS.some((ext) => file.endsWith(ext))
const baseName = (file: string) => file.split('/').pop() ?? file

/** Files that would ship without validation: unknown types, or data files with no schema. */
function unvalidatedFiles(files: readonly string[]): string[] {
  return files.filter((file) =>
    isDataFile(file) ? schemaFor(file) === undefined : !NON_DATA_FILES.has(baseName(file)),
  )
}

function dataFiles(dir: string): string[] {
  return allFiles(dir).filter(isDataFile)
}

const readJson = (file: string): unknown => JSON.parse(readFileSync(join(DATA, file), 'utf8'))

describe('/data files', () => {
  const files = dataFiles(DATA)

  it.each([
    'items',
    'premium',
    'events',
    'jobs',
    'venues',
    'landmarks',
    'geo',
    'zones',
    'audio',
    'config',
    'copy',
  ])('/data/%s has at least one data file', (folder) => {
    expect(files.some((file) => file.startsWith(`${folder}/`))).toBe(true)
  })

  it('every file is a data file with a schema or allowlisted docs, so nothing ships unvalidated', () => {
    expect(unvalidatedFiles(allFiles(DATA))).toEqual([])
  })

  it('the file check rejects unknown types and schema-less .json or .geojson files', () => {
    expect(
      unvalidatedFiles([
        'config/perf.json',
        'geo/SOURCES.md',
        'geo/land.geojson',
        'items/extra.json',
        'audio/notes.txt',
        'geo/land.csv',
        'items/items.yaml',
      ]),
    ).toEqual([
      'geo/land.geojson',
      'items/extra.json',
      'audio/notes.txt',
      'geo/land.csv',
      'items/items.yaml',
    ])
  })

  it.each(dataFiles(DATA))('%s matches its schema', (file) => {
    const schema = schemaFor(file)
    if (schema === undefined) throw new Error(`no schema for ${file}`)
    expect(() => parseDataFile(file, schema, readJson(file))).not.toThrow()
  })

  it('reports the file and the failing path when a file is invalid', () => {
    expect(() => parseDataFile('config/realtime.json', RealtimeConfigSchema, {})).toThrow(
      /config\/realtime\.json[\s\S]*shardSize/,
    )
  })
})

describe('config/perf.json', () => {
  it('holds every budget from CLAUDE.md "Performance budgets"', () => {
    expect(perf).toEqual({
      shellJsGzKB: 180,
      sceneChunkJsGzKB: 350,
      totalJsToPlayableGzKB: 550,
      baseGeoGzKB: 400,
      districtBuildingsGzKB: { low: 150, mid: 300, high: 400 },
      totalBytesToPlayableGzKB: { low: 1200, mid: 1600, high: 2000 },
      shellInteractiveColdMs: 2500,
      playableColdMs: { low: 6000, mid: 7000, high: 8000 },
      playableWarmMs: 2500,
      drawCallsMax: { low: 60, mid: 120, high: 200 },
      trianglesMax: { low: 150_000, mid: 400_000, high: 800_000 },
      dprCap: { low: 1, mid: 1.5, high: 2 },
      shadows: { low: 'none', mid: 'blob-or-baked', high: 'pcf-directional' },
      otherPlayersMax: { low: 8, mid: 16, high: 24 },
      otherPlayersStyle: { low: 'billboard', mid: 'model', high: 'model' },
      medianFpsMin: { low: 30, mid: 45, high: 55 },
      idleFramesMax: 0,
      fpsStepDown: { belowFps: 28, sustainMs: 3000 },
      throttleProfiles: {
        'cc-mid-4g': {
          downloadKbps: 4000,
          uploadKbps: 1000,
          rttMs: 150,
          cpuSlowdown: 4,
          viewport: { width: 390, height: 844 },
        },
      },
    })
  })

  it('rejects a missing tier, an unknown key and a non-positive budget', () => {
    const valid = readJson('config/perf.json') as Record<string, unknown>
    const without = { ...valid, dprCap: { low: 1, mid: 1.5 } }
    expect(PerfConfigSchema.safeParse(without).success).toBe(false)
    expect(PerfConfigSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false)
    expect(PerfConfigSchema.safeParse({ ...valid, shellJsGzKB: 0 }).success).toBe(false)
    const softShadows = { low: 'none', mid: 'blob-or-baked', high: 'pcf-soft' }
    expect(PerfConfigSchema.safeParse({ ...valid, shadows: softShadows }).success).toBe(false)
  })
})

describe('config/realtime.json and moderation', () => {
  it('uses the defaults from CLAUDE.md', () => {
    expect(realtime).toMatchObject({
      shardSize: 16,
      maxFriendFanout: 50,
      heartbeatIntervalMs: 60_000,
    })
  })

  it('rejects zero or fractional limits', () => {
    const valid = readJson('config/realtime.json') as Record<string, unknown>
    expect(RealtimeConfigSchema.safeParse({ ...valid, shardSize: 0 }).success).toBe(false)
    expect(RealtimeConfigSchema.safeParse({ ...valid, shardSize: 16.5 }).success).toBe(false)
    expect(ModerationConfigSchema.safeParse({ autoHideReports: 0 }).success).toBe(false)
  })
})

describe('config/onboarding.json', () => {
  it('holds the CLAUDE.md age rule: 18+, a 24 h lock on that device', () => {
    expect(onboarding).toMatchObject({ minimumAge: 18, underAgeLockHours: 24 })
    expect(onboarding.birthYearSpan).toBeGreaterThan(onboarding.minimumAge + 1)
  })

  it('rejects a fractional lock, a non-date consent version and a span nobody can pass', () => {
    const valid = readJson('config/onboarding.json') as Record<string, unknown>
    const parse = (patch: Record<string, unknown>) =>
      OnboardingConfigSchema.safeParse({ ...valid, ...patch }).success
    expect(parse({})).toBe(true)
    expect(parse({ underAgeLockHours: 0.5 })).toBe(false)
    expect(parse({ consentVersion: 'v1' })).toBe(false)
    expect(parse({ birthYearSpan: 19 })).toBe(false)
    expect(parse({ extra: true })).toBe(false)
  })
})

describe('config/theme.json', () => {
  it('has the night palette: deep indigo, hot pink, taxi yellow and neutrals', () => {
    expect(Object.keys(theme.colors)).toEqual(
      expect.arrayContaining(['night-950', 'pink-400', 'taxi-400', 'ink-50']),
    )
  })

  it('rejects a bad hex and a themeColor that names no token', () => {
    expect(
      ThemeConfigSchema.safeParse({ colors: { 'pink-400': 'pink' }, themeColor: 'pink-400' })
        .success,
    ).toBe(false)
    expect(
      ThemeConfigSchema.safeParse({ colors: { 'pink-400': '#ff4fa3' }, themeColor: 'nope-1' })
        .success,
    ).toBe(false)
  })
})

describe('config/balance.json', () => {
  it('holds the CLAUDE.md balance anchors', () => {
    expect(balance.time).toMatchObject({
      gameMinutesPerRealMinute: 10,
      gameDayHours: 24,
      rentPeriodGameDays: 7,
      speeds: [1, 2],
    })
    expect(balance.start).toEqual({ cash: 150, home: 'queens-room' })
    expect(balance.rentPerWeek).toEqual({
      'queens-room': 280,
      'brooklyn-1br': 520,
      'manhattan-loft': 1100,
    })
    expect(balance.jobs).toMatchObject({
      shiftHours: 4,
      hourlyWage: { barista: 14, retail: 16, delivery: 18, 'junior-dev': 35 },
    })
    expect(balance.costs).toEqual({ food: { min: 4, max: 12 }, subwayFare: 3 })
  })

  it('rejects an inverted range and fractional dollars', () => {
    const valid = readJson('config/balance.json') as Record<string, unknown>
    const costs = { food: { min: 12, max: 4 }, subwayFare: 3 }
    expect(BalanceConfigSchema.safeParse({ ...valid, costs }).success).toBe(false)
    const start = { cash: 150.5, home: 'queens-room' }
    expect(BalanceConfigSchema.safeParse({ ...valid, start }).success).toBe(false)
  })

  it('rejects clock speeds without 1x, stats above the max and oversized actions', () => {
    const valid = readJson('config/balance.json') as BalanceConfig
    const time = (patch: Partial<BalanceConfig['time']>) => ({
      ...valid,
      time: { ...valid.time, ...patch },
    })
    expect(BalanceConfigSchema.safeParse(time({ speeds: [2, 1] })).success).toBe(false)
    expect(BalanceConfigSchema.safeParse(time({ speeds: [1, 1] })).success).toBe(false)
    expect(BalanceConfigSchema.safeParse(time({ startMinuteOfDay: 1440 })).success).toBe(false)
    const stats = { ...valid.stats, start: { ...valid.stats.start, mood: valid.stats.max + 1 } }
    expect(BalanceConfigSchema.safeParse({ ...valid, stats }).success).toBe(false)
    const huge = {
      durationMin: valid.actions.maxDurationMin + 1,
      cashCost: 0,
      energyCost: 0,
      statEffects: {},
    }
    const actions = { ...valid.actions, catalog: { ...valid.actions.catalog, huge } }
    expect(BalanceConfigSchema.safeParse({ ...valid, actions }).success).toBe(false)
    const effect = { durationMin: 1, cashCost: 0, energyCost: 0, statEffects: { mood: -101 } }
    const badEffect = { ...valid.actions, catalog: { effect } }
    expect(BalanceConfigSchema.safeParse({ ...valid, actions: badEffect }).success).toBe(false)
  })

  it('food actions cost within the food range', () => {
    for (const id of ['bodega-breakfast', 'home-meal']) {
      const cost = balance.actions.catalog[id]?.cashCost
      expect(cost, id).toBeGreaterThanOrEqual(balance.costs.food.min)
      expect(cost, id).toBeLessThanOrEqual(balance.costs.food.max)
    }
  })
})

describe('content schemas', () => {
  const item = {
    id: 'tee',
    nameKey: 'items.tee.name',
    category: 'clothing',
    rarity: 'common',
    price: 20,
    sellValue: 8,
    cloutValue: 1,
    statEffects: { mood: 2 },
  }

  it('rejects an item that sells for more than it costs, or an unknown stat', () => {
    expect(ItemsFileSchema.safeParse({ items: [item] }).success).toBe(true)
    expect(ItemsFileSchema.safeParse({ items: [{ ...item, sellValue: 21 }] }).success).toBe(false)
    expect(
      ItemsFileSchema.safeParse({ items: [{ ...item, statEffects: { luck: 1 } }] }).success,
    ).toBe(false)
  })

  it('rejects duplicate ids', () => {
    expect(ItemsFileSchema.safeParse({ items: [item, item] }).success).toBe(false)
  })

  it('rejects a premium item with a sellValue or a non-USD currency', () => {
    const premium = premiumItems[0]
    expect(PremiumFileSchema.safeParse({ items: [{ ...premium, sellValue: 1 }] }).success).toBe(
      false,
    )
    expect(PremiumFileSchema.safeParse({ items: [{ ...premium, currency: 'cash' }] }).success).toBe(
      false,
    )
  })

  it('rejects a landmark with an unknown category or no nameMode', () => {
    const noMode: Record<string, unknown> = { ...landmarks[0] }
    delete noMode.nameMode
    expect(LandmarksFileSchema.safeParse({ landmarks: [noMode] }).success).toBe(false)
    const tower = { ...landmarks[0], category: 'tower' }
    expect(LandmarksFileSchema.safeParse({ landmarks: [tower] }).success).toBe(false)
  })

  it('accepts only CC0 audio tracks with an https source', () => {
    const track = {
      id: 'loop-1',
      channel: 'music',
      file: '/audio/music/loop-1.ogg',
      license: 'CC0-1.0',
      sourceUrl: 'https://example.org/loop-1',
    }
    const manifest = { channels: ['music', 'sfx', 'ambience', 'voice'], tracks: [track] }
    expect(AudioManifestSchema.safeParse(manifest).success).toBe(true)
    const radio = { ...manifest, tracks: [{ ...track, license: 'CC-BY-4.0' }] }
    expect(AudioManifestSchema.safeParse(radio).success).toBe(false)
    const http = { ...manifest, tracks: [{ ...track, sourceUrl: 'http://example.org/x' }] }
    expect(AudioManifestSchema.safeParse(http).success).toBe(false)
  })

  it('rejects a zone with a bad CDTA or NTA code, no NTAs or a fractional centroid', () => {
    const file = readJson('zones/zones.derived.json') as { zones: Record<string, unknown>[] }
    const zone = file.zones[0]
    const withZone = (patch: Record<string, unknown>) => ({
      ...file,
      zones: [{ ...zone, ...patch }],
    })
    expect(ZonesFileSchema.safeParse(withZone({})).success).toBe(true)
    expect(ZonesFileSchema.safeParse(withZone({ cdtaCode: 'QN1' })).success).toBe(false)
    expect(ZonesFileSchema.safeParse(withZone({ ntaCodes: ['Q101'] })).success).toBe(false)
    expect(ZonesFileSchema.safeParse(withZone({ ntaCodes: [] })).success).toBe(false)
    expect(ZonesFileSchema.safeParse(withZone({ centroid: { x: 1.5, y: 0 } })).success).toBe(false)
  })

  it('rejects a derived geo file that drops its derived flag or names another projection', () => {
    const file = readJson('geo/water.derived.json') as Record<string, unknown>
    expect(WaterFileSchema.safeParse(file).success).toBe(true)
    expect(WaterFileSchema.safeParse({ ...file, derived: false }).success).toBe(false)
    const projection = { id: 'other', originLat: 40.7, originLng: -73.98 }
    expect(WaterFileSchema.safeParse({ ...file, projection }).success).toBe(false)
  })

  it('rejects geo config whose station tolerance is below the simplification error', () => {
    const valid = readJson('config/geo.json') as Record<string, unknown>
    expect(GeoConfigSchema.safeParse(valid).success).toBe(true)
    expect(GeoConfigSchema.safeParse({ ...valid, stationOnLineToleranceM: 8 }).success).toBe(false)
  })
})

describe('cross-file references', () => {
  const copyKeys = new Set(Object.keys(baseCopy.strings))

  it('every copy key named by content exists in data/copy/base.json', () => {
    const refs = [
      ...items.map((entry) => entry.nameKey),
      ...premiumItems.map((entry) => entry.nameKey),
      ...events.flatMap((entry) => [entry.titleKey, entry.bodyKey]),
      ...jobs.map((entry) => entry.nameKey),
      ...venues.map((entry) => entry.nameKey),
      ...landmarks.map((entry) => entry.nameKey),
    ]
    expect(refs.filter((key) => !copyKeys.has(key))).toEqual([])
  })

  it('jobs and balance wages list the same job ids', () => {
    expect(jobs.map((job) => job.id).sort()).toEqual([...JOB_IDS].sort())
    expect(Object.keys(balance.jobs.hourlyWage).sort()).toEqual([...JOB_IDS].sort())
  })

  it('every premium price tier exists in balance', () => {
    const tiers = Object.keys(balance.premiumPriceTiersUsd)
    expect(premiumItems.filter((entry) => !tiers.includes(entry.priceTier))).toEqual([])
  })

  it('every venue and landmark sits inside the NYC extent', () => {
    const outside = [...venues, ...landmarks].filter(
      ({ location: { lat, lng } }) =>
        lng < geoBounds.west ||
        lng > geoBounds.east ||
        lat < geoBounds.south ||
        lat > geoBounds.north,
    )
    expect(outside).toEqual([])
  })
})
